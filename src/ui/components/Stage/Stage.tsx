import { useEffect, useMemo, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { brushParams, buildTransform, geometryToSvgAttrs, identityCorrespondence, paintRef, pathBounds, pathToD, resolveAnchor, sampleObject, samplePath, strokeToPath } from '../../../engine';
import type { Gradient, PathData } from '../../../engine';
import { useEditor } from '../../store/store';
import { selectEditablePath, selectEditedShapeKeyframe } from '../../store/selectors';
import { isOrderPreserving, unreferencedTargets, linkSegments } from './correspondenceOverlay';
import { applyFrame } from '../../playback/applyFrame';
import { buildDefs } from './buildDefs';
import { rectFromDrag, primitivePathFromDrag, type Point } from './drawGeometry';
import { applyHandleResize, handleLocalPositions, HANDLE_IDS, type HandleId } from './resizeHandles';
import { usePathTools } from './usePathTools';
import { nearFirstAnchor, hitTestSegment } from './pathHitTest';
import styles from './Stage.module.css';

const MIN_DRAW_SIZE = 3;
const HANDLE_SIZE = 8;

// Renders a gradient paint definition. Placed AS A SIBLING AFTER the shape inside
// an object <g> (never before — the shape must stay the group's firstElementChild
// so applyFrameToNodes keeps finding it). objectBoundingBox is the SVG default, so
// no gradientUnits attribute is emitted (matches the export's gradientToSvg).
function GradientEl({ id, g }: { id: string; g: Gradient }) {
  const stops = g.stops.map((s, i) => (
    <stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={s.opacity ?? 1} />
  ));
  return g.type === 'linear' ? (
    <linearGradient id={id} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2}>
      {stops}
    </linearGradient>
  ) : (
    <radialGradient id={id} cx={g.cx} cy={g.cy} r={g.r} fx={g.fx} fy={g.fy}>
      {stops}
    </radialGradient>
  );
}

// Screen-space pick radius (px) for closing the pen and grabbing nodes/handles;
// divided by zoom at the call site to keep a constant on-screen tolerance.
const CLOSE_TOL = 8;
const CORR_KF_EPS = 1e-6;

interface DragState {
  id: string;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  /** Latest dragged position, committed once on pointer-up. */
  curX: number;
  curY: number;
  moved: boolean;
}

