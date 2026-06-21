import { useEffect, useMemo, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { buildTransform, geometryToSvgAttrs, resolveAnchor, sampleObject } from '../../../engine';
import { useEditor } from '../../store/store';
import { applyFrame } from '../../playback/applyFrame';
import { buildDefs } from './buildDefs';
import { rectFromDrag, type Point } from './drawGeometry';
import { applyHandleResize, handleLocalPositions, HANDLE_IDS, type HandleId } from './resizeHandles';
import styles from './Stage.module.css';

const MIN_DRAW_SIZE = 3;
const HANDLE_SIZE = 8;

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
  const { selectObject } = useEditor.getState();

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
    if (!obj || !asset || asset.kind !== 'vector') return null;
    const state = sampleObject(obj, time);
    const g = state.geometry ?? {};
    const width = asset.shapeType === 'ellipse' ? 2 * (g.radiusX ?? 0) : g.width ?? 0;
    const height = asset.shapeType === 'ellipse' ? 2 * (g.radiusY ?? 0) : g.height ?? 0;
    const anchor = resolveAnchor(obj, state, asset.shapeType);
    return { obj, shapeType: asset.shapeType, state, width, height, transform: buildTransform(state, anchor.anchorX, anchor.anchorY) };
  }, [selectedId, project.objects, assetsById, time]);

  // Imperatively paint the current frame whenever doc/time changes (paused path).
  useEffect(() => {
    applyFrame(nodes, project, time);
  }, [project, time, nodes]);

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
  const previewRef = useRef<SVGRectElement | null>(null);
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
    if (s.activeTool === 'rect' || s.activeTool === 'ellipse') {
      const start = clientToLocal(e.clientX, e.clientY);
      if (start) drawRef.current = { start, end: null };
      return;
    }
    // pen/node pointer handling is wired in a later task; until then only select
    // clears the selection on background click.
    if (s.activeTool === 'select') selectObject(null);
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
      const draw = drawRef.current;
      if (draw) {
        const cur = clientToLocal(e.clientX, e.clientY);
        if (cur) {
          draw.end = cur;
          const rect = previewRef.current;
          if (rect) {
            rect.setAttribute('x', String(Math.min(draw.start.x, cur.x)));
            rect.setAttribute('y', String(Math.min(draw.start.y, cur.y)));
            rect.setAttribute('width', String(Math.abs(cur.x - draw.start.x)));
            rect.setAttribute('height', String(Math.abs(cur.y - draw.start.y)));
            rect.setAttribute('visibility', 'visible');
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
      const draw = drawRef.current;
      if (draw) {
        drawRef.current = null;
        if (previewRef.current) previewRef.current.setAttribute('visibility', 'hidden');
        const s = useEditor.getState();
        if (draw.end && (s.activeTool === 'rect' || s.activeTool === 'ellipse')) {
          const bounds = rectFromDrag(draw.start, draw.end, MIN_DRAW_SIZE);
          if (bounds) s.addVectorShape(s.activeTool, bounds);
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
          {ordered.map((o) => {
            const asset = assetsById.get(o.assetId);
            if (asset?.kind === 'vector') {
              const geometry = sampleObject(o, time).geometry ?? {};
              // Render the shape as a real React element so all attribute values
              // (incl. style.fill/stroke, which may come from a loaded .savig) are
              // escaped by React — no dangerouslySetInnerHTML. Geometry still flows
              // through the shared geometryToSvgAttrs so it matches export/runtime.
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
                    fill={asset.style.fill}
                    stroke={asset.style.stroke}
                    strokeWidth={asset.style.strokeWidth}
                  />
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
        </g>
      </svg>
    </div>
  );
}