export function Stage({ nodes }: { nodes: Map<string, SVGGraphicsElement> }) {
  const project = useEditor((s) => s.history.present);
  const time = useEditor((s) => s.time);
  const selectedId = useEditor((s) => s.selectedObjectId);
  const zoom = useEditor((s) => s.zoom);
  const pan = useEditor((s) => s.pan);
  const activeTool = useEditor((s) => s.activeTool);
  const selectedNodeIndex = useEditor((s) => s.selectedNodeIndex);
  const correspondenceEditing = useEditor((s) => s.correspondenceEditing);
  const selectedShapeKeyframe = useEditor((s) => s.selectedShapeKeyframe);
  const { selectObject } = useEditor.getState();

  const pathTools = usePathTools();
  const pathToolsRef = useRef(pathTools);
  pathToolsRef.current = pathTools;

  const usedIds = useMemo(
    () => Array.from(new Set(project.objects.map((o) => o.assetId))).sort(),
    [project.objects],
  );
  const defs = useMemo(() => buildDefs(project.assets, usedIds), [project.assets, usedIds]);
  const assetsById = useMemo(
    () => new Map(project.assets.map((a) => [a.id, a] as const)),
    [project.assets],
  );
  const ordered = useMemo(
    () => [...project.objects].sort((a, b) => a.zOrder - b.zOrder),
    [project.objects],
  );

  // The currently-selected vector object plus its resolved render data, used to
  // draw the resize-handle overlay in the object's local space.
  const selectedVector = useMemo(() => {
    if (!selectedId) return null;
    const obj = project.objects.find((o) => o.id === selectedId);
    const asset = obj ? assetsById.get(obj.assetId) : undefined;
    // Paths are move-only under the select tool: no bbox-resize overlay (their
    // geometry is edited via the node tool). Only rect/ellipse get resize handles.
    if (!obj || !asset || asset.kind !== 'vector' || asset.shapeType === 'path') return null;
    const state = sampleObject(obj, time);
    const g = state.geometry ?? {};
    const width = asset.shapeType === 'ellipse' ? 2 * (g.radiusX ?? 0) : g.width ?? 0;
    const height = asset.shapeType === 'ellipse' ? 2 * (g.radiusY ?? 0) : g.height ?? 0;
    const anchor = resolveAnchor(obj, state, asset.shapeType);
    return { obj, shapeType: asset.shapeType, state, width, height, transform: buildTransform(state, anchor.anchorX, anchor.anchorY) };
  }, [selectedId, project.objects, assetsById, time]);

  // The selected path's node overlay (node tool only): the path data to draw
  // (the in-progress drag preview when present, else the committed path) plus the
  // object transform so the overlay sits in the object's local space.
  const selectedPath = useMemo(() => {
    if (activeTool !== 'node' || !selectedId) return null;
    const obj = project.objects.find((o) => o.id === selectedId);
    if (!obj) return null;
    // The shared resolver: sampled morph shape at the playhead, else the base.
    const base = selectEditablePath(useEditor.getState());
    if (!base) return null;
    const path = pathTools.working ?? base;
    const state = sampleObject(obj, time);
    const anchor = resolveAnchor(obj, state, 'path', pathBounds(path));
    return { obj, path, transform: buildTransform(state, anchor.anchorX, anchor.anchorY) };
  }, [activeTool, selectedId, project.objects, assetsById, time, pathTools.working]);

  // Per-node easings of the keyframe at the playhead — drives the node-overlay markers.
  const editedNodeEasings = selectEditedShapeKeyframe(useEditor.getState())?.kf.nodeEasings;

  // Correspondence edit overlay: both bracketing keyframes (from-selected) ghosted in the
  // same object-local space as the node overlay, with node→node links, grow-from-point
  // markers for unreferenced B nodes, and a crossing (non-order-preserving) warning flag.
  let corrOverlay: {
    transform: string;
    from: PathData;
    to: PathData;
    crossing: boolean;
    grow: number[];
    links: ReturnType<typeof linkSegments>;
  } | null = null;
  if (correspondenceEditing && selectedPath && selectedShapeKeyframe) {
    const o = project.objects.find((ob) => ob.id === selectedShapeKeyframe.objectId);
    const track = o?.shapeTrack;
    const idx = track
      ? track.findIndex((k) => Math.abs(k.time - selectedShapeKeyframe.time) < CORR_KF_EPS)
      : -1;
    if (track && idx >= 0 && idx < track.length - 1 && (track[idx].morph ?? 'corresponded') === 'corresponded') {
      const from = track[idx].path;
      const to = track[idx + 1].path;
      const map = track[idx].correspondence ?? identityCorrespondence(from.nodes.length, to.nodes.length);
      corrOverlay = {
        transform: selectedPath.transform,
        from,
        to,
        crossing: !isOrderPreserving(map, to.nodes.length, to.closed),
        grow: unreferencedTargets(map, to.nodes.length),
        links: linkSegments(from, to, map),
      };
    }
  }

  // Imperatively paint the current frame whenever doc/time changes (paused path).
  useEffect(() => {
    applyFrame(nodes, project, time);
  }, [project, time, nodes]);

  // Correspondence link-drag drop resolution. In a real browser the button-held pointerup
  // does not reliably dispatch on the B-node element (pointer target/capture semantics), so
  // resolve the drop target window-side via elementFromPoint. The per-B-node onPointerUp
  // handler remains for environments where the event does land on the target (jsdom tests);
  // whichever fires first nulls corrDragRef, so the link commits exactly once.
  useEffect(() => {
    const onUp = (e: PointerEvent) => {
      const ai = corrDragRef.current;
      if (ai === null) return;
      corrDragRef.current = null;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const m = /^corr-b-(\d+)$/.exec(el?.getAttribute('data-testid') ?? '');
      if (m) useEditor.getState().setCorrespondenceLink(ai, Number(m[1]));
    };
    window.addEventListener('pointerup', onUp);
    return () => window.removeEventListener('pointerup', onUp);
  }, []);

  // Cache one ref callback per object id so its identity is stable across
  // renders — otherwise React would null-then-reset the ref every render,
  // briefly dropping the node from the playback map.
  const refCallbacks = useRef(new Map<string, (el: SVGGraphicsElement | null) => void>());
  const register = (id: string) => {
    let cb = refCallbacks.current.get(id);
    if (!cb) {
      cb = (el: SVGGraphicsElement | null) => {
        if (el) nodes.set(id, el);
        else nodes.delete(id);
      };
      refCallbacks.current.set(id, cb);
    }
    return cb;
  };

  const dragRef = useRef<DragState | null>(null);
  const panRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const contentRef = useRef<SVGGElement | null>(null);
  const drawRef = useRef<{ start: Point; end: Point | null } | null>(null);
  const nodeGrabRef = useRef(false);
  const overlayGroupRef = useRef<SVGGElement | null>(null);
  // The A-node index whose link is being dragged in correspondence-edit mode; committed
  // on pointer-up over a B node (outside any setState updater, StrictMode-safe).
  const corrDragRef = useRef<number | null>(null);
  const previewRef = useRef<SVGRectElement | null>(null);
  const primitivePreviewRef = useRef<SVGPathElement | null>(null);
  // Freehand brush: accumulated stage-local drag samples; committed on pointer-up
  // via strokeToPath (outside any setState updater, StrictMode-safe).
  const brushRef = useRef<{ points: Point[] } | null>(null);
  const brushPreviewRef = useRef<SVGPathElement | null>(null);
  const handleGroupRef = useRef<SVGGElement | null>(null);
  const resizeRef = useRef<{
    handle: HandleId;
    snapshot: ReturnType<typeof snapshotForResize>;
    last?: { width: number; height: number; baseX: number; baseY: number };
  } | null>(null);

  // Snapshots everything applyHandleResize needs at drag start (in OLD geometry).
  function snapshotForResize() {
    const sv = selectedVector!;
    return {
      objId: sv.obj.id,
      isEllipse: sv.shapeType === 'ellipse',
      width: sv.width,
      height: sv.height,
      anchorFracX: sv.obj.anchorX,
      anchorFracY: sv.obj.anchorY,
      baseX: sv.state.x,
      baseY: sv.state.y,
      scaleX: sv.state.scaleX,
      scaleY: sv.state.scaleY,
      rotationDeg: sv.state.rotation,
    };
  }

  const onHandlePointerDown = (handle: HandleId, e: ReactPointerEvent) => {
    e.stopPropagation();
    if (!selectedVector || !useEditor.getState().autoKey) return;
    resizeRef.current = { handle, snapshot: snapshotForResize() };
  };

  // Maps client (screen) coords to stage-local coords through the content group's
  // CTM, so draw/handle math accounts for viewBox scaling, pan, and zoom.
  const clientToLocal = (clientX: number, clientY: number): Point | null => {
    const g = contentRef.current;
    const ctm = g?.getScreenCTM();
    const svg = g?.ownerSVGElement;
    if (!g || !ctm || !svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const local = pt.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  };

  // Maps client coords to the selected path object's LOCAL space through the node
  // overlay group's CTM (which carries the object transform), so node editing is
  // rotation/scale-aware — the same technique as the resize handles.
  const clientToObjectLocal = (clientX: number, clientY: number): Point | null => {
    const g = overlayGroupRef.current;
    const ctm = g?.getScreenCTM();
    const svg = g?.ownerSVGElement;
    if (!g || !ctm || !svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const local = pt.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  };

  const onWheel = (e: React.WheelEvent) => {
    const s = useEditor.getState();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    s.setZoom(s.zoom * factor);
  };

  const onBackgroundPointerDown = (e: ReactPointerEvent) => {
    const s = useEditor.getState();
    if (e.button === 1) {
      panRef.current = { x: e.clientX, y: e.clientY, panX: s.pan.x, panY: s.pan.y };
      return;
    }
    if (
      s.activeTool === 'rect' || s.activeTool === 'ellipse' ||
      s.activeTool === 'polygon' || s.activeTool === 'star' || s.activeTool === 'line'
    ) {
      const start = clientToLocal(e.clientX, e.clientY);
      if (start) drawRef.current = { start, end: null };
      return;
    }
    if (s.activeTool === 'pen' || s.activeTool === 'motion') {
      const local = clientToLocal(e.clientX, e.clientY);
      if (!local) return;
      const d = pathTools.draft;
      // Clicking the first anchor (with >= 2 nodes drawn) closes the path.
      if (d && d.nodes.length >= 2 && nearFirstAnchor({ nodes: d.nodes, closed: false }, local, CLOSE_TOL / s.zoom)) {
        pathTools.finishPen(true);
      } else {
        pathTools.onPenPointerDown(local, true);
      }
      return;
    }
    if (s.activeTool === 'brush') {
      const start = clientToLocal(e.clientX, e.clientY);
      if (start) brushRef.current = { points: [start] };
      return;
    }
    if (s.activeTool === 'node') {
      const local = clientToObjectLocal(e.clientX, e.clientY);
      if (!local) return;
      const tol = CLOSE_TOL / s.zoom;
      if (pathTools.onNodePointerDown(local, tol)) {
        nodeGrabRef.current = true;
        return;
      }
      // Missed a node/handle: clicking a segment inserts a node there.
      const path = selectedPath?.path;
      if (path) {
        const seg = hitTestSegment(path, local, tol);
        if (seg) {
          useEditor.getState().insertNode(seg.segmentIndex, seg.t);
        }
      }
      return;
    }
    if (s.activeTool === 'select') selectObject(null);
  };

  const onSvgDoubleClick = () => {
    if (useEditor.getState().penDrafting) pathTools.finishPen(false);
  };

  const onObjectPointerDown = (id: string, e: ReactPointerEvent) => {
    e.stopPropagation();
    selectObject(id);
    // Only begin a move-drag when auto-key is on (editing is otherwise blocked).
    if (!useEditor.getState().autoKey) return;
    const obj = useEditor.getState().history.present.objects.find((o) => o.id === id);
    if (!obj) return;
    const origin = sampleObject(obj, useEditor.getState().time);
    dragRef.current = {
      id, startX: e.clientX, startY: e.clientY,
      originX: origin.x, originY: origin.y, curX: origin.x, curY: origin.y, moved: false,
    };
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const tool = useEditor.getState().activeTool;
      if (tool === 'pen' || tool === 'motion') {
        const local = clientToLocal(e.clientX, e.clientY);
        if (local) {
          pathToolsRef.current.onPenDrag(local);
          pathToolsRef.current.onPenPointerMove(local);
        }
        return;
      }
      if (tool === 'node' && nodeGrabRef.current) {
        const local = clientToObjectLocal(e.clientX, e.clientY);
        if (local) pathToolsRef.current.onNodeDrag(local);
        return;
      }
      const brush = brushRef.current;
      if (brush) {
        const cur = clientToLocal(e.clientX, e.clientY);
        if (cur) {
          brush.points.push(cur);
          const el = brushPreviewRef.current;
          if (el) {
            // raw in-progress polyline (cheap); the committed path is the smoothed strokeToPath
            el.setAttribute('d', pathToD({ nodes: brush.points.map((p) => ({ anchor: p })), closed: false }));
            el.setAttribute('visibility', 'visible');
          }
        }
        return;
      }
      const draw = drawRef.current;
      if (draw) {
        const cur = clientToLocal(e.clientX, e.clientY);
        if (cur) {
          draw.end = cur;
          const tool = useEditor.getState().activeTool;
          if (tool === 'rect' || tool === 'ellipse') {
            const rect = previewRef.current;
            if (rect) {
              rect.setAttribute('x', String(Math.min(draw.start.x, cur.x)));
              rect.setAttribute('y', String(Math.min(draw.start.y, cur.y)));
              rect.setAttribute('width', String(Math.abs(cur.x - draw.start.x)));
              rect.setAttribute('height', String(Math.abs(cur.y - draw.start.y)));
              rect.setAttribute('visibility', 'visible');
            }
          } else {
            const st = useEditor.getState();
            const path = primitivePathFromDrag(
              tool as 'polygon' | 'star' | 'line',
              draw.start,
              cur,
              { polygonSides: st.polygonSides, starPoints: st.starPoints, starInnerRatio: st.starInnerRatio },
              MIN_DRAW_SIZE,
            );
            const el = primitivePreviewRef.current;
            if (el) {
              if (path) {
                el.setAttribute('d', pathToD(path));
                el.setAttribute('visibility', 'visible');
              } else {
                el.setAttribute('visibility', 'hidden');
              }
            }
          }
        }
        return;
      }
      const rz = resizeRef.current;
      if (rz) {
        const group = handleGroupRef.current;
        const ctm = group?.getScreenCTM();
        const svg = group?.ownerSVGElement;
        if (!group || !ctm || !svg) return;
        const ptn = svg.createSVGPoint();
        ptn.x = e.clientX;
        ptn.y = e.clientY;
        const local = ptn.matrixTransform(ctm.inverse());
        const snap = rz.snapshot;
        const r = applyHandleResize({
          handle: rz.handle,
          localX: local.x,
          localY: local.y,
          width: snap.width,
          height: snap.height,
          anchorFracX: snap.anchorFracX,
          anchorFracY: snap.anchorFracY,
          baseX: snap.baseX,
          baseY: snap.baseY,
          scaleX: snap.scaleX,
          scaleY: snap.scaleY,
          rotationDeg: snap.rotationDeg,
          minSize: 1,
        });
        rz.last = r;
        const node = nodes.get(snap.objId);
        const obj = useEditor.getState().history.present.objects.find((o) => o.id === snap.objId);
        if (node && obj) {
          const geometry = snap.isEllipse
            ? { radiusX: r.width / 2, radiusY: r.height / 2 }
            : { width: r.width, height: r.height };
          const previewState = { ...sampleObject(obj, useEditor.getState().time), x: r.baseX, y: r.baseY, geometry };
          const anchor = resolveAnchor(obj, previewState, snap.isEllipse ? 'ellipse' : 'rect');
          node.setAttribute('transform', buildTransform(previewState, anchor.anchorX, anchor.anchorY));
          const shape = node.firstElementChild;
          if (shape) {
            for (const [a, v] of Object.entries(geometryToSvgAttrs(snap.isEllipse ? 'ellipse' : 'rect', geometry))) {
              shape.setAttribute(a, v);
            }
          }
        }
        return;
      }
      const p = panRef.current;
      if (p) {
        useEditor.getState().setPan({ x: p.panX + (e.clientX - p.x), y: p.panY + (e.clientY - p.y) });
        return;
      }
      const d = dragRef.current;
      if (!d) return;
      const z = useEditor.getState().zoom ?? 1;
      d.curX = d.originX + (e.clientX - d.startX) / z;
      d.curY = d.originY + (e.clientY - d.startY) / z;
      d.moved = true;
      // Live preview only: write the transform imperatively to the node, without
      // committing — the single history entry is pushed once on pointer-up so a
      // whole drag is one undo step.
      const obj = useEditor.getState().history.present.objects.find((o) => o.id === d.id);
      const node = nodes.get(d.id);
      if (obj && node) {
        const sampled = sampleObject(obj, useEditor.getState().time);
        node.setAttribute('transform', buildTransform({ ...sampled, x: d.curX, y: d.curY }, obj.anchorX, obj.anchorY));
      }
    };
    const onUp = () => {
      const tool = useEditor.getState().activeTool;
      if (tool === 'pen' || tool === 'motion') {
        pathToolsRef.current.onPenPointerUp();
        return;
      }
      if (tool === 'node' && nodeGrabRef.current) {
        pathToolsRef.current.onNodePointerUp();
        nodeGrabRef.current = false;
        return;
      }
      const brush = brushRef.current;
      if (brush) {
        brushRef.current = null;
        if (brushPreviewRef.current) brushPreviewRef.current.setAttribute('visibility', 'hidden');
        const s = useEditor.getState();
        const path = strokeToPath(brush.points, brushParams(s.brushSmoothing));
        if (path.nodes.length >= 2) {
          s.addVectorPath(path, { strokeWidth: s.brushSize, strokeLinecap: 'round', strokeLinejoin: 'round' });
        }
        return;
      }
      const draw = drawRef.current;
      if (draw) {
        drawRef.current = null;
        if (previewRef.current) previewRef.current.setAttribute('visibility', 'hidden');
        if (primitivePreviewRef.current) primitivePreviewRef.current.setAttribute('visibility', 'hidden');
        const s = useEditor.getState();
        if (draw.end && (s.activeTool === 'rect' || s.activeTool === 'ellipse')) {
          const bounds = rectFromDrag(draw.start, draw.end, MIN_DRAW_SIZE);
          if (bounds) s.addVectorShape(s.activeTool, bounds);
        } else if (
          draw.end &&
          (s.activeTool === 'polygon' || s.activeTool === 'star' || s.activeTool === 'line')
        ) {
          const path = primitivePathFromDrag(
            s.activeTool,
            draw.start,
            draw.end,
            { polygonSides: s.polygonSides, starPoints: s.starPoints, starInnerRatio: s.starInnerRatio },
            MIN_DRAW_SIZE,
          );
          if (path) s.addVectorPath(path);
        }
        return;
      }
      const rz = resizeRef.current;
      if (rz) {
        const snap = rz.snapshot;
        const last = rz.last;
        resizeRef.current = null;
        if (last) {
          const s = useEditor.getState();
          s.selectObject(snap.objId);
          const geom = snap.isEllipse
            ? { radiusX: last.width / 2, radiusY: last.height / 2 }
            : { width: last.width, height: last.height };
          s.setProperties({ ...geom, x: last.baseX, y: last.baseY });
        }
        return;
      }
      const d = dragRef.current;
      if (d && d.moved) {
        useEditor.getState().selectObject(d.id);
        useEditor.getState().setProperties({ x: d.curX, y: d.curY });
      }
      dragRef.current = null;
      panRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  return (
    <div className={styles.root}>
      <svg
        className={styles.svg}
        viewBox={`0 0 ${project.meta.width} ${project.meta.height}`}
        onPointerDown={onBackgroundPointerDown}
        onDoubleClick={onSvgDoubleClick}
        onWheel={onWheel}
      >
        <g ref={contentRef} transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          <defs dangerouslySetInnerHTML={{ __html: defs }} />
          <rect
            ref={previewRef}
            data-testid="draw-preview"
            visibility="hidden"
            fill="none"
            stroke="var(--color-accent)"
            strokeDasharray="4 2"
            pointerEvents="none"
          />
          <path
            ref={primitivePreviewRef}
            data-testid="primitive-preview"
            visibility="hidden"
            fill="none"
            stroke="var(--color-accent)"
            strokeDasharray="4 2"
            pointerEvents="none"
          />
          <path
            ref={brushPreviewRef}
            data-testid="brush-preview"
            visibility="hidden"
            fill="none"
            stroke="var(--color-accent)"
            pointerEvents="none"
          />
          {ordered.map((o) => {
            const asset = assetsById.get(o.assetId);
            if (asset?.kind === 'vector') {
              // Render shapes as real React elements so all attribute values (incl.
              // style.fill/stroke and the path `d`, which may derive from a loaded
              // .savig) are escaped by React — no dangerouslySetInnerHTML.
              // Effective gradients = the playhead sample (animated track) or the
              // static asset gradient. Matches the export's resolution exactly so the
              // editor preview shows the gradient even when it lives only on a track.
              const sampledObj = sampleObject(o, time);
              const fillGrad = sampledObj.fillGradient ?? asset.style.fillGradient;
              const strokeGrad = sampledObj.strokeGradient ?? asset.style.strokeGradient;
              if (asset.shapeType === 'path') {
                return (
                  <g
                    key={o.id}
                    ref={register(o.id)}
                    data-testid={`object-${o.id}`}
                    data-savig-object={o.id}
                    data-selected={o.id === selectedId}
                    className={styles.object}
                    onPointerDown={(e) => onObjectPointerDown(o.id, e)}
                  >
                    <path
                      d={
                        o.shapeTrack && o.shapeTrack.length > 0
                          ? pathToD(samplePath(o.shapeTrack, time))
                          : asset.path
                            ? pathToD(asset.path)
                            : ''
                      }
                      fill={fillGrad ? paintRef(`savig-grad-${o.id}-fill`) : asset.style.fill}
                      stroke={strokeGrad ? paintRef(`savig-grad-${o.id}-stroke`) : asset.style.stroke}
                      strokeWidth={asset.style.strokeWidth}
                      strokeLinecap={asset.style.strokeLinecap}
                      strokeLinejoin={asset.style.strokeLinejoin}
                    />
                    {fillGrad && <GradientEl id={`savig-grad-${o.id}-fill`} g={fillGrad} />}
                    {strokeGrad && <GradientEl id={`savig-grad-${o.id}-stroke`} g={strokeGrad} />}
                  </g>
                );
              }
              const geometry = sampledObj.geometry ?? {};
              // Geometry flows through the shared geometryToSvgAttrs so it matches
              // export/runtime.
              const geomAttrs = geometryToSvgAttrs(asset.shapeType, geometry);
              const ShapeTag = asset.shapeType === 'rect' ? 'rect' : 'ellipse';
              return (
                <g
                  key={o.id}
                  ref={register(o.id)}
                  data-testid={`object-${o.id}`}
                  data-savig-object={o.id}
                  data-selected={o.id === selectedId}
                  className={styles.object}
                  onPointerDown={(e) => onObjectPointerDown(o.id, e)}
                >
                  <ShapeTag
                    {...geomAttrs}
                    fill={fillGrad ? paintRef(`savig-grad-${o.id}-fill`) : asset.style.fill}
                    stroke={strokeGrad ? paintRef(`savig-grad-${o.id}-stroke`) : asset.style.stroke}
                    strokeWidth={asset.style.strokeWidth}
                    strokeLinecap={asset.style.strokeLinecap}
                    strokeLinejoin={asset.style.strokeLinejoin}
                  />
                  {fillGrad && <GradientEl id={`savig-grad-${o.id}-fill`} g={fillGrad} />}
                  {strokeGrad && <GradientEl id={`savig-grad-${o.id}-stroke`} g={strokeGrad} />}
                </g>
              );
            }
            return (
              <use
                key={o.id}
                ref={register(o.id)}
                data-testid={`object-${o.id}`}
                data-savig-object={o.id}
                data-selected={o.id === selectedId}
                className={styles.object}
                href={`#savig-asset-${o.assetId}`}
                onPointerDown={(e) => onObjectPointerDown(o.id, e)}
              />
            );
          })}
          {selectedVector && (
            <g ref={handleGroupRef} transform={selectedVector.transform} data-testid="resize-handles">
              {HANDLE_IDS.map((id) => {
                const pos = handleLocalPositions(selectedVector.width, selectedVector.height)[id];
                const size = HANDLE_SIZE / zoom;
                return (
                  <rect
                    key={id}
                    data-testid={`handle-${id}`}
                    x={pos.x - size / 2}
                    y={pos.y - size / 2}
                    width={size}
                    height={size}
                    fill="var(--color-accent)"
                    stroke="var(--color-panel)"
                    style={{ cursor: 'pointer' }}
                    onPointerDown={(e) => onHandlePointerDown(id, e)}
                  />
                );
              })}
            </g>
          )}
          {pathTools.draft && pathTools.draft.nodes.length > 0 && (
            <g data-testid="pen-draft" pointerEvents="none">
              <path
                d={pathToD({ nodes: pathTools.draft.nodes, closed: false })}
                fill="none"
                stroke="var(--color-accent)"
                strokeWidth={1 / zoom}
              />
              {pathTools.draft.cursor && (
                <line
                  x1={pathTools.draft.nodes[pathTools.draft.nodes.length - 1].anchor.x}
                  y1={pathTools.draft.nodes[pathTools.draft.nodes.length - 1].anchor.y}
                  x2={pathTools.draft.cursor.x}
                  y2={pathTools.draft.cursor.y}
                  stroke="var(--color-accent)"
                  strokeWidth={1 / zoom}
                  strokeDasharray="4 2"
                />
              )}
              {pathTools.draft.nodes.map((n, i) => (
                <circle
                  key={i}
                  cx={n.anchor.x}
                  cy={n.anchor.y}
                  r={(i === 0 ? 5 : 3) / zoom}
                  fill={i === 0 ? 'var(--color-panel)' : 'var(--color-accent)'}
                  stroke="var(--color-accent)"
                  strokeWidth={1 / zoom}
                />
              ))}
            </g>
          )}
          {(() => {
            const sel = project.objects.find((o) => o.id === selectedId);
            if (!sel?.motionPath) return null;
            // The guide lives in stage coordinates (same space as object base.x/y),
            // so it renders directly in this content group with NO per-object transform.
            // Editor-only chrome — never part of the exported document.
            const followed = sampleObject(sel, time);
            return (
              <g data-testid="motion-guide" pointerEvents="none">
                <path
                  d={pathToD(sel.motionPath.path)}
                  fill="none"
                  stroke="var(--color-progress)"
                  strokeWidth={1.5 / zoom}
                  strokeDasharray={`${4 / zoom} ${3 / zoom}`}
                />
                <circle
                  data-testid="motion-marker"
                  cx={followed.x}
                  cy={followed.y}
                  r={4 / zoom}
                  fill="var(--color-progress)"
                />
              </g>
            );
          })()}
          {selectedPath && (
            <g ref={overlayGroupRef} transform={selectedPath.transform} data-testid="node-overlay">
              {selectedPath.path.nodes.map((n, i) => (
                <g key={i}>
                  {n.in && (
                    <>
                      <line
                        x1={n.anchor.x}
                        y1={n.anchor.y}
                        x2={n.anchor.x + n.in.x}
                        y2={n.anchor.y + n.in.y}
                        stroke="var(--color-accent)"
                        strokeWidth={1 / zoom}
                      />
                      <circle cx={n.anchor.x + n.in.x} cy={n.anchor.y + n.in.y} r={3 / zoom} fill="var(--color-accent)" />
                    </>
                  )}
                  {n.out && (
                    <>
                      <line
                        x1={n.anchor.x}
                        y1={n.anchor.y}
                        x2={n.anchor.x + n.out.x}
                        y2={n.anchor.y + n.out.y}
                        stroke="var(--color-accent)"
                        strokeWidth={1 / zoom}
                      />
                      <circle cx={n.anchor.x + n.out.x} cy={n.anchor.y + n.out.y} r={3 / zoom} fill="var(--color-accent)" />
                    </>
                  )}
                  <rect
                    data-testid={`node-${i}`}
                    x={n.anchor.x - (4 / zoom)}
                    y={n.anchor.y - (4 / zoom)}
                    width={8 / zoom}
                    height={8 / zoom}
                    fill={i === selectedNodeIndex ? 'var(--color-accent)' : 'var(--color-panel)'}
                    stroke="var(--color-accent)"
                    strokeWidth={1 / zoom}
                  />
                  {editedNodeEasings?.[i] != null && (
                    <circle
                      data-testid={`node-easing-marker-${i}`}
                      cx={n.anchor.x}
                      cy={n.anchor.y}
                      r={7 / zoom}
                      fill="none"
                      stroke="var(--color-accent)"
                      strokeWidth={1 / zoom}
                      pointerEvents="none"
                    />
                  )}
                </g>
              ))}
            </g>
          )}
          {corrOverlay && (
            <g transform={corrOverlay.transform} data-testid="correspondence-overlay">
              {/* ghost B nodes (drop targets) */}
              {corrOverlay.to.nodes.map((n, j) => (
                <circle
                  key={`b-${j}`}
                  data-testid={`corr-b-${j}`}
                  cx={n.anchor.x}
                  cy={n.anchor.y}
                  r={4 / zoom}
                  fill="none"
                  stroke="var(--color-text-dim)"
                  strokeWidth={1 / zoom}
                  pointerEvents="all"
                  onPointerUp={(e) => {
                    e.stopPropagation(); // don't let the link drop also pan/select the stage
                    const ai = corrDragRef.current;
                    corrDragRef.current = null;
                    if (ai !== null) useEditor.getState().setCorrespondenceLink(ai, j);
                  }}
                />
              ))}
              {/* grow-from-point markers (dashed) for unreferenced B nodes */}
              {corrOverlay.grow.map((j) => (
                <circle
                  key={`grow-${j}`}
                  data-testid={`grow-target-${j}`}
                  cx={corrOverlay!.to.nodes[j].anchor.x}
                  cy={corrOverlay!.to.nodes[j].anchor.y}
                  r={6 / zoom}
                  fill="none"
                  stroke="var(--color-text-dim)"
                  strokeWidth={1 / zoom}
                  strokeDasharray={`${2 / zoom} ${2 / zoom}`}
                  pointerEvents="none"
                />
              ))}
              {/* links */}
              {corrOverlay.links.map((s) => (
                <line
                  key={`link-${s.ai}`}
                  data-testid={`corr-link-${s.ai}`}
                  x1={s.ax}
                  y1={s.ay}
                  x2={s.bx}
                  y2={s.by}
                  stroke={corrOverlay!.crossing ? 'var(--color-danger)' : 'var(--color-accent)'}
                  strokeWidth={1.5 / zoom}
                  pointerEvents="none"
                />
              ))}
              {/* draggable A handles (start a link drag) */}
              {corrOverlay.from.nodes.map((n, i) => (
                <rect
                  key={`a-${i}`}
                  data-testid={`corr-a-${i}`}
                  x={n.anchor.x - 4 / zoom}
                  y={n.anchor.y - 4 / zoom}
                  width={8 / zoom}
                  height={8 / zoom}
                  fill="var(--color-accent)"
                  style={{ cursor: 'grab' }}
                  onPointerDown={(e) => {
                    e.stopPropagation(); // start a link drag without triggering stage drag/select
                    corrDragRef.current = i;
                  }}
                />
              ))}
            </g>
          )}
        </g>
      </svg>
    </div>
  );
}
