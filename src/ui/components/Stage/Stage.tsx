import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { applyGradientHandleDrag, brushParams, buildTransform, flattenInstances, geometryToSvgAttrs, gradientHandlePositions, identityCorrespondence, isRenderHidden, objectKeyframeTimes, onionSkinTimes, paintRef, pathBounds, pathToD, pathToDRings, resolveAnchor, sampleObject, samplePath, shapeLocalBBox, strokeToPath } from '../../../engine';
import type { Gradient, GradientHandleId, LocalRect, PathData, Project, RenderState, SceneObject, Transform2D } from '../../../engine';
import { computeSnap, aabbIntersect, groupBBox, groupAABB, instanceAABB, entityAABB, isSymbolInstance, objectAABB, resolveObjectAnchor, SNAP_PX, type AABB } from './snapping';
import { rotateHandleLocal, rotationFromDrag, type Pt } from './rotateHandle';
import { useEditor } from '../../store/store';
import { selectEditablePath, selectEditedShapeKeyframe } from '../../store/selectors';
import { isOrderPreserving, unreferencedTargets, linkSegments } from './correspondenceOverlay';
import { applyFrame } from '../../playback/applyFrame';
import { buildDefs } from './buildDefs';
import { rectFromDrag, primitivePathFromDrag, primitiveSpecFromDrag, type Point } from './drawGeometry';
import { applyHandleResize, handleLocalPositions, HANDLE_IDS, type HandleId } from './resizeHandles';
import {
  applyScaleHandleDrag,
  scaleHandleLocalPositions,
  oppositeHandle,
  SCALE_HANDLE_IDS,
  MIN_SCALE,
  type ScaleHandleId,
  type ScaleResult,
} from './scaleHandles';
import { usePathTools } from './usePathTools';
import { nearFirstAnchor, hitTestSegment } from './pathHitTest';
import styles from './Stage.module.css';

const MIN_DRAW_SIZE = 3;
const HANDLE_SIZE = 8;
const ROTATE_STALK = 24;
const ONION_COUNT = 2;
const ONION_OPACITY = [0.55, 0.3];

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
  /** Snapping (slice 33): the dragged object's stage AABB at drag start + snap targets. */
  baseAABB: AABB | null;
  targets: AABB[];
  /** Multi-object move (slice 37): all selected origins; commit via nudgeSelected on up. */
  multi?: { items: { id: string; ox: number; oy: number }[]; dx: number; dy: number };
}

export function Stage({ nodes }: { nodes: Map<string, SVGGraphicsElement> }) {
  const project = useEditor((s) => s.history.present);
  const time = useEditor((s) => s.time);
  const selectedId = useEditor((s) => s.selectedObjectId);
  const selectedIds = useEditor((s) => s.selectedObjectIds);
  const zoom = useEditor((s) => s.zoom);
  const onionSkin = useEditor((s) => s.onionSkin);
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
  // The drawable skeleton: flattenInstances expands symbol instances into composite-id leaves
  // (renderId == object id for a non-instanced object, so non-symbol scenes are unchanged). Each
  // leaf gets a DOM node keyed by renderId so the imperative painter (applyFrame, keyed by the
  // same renderId) finds it. Instances are atomic in 47a — pointer/selection routes to the
  // top-level ancestor (renderId before the first '/'); bbox handles for instances land in 47b.
  const renderLeaves = useMemo(() => flattenInstances(project, time), [project, time]);

  // The currently-selected vector object plus its resolved render data, used to
  // draw the resize-handle overlay in the object's local space.
  const selectedVector = useMemo(() => {
    if (!selectedId || selectedIds.length !== 1) return null; // group handles take over for >1
    const obj = project.objects.find((o) => o.id === selectedId);
    const asset = obj ? assetsById.get(obj.assetId) : undefined;
    // Paths are move-only under the select tool: no bbox-resize overlay (their
    // geometry is edited via the node tool). Only rect/ellipse get resize handles.
    if (!obj || obj.hidden || obj.locked || !asset || asset.kind !== 'vector' || asset.shapeType === 'path') return null;
    const state = sampleObject(obj, time);
    const g = state.geometry ?? {};
    const width = asset.shapeType === 'ellipse' ? 2 * (g.radiusX ?? 0) : g.width ?? 0;
    const height = asset.shapeType === 'ellipse' ? 2 * (g.radiusY ?? 0) : g.height ?? 0;
    const anchor = resolveAnchor(obj, state, asset.shapeType);
    return { obj, shapeType: asset.shapeType, state, width, height, transform: buildTransform(state, anchor.anchorX, anchor.anchorY) };
  }, [selectedId, selectedIds, project.objects, assetsById, time]);

  // The selected vector object's gradient + the bbox/transform needed to draw the
  // on-canvas handle overlay (select tool only). Edits fill gradient if present,
  // else stroke; reflects the SAMPLED gradient at the playhead.
  const selectedGradient = useMemo(() => {
    if (activeTool !== 'select' || !selectedId || selectedIds.length !== 1) return null;
    const obj = project.objects.find((o) => o.id === selectedId);
    const asset = obj ? assetsById.get(obj.assetId) : undefined;
    if (!obj || obj.hidden || obj.locked || !asset || asset.kind !== 'vector') return null;
    const state = sampleObject(obj, time);
    const fillG = state.fillGradient ?? asset.style.fillGradient;
    const strokeG = state.strokeGradient ?? asset.style.strokeGradient;
    const property: 'fill' | 'stroke' | null = fillG ? 'fill' : strokeG ? 'stroke' : null;
    if (!property) return null;
    const gradient = (property === 'fill' ? fillG : strokeG)!;
    const sampledPath =
      asset.shapeType === 'path' ? state.path ?? asset.path ?? { nodes: [], closed: false } : undefined;
    const bbox: LocalRect = shapeLocalBBox(asset.shapeType, state.geometry ?? {}, sampledPath);
    const anchor = resolveAnchor(obj, state, asset.shapeType, sampledPath ? pathBounds(sampledPath) : undefined);
    const transform = buildTransform(state, anchor.anchorX, anchor.anchorY);
    return { obj, property, gradient, bbox, transform };
  }, [activeTool, selectedId, selectedIds, project.objects, assetsById, time]);

  // The selected vector object's bbox + anchor + transform for the rotate-handle
  // overlay (select tool only). Covers rect/ellipse AND path (unlike selectedVector).
  const selectedRotatable = useMemo(() => {
    if (activeTool !== 'select' || !selectedId || selectedIds.length !== 1) return null;
    const obj = project.objects.find((o) => o.id === selectedId);
    const asset = obj ? assetsById.get(obj.assetId) : undefined;
    if (!obj || obj.hidden || obj.locked || !asset) return null;
    const state = sampleObject(obj, time);
    let bbox: LocalRect;
    let anchorX: number;
    let anchorY: number;
    if (asset.kind === 'vector') {
      const sampledPath =
        asset.shapeType === 'path' ? state.path ?? asset.path ?? { nodes: [], closed: false } : undefined;
      bbox = shapeLocalBBox(asset.shapeType, state.geometry ?? {}, sampledPath);
      const pathBox = sampledPath ? pathBounds(sampledPath) : undefined;
      const anchor = resolveAnchor(obj, state, asset.shapeType, pathBox);
      anchorX = anchor.anchorX;
      anchorY = anchor.anchorY;
    } else if (asset.kind === 'svg') {
      // An imported-SVG object's local box is its intrinsic size; its anchor is absolute
      // (addObject seeds anchorX/Y = width/2,height/2 with no 'fraction' anchorMode), so
      // resolveAnchor returns (obj.anchorX, obj.anchorY) directly — shapeType is irrelevant.
      bbox = { x: 0, y: 0, width: asset.width, height: asset.height };
      const anchor = resolveAnchor(obj, state, undefined);
      anchorX = anchor.anchorX;
      anchorY = anchor.anchorY;
    } else {
      return null; // audio etc. — no rotate handle
    }
    const transform = buildTransform(state, anchorX, anchorY);
    return { obj, state, bbox, anchorX, anchorY, transform };
  }, [activeTool, selectedId, selectedIds, project.objects, assetsById, time]);

  // Path & imported-SVG objects get on-canvas SCALE handles (Transform2D.scaleX/scaleY).
  // Rect/ellipse use the geometry-resize overlay (selectedVector) instead — mutually exclusive.
  const selectedScalable = useMemo(() => {
    if (activeTool !== 'select' || !selectedId || selectedIds.length !== 1) return null;
    const obj = project.objects.find((o) => o.id === selectedId);
    const asset = obj ? assetsById.get(obj.assetId) : undefined;
    if (!obj || obj.hidden || obj.locked || !asset) return null;
    const state = sampleObject(obj, time);
    let bbox: LocalRect;
    let anchorX: number;
    let anchorY: number;
    if (asset.kind === 'vector' && asset.shapeType === 'path') {
      const sampledPath = state.path ?? asset.path ?? { nodes: [], closed: false };
      bbox = shapeLocalBBox('path', state.geometry ?? {}, sampledPath);
      const anchor = resolveAnchor(obj, state, 'path', pathBounds(sampledPath));
      anchorX = anchor.anchorX;
      anchorY = anchor.anchorY;
    } else if (asset.kind === 'svg') {
      bbox = { x: 0, y: 0, width: asset.width, height: asset.height };
      const anchor = resolveAnchor(obj, state, undefined);
      anchorX = anchor.anchorX;
      anchorY = anchor.anchorY;
    } else {
      return null; // rect/ellipse (resize) and audio
    }
    const transform = buildTransform(state, anchorX, anchorY);
    return { obj, state, bbox, anchorX, anchorY, transform };
  }, [activeTool, selectedId, selectedIds, project.objects, assetsById, time]);

  // The group bounding box (union of the selected objects' AABBs) for the multi-select
  // scale handles (slice 40). Only for a >1 selection; single objects use their own handles.
  const groupBounds = useMemo(() => {
    if (activeTool !== 'select') return null;
    // A single selected GROUP container shows the bbox handles too (slice 45b) — its bbox is
    // the children union mapped through the group transform.
    if (selectedIds.length === 1) {
      const only = project.objects.find((o) => o.id === selectedIds[0]);
      if (!only) return null;
      // A single GROUP or a single symbol INSTANCE (both node-less containers) shows the bbox
      // handles; its box is the children/scene union mapped through the container transform (47b).
      if (only.isGroup) return groupAABB(only, project.objects, project.assets, time);
      if (isSymbolInstance(only, project.assets)) return instanceAABB(only, project.assets, time);
      return null;
    }
    if (selectedIds.length <= 1) return null;
    const boxes: AABB[] = [];
    for (const id of selectedIds) {
      const o = project.objects.find((x) => x.id === id);
      if (!o || o.hidden || o.locked) continue;
      const a = objectAABB(o, assetsById.get(o.assetId), time);
      if (a) boxes.push(a);
    }
    return groupBBox(boxes);
  }, [activeTool, selectedIds, project.objects, project.assets, assetsById, time]);

  // Onion-skin ghosts: the selected vector object sampled at its neighbouring
  // keyframe times. Editor-only chrome; null when off / no selection / no ghosts.
  const onionGhosts = useMemo(() => {
    if (!onionSkin || !selectedId) return null;
    const obj = project.objects.find((o) => o.id === selectedId);
    const asset = obj ? assetsById.get(obj.assetId) : undefined;
    if (!obj || obj.hidden || obj.locked || !asset || asset.kind !== 'vector') return null;
    const { before, after } = onionSkinTimes(objectKeyframeTimes(obj), time, ONION_COUNT);
    if (before.length === 0 && after.length === 0) return null;
    return { obj, asset, before, after };
  }, [onionSkin, selectedId, project.objects, assetsById, time]);

  // The selected path's node overlay (node tool only): the path data to draw
  // (the in-progress drag preview when present, else the committed path) plus the
  // object transform so the overlay sits in the object's local space.
  const selectedPath = useMemo(() => {
    if (activeTool !== 'node' || !selectedId) return null;
    const obj = project.objects.find((o) => o.id === selectedId);
    if (!obj || obj.hidden || obj.locked) return null;
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
  // Gradient-handle drag: the live preview gradient (drives re-render) + a ref with
  // the immutable start + latest gradient (commit reads the ref, StrictMode-safe).
  const gradientHandleGroupRef = useRef<SVGGElement | null>(null);
  const gradientDragRef = useRef<{
    id: GradientHandleId;
    property: 'fill' | 'stroke';
    bbox: LocalRect;
    start: Gradient;
    current: Gradient;
  } | null>(null);
  const [gradientDrag, setGradientDrag] = useState<{ property: 'fill' | 'stroke'; gradient: Gradient } | null>(null);
  const [snapGuides, setSnapGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });
  const [dragOffset, setDragOffset] = useState<{ dx: number; dy: number } | null>(null);
  const marqueeRef = useRef<{ start: { x: number; y: number }; additive: boolean; moved: boolean; rect: AABB | null } | null>(null);
  const groupScaleRef = useRef<{
    pivot: { x: number; y: number };
    corner: { x: number; y: number };
    sxAxis: boolean;
    syAxis: boolean;
    items: { id: string; ox: number; oy: number; osx: number; osy: number; ax: number; ay: number }[];
    sx: number;
    sy: number;
    moved: boolean;
  } | null>(null);
  const groupRotateRef = useRef<{
    center: { x: number; y: number };
    start: { x: number; y: number };
    items: { id: string; ox: number; oy: number; orot: number; ax: number; ay: number }[];
    theta: number;
    moved: boolean;
  } | null>(null);
  const [marquee, setMarquee] = useState<AABB | null>(null);
  const onGradientHandlePointerDown = (id: GradientHandleId, e: ReactPointerEvent) => {
    if (!selectedGradient) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    gradientDragRef.current = {
      id,
      property: selectedGradient.property,
      bbox: selectedGradient.bbox,
      start: selectedGradient.gradient,
      current: selectedGradient.gradient,
    };
    setGradientDrag({ property: selectedGradient.property, gradient: selectedGradient.gradient });
  };
  // Rotate-handle drag: pivot (resolved anchor mapped to screen, captured once at
  // pointer-down, invariant under rotation) + the snapshotted state; commit reads
  // the ref (StrictMode-safe).
  const rotateHandleGroupRef = useRef<SVGGElement | null>(null);
  const rotateRef = useRef<{
    objId: string;
    pivot: Pt;
    start: Pt;
    startRotation: number;
    anchorX: number;
    anchorY: number;
    state: RenderState;
    last: number | undefined;
  } | null>(null);
  const onRotateHandlePointerDown = (e: ReactPointerEvent) => {
    // Transform editing flows through keyframes (setProperty is autoKey-gated), so the
    // handle rotates only when auto-key is on — consistent with the resize handles.
    if (!selectedRotatable || !useEditor.getState().autoKey) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const group = rotateHandleGroupRef.current;
    const ctm = group?.getScreenCTM();
    const svg = group?.ownerSVGElement;
    if (!group || !ctm || !svg) return;
    // The resolved anchor mapped to screen = the rotation pivot (invariant under rot).
    const p = svg.createSVGPoint();
    p.x = selectedRotatable.anchorX;
    p.y = selectedRotatable.anchorY;
    const pivot = p.matrixTransform(ctm);
    rotateRef.current = {
      objId: selectedRotatable.obj.id,
      pivot: { x: pivot.x, y: pivot.y },
      start: { x: e.clientX, y: e.clientY },
      startRotation: selectedRotatable.state.rotation,
      anchorX: selectedRotatable.anchorX,
      anchorY: selectedRotatable.anchorY,
      state: selectedRotatable.state,
      last: undefined,
    };
  };
  // Scale-handle drag (imported-svg & path): snapshot the start transform; each move
  // maps the pointer to content space and recomputes scale+translation (opposite corner
  // fixed). Commit reads the ref (StrictMode-safe).
  const scaleGroupRef = useRef<SVGGElement | null>(null);
  const scaleRef = useRef<{
    snapshot: {
      objId: string;
      state: RenderState;
      corner: { x: number; y: number };
      opposite: { x: number; y: number };
      anchorX: number;
      anchorY: number;
      startScaleX: number;
      startScaleY: number;
      baseX: number;
      baseY: number;
      rotationDeg: number;
    };
    last?: ScaleResult;
  } | null>(null);
  const onScaleHandlePointerDown = (id: ScaleHandleId, e: ReactPointerEvent) => {
    if (!selectedScalable) return;
    // Claim the gesture before the autoKey gate (like the resize handles) so an
    // autoKey-off click on a handle is a clean no-op and does NOT bubble to the
    // background and deselect the object.
    e.stopPropagation();
    if (!useEditor.getState().autoKey) return; // transform edits flow through keyframes
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const corners = scaleHandleLocalPositions(selectedScalable.bbox);
    scaleRef.current = {
      snapshot: {
        objId: selectedScalable.obj.id,
        state: selectedScalable.state,
        corner: corners[id],
        opposite: corners[oppositeHandle(id)],
        anchorX: selectedScalable.anchorX,
        anchorY: selectedScalable.anchorY,
        startScaleX: selectedScalable.state.scaleX,
        startScaleY: selectedScalable.state.scaleY,
        baseX: selectedScalable.state.x,
        baseY: selectedScalable.state.y,
        rotationDeg: selectedScalable.state.rotation,
      },
    };
  };
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
    if (s.activeTool === 'select') {
      if (e.button !== 0) return;
      // Begin a marquee (rubber-band) selection; a non-drag click deselects on release.
      const start = clientToLocal(e.clientX, e.clientY);
      if (!start) {
        selectObject(null);
        return;
      }
      marqueeRef.current = { start, additive: e.shiftKey, moved: false, rect: null };
    }
  };

  const onSvgDoubleClick = () => {
    if (useEditor.getState().penDrafting) pathTools.finishPen(false);
  };

  const onObjectPointerDown = (id: string, e: ReactPointerEvent) => {
    const target = useEditor.getState().history.present.objects.find((o) => o.id === id);
    if (target?.locked) return; // inert: bubble to background -> deselect
    e.stopPropagation();
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      useEditor.getState().toggleObjectOrGroup(id); // selection-building gesture: no move-drag (slice 42: whole group)
      return;
    }
    // Dragging a member of an existing multi-selection moves the whole set (slice 37).
    // Otherwise collapse to the clicked object's GROUP (slice 42) — which may itself be
    // several objects, so we must re-read the selection AFTER expansion to decide whether
    // this is a single- or multi-object drag (a one-gesture click-drag on a grouped
    // object must move the whole group, not just the clicked member).
    const ids = useEditor.getState().selectedObjectIds;
    const alreadyMulti = ids.includes(id) && ids.length > 1;
    if (!alreadyMulti) useEditor.getState().selectObjectOrGroup(id);
    // A grouped object resolves to its GROUP container (slice 45b): the drag moves the whole
    // group as a unit — preview its children, commit via nudgeSelected (selectedObjectIds is
    // now [groupId]) which keyframes the group when auto-key is on (animatable, 45d) else its
    // base. Groups always begin a move-drag (regardless of auto-key). Snap the children-bbox
    // like a multi-move (slice 44).
    const grp =
      !alreadyMulti
        ? useEditor.getState().history.present.objects.find(
            (o) => o.id === useEditor.getState().selectedObjectId && o.isGroup,
          )
        : undefined;
    if (grp) {
      const proj = useEditor.getState().history.present;
      const t = useEditor.getState().time;
      const children = proj.objects.filter((o) => o.parentId === grp.id);
      const items = children.map((o) => {
        const sm = sampleObject(o, t);
        return { id: o.id, ox: sm.x, oy: sm.y };
      });
      const childIds = new Set(children.map((o) => o.id));
      const memberBoxes: AABB[] = [];
      const targets: AABB[] = [];
      for (const o of proj.objects) {
        if (o.isGroup) continue;
        const box = objectAABB(o, proj.assets.find((a) => a.id === o.assetId), t);
        if (!box) continue;
        if (childIds.has(o.id)) memberBoxes.push(box);
        else targets.push(box);
      }
      targets.push({ minX: 0, minY: 0, maxX: proj.meta.width, maxY: proj.meta.height });
      dragRef.current = {
        id: grp.id, startX: e.clientX, startY: e.clientY, originX: 0, originY: 0, curX: 0, curY: 0, moved: false,
        baseAABB: groupBBox(memberBoxes), targets, multi: { items, dx: 0, dy: 0 },
      };
      return;
    }
    // Only begin a move-drag when auto-key is on (editing is otherwise blocked).
    if (!useEditor.getState().autoKey) return;
    const dragIds = alreadyMulti ? ids : useEditor.getState().selectedObjectIds;
    if (dragIds.length > 1) {
      const proj = useEditor.getState().history.present;
      const t = useEditor.getState().time;
      // The MOVING objects: each selected entity, expanding a group container to its children
      // (a group has no node — it previews via its children; the commit moves the group's
      // base because nudgeSelected reads selectedObjectIds, which still holds the group id).
      const moving = dragIds.flatMap((sid) => {
        const o = proj.objects.find((ob) => ob.id === sid);
        if (!o || o.locked) return [];
        return o.isGroup ? proj.objects.filter((c) => c.parentId === o.id) : [o];
      });
      const items = moving.map((o) => {
        const s = sampleObject(o, t);
        return { id: o.id, ox: s.x, oy: s.y };
      });
      // Snap (slice 44): the group bbox of the MOVING objects, plus snap targets = every
      // other object's stage AABB + the artboard (mirrors single-drag).
      const sel = new Set(moving.map((o) => o.id));
      const memberBoxes: AABB[] = [];
      const targets: AABB[] = [];
      for (const o of proj.objects) {
        if (o.isGroup) continue; // group containers have no box of their own
        const box = objectAABB(o, proj.assets.find((as) => as.id === o.assetId), t);
        if (!box) continue;
        if (sel.has(o.id)) {
          memberBoxes.push(box);
        } else {
          targets.push(box);
        }
      }
      targets.push({ minX: 0, minY: 0, maxX: proj.meta.width, maxY: proj.meta.height });
      dragRef.current = {
        id, startX: e.clientX, startY: e.clientY, originX: 0, originY: 0, curX: 0, curY: 0, moved: false,
        baseAABB: groupBBox(memberBoxes), targets, multi: { items, dx: 0, dy: 0 },
      };
      return;
    }
    const obj = useEditor.getState().history.present.objects.find((o) => o.id === id);
    if (!obj) return;
    const origin = sampleObject(obj, useEditor.getState().time);
    // Snapping targets: every other object's stage AABB + the artboard (slice 33).
    const proj = useEditor.getState().history.present;
    const dragTime = useEditor.getState().time;
    const targets: AABB[] = [];
    for (const o of proj.objects) {
      if (o.id === id) continue;
      const a = objectAABB(o, assetsById.get(o.assetId), dragTime);
      if (a) targets.push(a);
    }
    targets.push({ minX: 0, minY: 0, maxX: proj.meta.width, maxY: proj.meta.height });
    dragRef.current = {
      id, startX: e.clientX, startY: e.clientY,
      originX: origin.x, originY: origin.y, curX: origin.x, curY: origin.y, moved: false,
      baseAABB: objectAABB(obj, assetsById.get(obj.assetId), dragTime), targets,
    };
  };

  // Begin a group-scale drag from a handle on the multi-selection bbox (slice 40). Captures
  // each object's origin transform + resolved anchor; commits via setObjectsTransforms on up.
  // Live-preview a group container's handle drag: a group has no DOM node, so compose the
  // in-progress group transform (`prefix`) onto each child's node — exactly the 45a
  // computeFrame composition. On release the commit writes the group base and applyFrame
  // re-renders identically (slice 45b).
  const previewGroupChildren = (proj: Project, groupId: string, time: number, prefix: string) => {
    for (const child of proj.objects.filter((o) => o.parentId === groupId)) {
      const node = nodes.get(child.id);
      if (!node) continue;
      const cs = sampleObject(child, time);
      const r = resolveObjectAnchor(child, proj.assets.find((a) => a.id === child.assetId), cs);
      node.setAttribute('transform', `${prefix} ${buildTransform(cs, r ? r.anchorX : child.anchorX, r ? r.anchorY : child.anchorY)}`);
    }
  };

  // Live-preview a symbol INSTANCE's handle/move drag: an instance has no DOM node of its own
  // (it renders as flattened composite-id leaves), so repaint the stage from a project where THIS
  // instance carries the in-progress transform as a static base (tracks stripped so it samples to
  // `base`). Reuses computeFrame/applyFrame — the exact commit path — so the preview matches the
  // committed result by construction (slice 47b, mirrors previewGroupChildren).
  const previewInstanceChildren = (proj: Project, instance: SceneObject, time: number, base: Transform2D) => {
    const previewObj = { ...instance, base, tracks: {} };
    const previewProj = { ...proj, objects: proj.objects.map((o) => (o.id === instance.id ? previewObj : o)) };
    applyFrame(nodes, previewProj, time);
  };

  // True when exactly one GROUP container is selected (its bbox handles edit the group's
  // transform — keyframed when auto-key is on, base when off; slices 45b/45d).
  const isSingleGroupSelected = () => {
    const ids = useEditor.getState().selectedObjectIds;
    return ids.length === 1 && !!useEditor.getState().history.present.objects.find((o) => o.id === ids[0] && o.isGroup);
  };

  const onGroupHandlePointerDown = (hid: HandleId, e: ReactPointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId); // robust drag delivery (like the other handles)
    if (!groupBounds) return;
    // A single GROUP transforms regardless of auto-key (the commit keyframes it when auto-key
    // is on, else writes base — 45d).
    if (!isSingleGroupSelected() && !useEditor.getState().autoKey) return;
    const w = groupBounds.maxX - groupBounds.minX;
    const h = groupBounds.maxY - groupBounds.minY;
    const pos = handleLocalPositions(w, h);
    const opp = oppositeHandle(hid as ScaleHandleId);
    const corner = { x: groupBounds.minX + pos[hid].x, y: groupBounds.minY + pos[hid].y };
    const pivot = { x: groupBounds.minX + pos[opp].x, y: groupBounds.minY + pos[opp].y };
    const sxAxis = hid === 'e' || hid === 'w' || hid.length === 2; // corners + left/right edges
    const syAxis = hid === 'n' || hid === 's' || hid.length === 2; // corners + top/bottom edges
    const proj = useEditor.getState().history.present;
    const t = useEditor.getState().time;
    const items = selectedIds
      .map((id) => proj.objects.find((o) => o.id === id))
      .filter((o): o is SceneObject => !!o && !o.locked && !o.hidden)
      .map((o) => {
        const st = sampleObject(o, t);
        const r = resolveObjectAnchor(o, proj.assets.find((a) => a.id === o.assetId), st);
        return { id: o.id, ox: st.x, oy: st.y, osx: st.scaleX, osy: st.scaleY, ax: r ? r.anchorX : o.anchorX, ay: r ? r.anchorY : o.anchorY };
      });
    groupScaleRef.current = { pivot, corner, sxAxis, syAxis, items, sx: 1, sy: 1, moved: false };
  };

  // Begin a group-rotate drag from the handle above the multi-selection bbox (slice 41).
  const onGroupRotatePointerDown = (e: ReactPointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (!groupBounds) return;
    if (!isSingleGroupSelected() && !useEditor.getState().autoKey) return;
    const start = clientToLocal(e.clientX, e.clientY);
    if (!start) return;
    const center = { x: (groupBounds.minX + groupBounds.maxX) / 2, y: (groupBounds.minY + groupBounds.maxY) / 2 };
    const proj = useEditor.getState().history.present;
    const t = useEditor.getState().time;
    const items = selectedIds
      .map((id) => proj.objects.find((o) => o.id === id))
      .filter((o): o is SceneObject => !!o && !o.locked && !o.hidden)
      .map((o) => {
        const st = sampleObject(o, t);
        const r = resolveObjectAnchor(o, proj.assets.find((a) => a.id === o.assetId), st);
        return { id: o.id, ox: st.x, oy: st.y, orot: st.rotation, ax: r ? r.anchorX : o.anchorX, ay: r ? r.anchorY : o.anchorY };
      });
    groupRotateRef.current = { center, start, items, theta: 0, moved: false };
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const gs = groupScaleRef.current;
      if (gs) {
        const cur = clientToLocal(e.clientX, e.clientY);
        if (!cur) return;
        const denomX = gs.corner.x - gs.pivot.x;
        const denomY = gs.corner.y - gs.pivot.y;
        const sx = gs.sxAxis && Math.abs(denomX) > 1e-6 ? Math.max(MIN_SCALE, (cur.x - gs.pivot.x) / denomX) : 1;
        const sy = gs.syAxis && Math.abs(denomY) > 1e-6 ? Math.max(MIN_SCALE, (cur.y - gs.pivot.y) / denomY) : 1;
        gs.sx = sx;
        gs.sy = sy;
        gs.moved = true;
        const proj = useEditor.getState().history.present;
        const time = useEditor.getState().time;
        for (const it of gs.items) {
          const obj = proj.objects.find((o) => o.id === it.id);
          if (!obj) continue;
          const pvx = it.ax + it.ox;
          const pvy = it.ay + it.oy; // the object's anchor point in artboard space
          const nx = gs.pivot.x + sx * (pvx - gs.pivot.x) - it.ax;
          const ny = gs.pivot.y + sy * (pvy - gs.pivot.y) - it.ay;
          const sampled = sampleObject(obj, time);
          const xf = buildTransform({ ...sampled, x: nx, y: ny, scaleX: it.osx * sx, scaleY: it.osy * sy }, it.ax, it.ay);
          const node = nodes.get(it.id);
          if (node) node.setAttribute('transform', xf);
          else if (obj.isGroup) previewGroupChildren(proj, obj.id, time, xf); // group has no node — preview its children
          else if (isSymbolInstance(obj, proj.assets))
            previewInstanceChildren(proj, obj, time, { x: nx, y: ny, scaleX: it.osx * sx, scaleY: it.osy * sy, rotation: sampled.rotation, opacity: sampled.opacity }); // instance has no node — preview its leaves
        }
        return;
      }
      const gr = groupRotateRef.current;
      if (gr) {
        const cur = clientToLocal(e.clientX, e.clientY);
        if (!cur) return;
        const theta = rotationFromDrag(gr.center, gr.start, cur, 0); // degrees swept about the centre
        gr.theta = theta;
        gr.moved = true;
        const rad = (theta * Math.PI) / 180;
        const c = Math.cos(rad);
        const s = Math.sin(rad);
        const proj = useEditor.getState().history.present;
        const time = useEditor.getState().time;
        for (const it of gr.items) {
          const obj = proj.objects.find((o) => o.id === it.id);
          if (!obj) continue;
          const dx = it.ax + it.ox - gr.center.x; // object anchor point relative to the group centre
          const dy = it.ay + it.oy - gr.center.y;
          const nx = gr.center.x + (c * dx - s * dy) - it.ax;
          const ny = gr.center.y + (s * dx + c * dy) - it.ay;
          const sampled = sampleObject(obj, time);
          const xf = buildTransform({ ...sampled, x: nx, y: ny, rotation: it.orot + theta }, it.ax, it.ay);
          const node = nodes.get(it.id);
          if (node) node.setAttribute('transform', xf);
          else if (obj.isGroup) previewGroupChildren(proj, obj.id, time, xf); // group has no node — preview its children
          else if (isSymbolInstance(obj, proj.assets))
            previewInstanceChildren(proj, obj, time, { x: nx, y: ny, scaleX: sampled.scaleX, scaleY: sampled.scaleY, rotation: it.orot + theta, opacity: sampled.opacity }); // instance has no node — preview its leaves
        }
        return;
      }
      const sc = scaleRef.current;
      if (sc) {
        const local = clientToLocal(e.clientX, e.clientY); // content coords
        if (!local) return;
        const snap = sc.snapshot;
        const r = applyScaleHandleDrag({
          corner: snap.corner,
          opposite: snap.opposite,
          anchorX: snap.anchorX,
          anchorY: snap.anchorY,
          startScaleX: snap.startScaleX,
          startScaleY: snap.startScaleY,
          baseX: snap.baseX,
          baseY: snap.baseY,
          rotationDeg: snap.rotationDeg,
          pointerX: local.x,
          pointerY: local.y,
          uniform: e.shiftKey,
          fromCenter: e.altKey,
        });
        sc.last = r;
        const previewTransform = buildTransform(
          { ...snap.state, scaleX: r.scaleX, scaleY: r.scaleY, x: r.x, y: r.y },
          snap.anchorX,
          snap.anchorY,
        );
        const node = nodes.get(snap.objId);
        if (node) node.setAttribute('transform', previewTransform);
        if (scaleGroupRef.current) scaleGroupRef.current.setAttribute('transform', previewTransform);
        return;
      }
      const rot = rotateRef.current;
      if (rot) {
        const next = rotationFromDrag(rot.pivot, rot.start, { x: e.clientX, y: e.clientY }, rot.startRotation);
        rot.last = next;
        const previewTransform = buildTransform({ ...rot.state, rotation: next }, rot.anchorX, rot.anchorY);
        const node = nodes.get(rot.objId);
        if (node) node.setAttribute('transform', previewTransform);
        const group = rotateHandleGroupRef.current;
        if (group) group.setAttribute('transform', previewTransform);
        return;
      }
      const gd = gradientDragRef.current;
      if (gd) {
        const group = gradientHandleGroupRef.current;
        const ctm = group?.getScreenCTM();
        const svg = group?.ownerSVGElement;
        if (!group || !ctm || !svg) return;
        const pt = svg.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;
        const local = pt.matrixTransform(ctm.inverse());
        const next = applyGradientHandleDrag(gd.start, gd.id, { x: local.x, y: local.y }, gd.bbox);
        gd.current = next;
        setGradientDrag({ property: gd.property, gradient: next });
        return;
      }
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
              { polygonSides: st.polygonSides, starPoints: st.starPoints, starInnerRatio: st.starInnerRatio, cornerRadius: st.primitiveCornerRadius },
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
          uniform: e.shiftKey,
          fromCenter: e.altKey,
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
      const mq = marqueeRef.current;
      if (mq) {
        const cur = clientToLocal(e.clientX, e.clientY);
        if (!cur) return;
        mq.moved = true;
        const rect: AABB = {
          minX: Math.min(mq.start.x, cur.x),
          minY: Math.min(mq.start.y, cur.y),
          maxX: Math.max(mq.start.x, cur.x),
          maxY: Math.max(mq.start.y, cur.y),
        };
        mq.rect = rect; // keep on the ref so onUp reads it fresh (the listener closure is stale)
        setMarquee(rect);
        return;
      }
      const d = dragRef.current;
      if (!d) return;
      const z = useEditor.getState().zoom ?? 1;
      if (d.multi) {
        // Move-drag the whole selection; snap the GROUP bbox to other objects + the
        // artboard (slice 44). Preview each member at its origin + the snapped delta;
        // one commit on pointer-up (nudgeSelected uses the corrected d.multi.dx/dy).
        const rawdx = (e.clientX - d.startX) / z;
        const rawdy = (e.clientY - d.startY) / z;
        let dx = rawdx;
        let dy = rawdy;
        if (useEditor.getState().snapEnabled && d.baseAABB) {
          const moving: AABB = {
            minX: d.baseAABB.minX + rawdx,
            maxX: d.baseAABB.maxX + rawdx,
            minY: d.baseAABB.minY + rawdy,
            maxY: d.baseAABB.maxY + rawdy,
          };
          const snap = computeSnap(moving, d.targets, SNAP_PX / z);
          dx = rawdx + snap.dx;
          dy = rawdy + snap.dy;
          setSnapGuides({ x: snap.guideX, y: snap.guideY });
        } else {
          setSnapGuides({ x: null, y: null });
        }
        d.multi.dx = dx;
        d.multi.dy = dy;
        d.moved = true;
        const proj = useEditor.getState().history.present;
        const time = useEditor.getState().time;
        for (const it of d.multi.items) {
          const obj = proj.objects.find((o) => o.id === it.id);
          const node = nodes.get(it.id);
          if (!obj || !node) continue;
          const sampled = sampleObject(obj, time);
          const resolved = resolveObjectAnchor(obj, proj.assets.find((a) => a.id === obj.assetId), sampled);
          const ax = resolved ? resolved.anchorX : obj.anchorX;
          const ay = resolved ? resolved.anchorY : obj.anchorY;
          node.setAttribute('transform', buildTransform({ ...sampled, x: it.ox + dx, y: it.oy + dy }, ax, ay));
        }
        setDragOffset({ dx, dy });
        return;
      }
      // Raw (unsnapped) pointer position; snapping is applied fresh each move (no feedback).
      const rawX = d.originX + (e.clientX - d.startX) / z;
      const rawY = d.originY + (e.clientY - d.startY) / z;
      if (useEditor.getState().snapEnabled && d.baseAABB) {
        const moving: AABB = {
          minX: d.baseAABB.minX + (rawX - d.originX),
          maxX: d.baseAABB.maxX + (rawX - d.originX),
          minY: d.baseAABB.minY + (rawY - d.originY),
          maxY: d.baseAABB.maxY + (rawY - d.originY),
        };
        const snap = computeSnap(moving, d.targets, SNAP_PX / z);
        d.curX = rawX + snap.dx;
        d.curY = rawY + snap.dy;
        setSnapGuides({ x: snap.guideX, y: snap.guideY });
      } else {
        d.curX = rawX;
        d.curY = rawY;
        setSnapGuides({ x: null, y: null });
      }
      setDragOffset({ dx: d.curX - d.originX, dy: d.curY - d.originY }); // outline follows
      d.moved = true;
      // Live preview only: write the transform imperatively to the node, without
      // committing — the single history entry is pushed once on pointer-up so a
      // whole drag is one undo step.
      const proj = useEditor.getState().history.present;
      const obj = proj.objects.find((o) => o.id === d.id);
      const node = nodes.get(d.id);
      if (obj && node) {
        const sampled = sampleObject(obj, useEditor.getState().time);
        // Resolve the absolute pivot (vector anchors are fractional) so the previewed
        // transform matches the committed one for rotated/scaled objects.
        const resolved = resolveObjectAnchor(obj, proj.assets.find((a) => a.id === obj.assetId), sampled);
        const ax = resolved ? resolved.anchorX : obj.anchorX;
        const ay = resolved ? resolved.anchorY : obj.anchorY;
        node.setAttribute('transform', buildTransform({ ...sampled, x: d.curX, y: d.curY }, ax, ay));
      }
    };
    const onUp = () => {
      const gsUp = groupScaleRef.current;
      if (gsUp) {
        groupScaleRef.current = null;
        if (gsUp.moved) {
          const updates = gsUp.items.map((it) => {
            const pvx = it.ax + it.ox;
            const pvy = it.ay + it.oy;
            return {
              id: it.id,
              x: gsUp.pivot.x + gsUp.sx * (pvx - gsUp.pivot.x) - it.ax,
              y: gsUp.pivot.y + gsUp.sy * (pvy - gsUp.pivot.y) - it.ay,
              scaleX: it.osx * gsUp.sx,
              scaleY: it.osy * gsUp.sy,
            };
          });
          useEditor.getState().setObjectsTransforms(updates);
        }
        return;
      }
      const grUp = groupRotateRef.current;
      if (grUp) {
        groupRotateRef.current = null;
        if (grUp.moved) {
          const rad = (grUp.theta * Math.PI) / 180;
          const c = Math.cos(rad);
          const s = Math.sin(rad);
          const updates = grUp.items.map((it) => {
            const dx = it.ax + it.ox - grUp.center.x;
            const dy = it.ay + it.oy - grUp.center.y;
            return {
              id: it.id,
              x: grUp.center.x + (c * dx - s * dy) - it.ax,
              y: grUp.center.y + (s * dx + c * dy) - it.ay,
              rotation: it.orot + grUp.theta,
            };
          });
          useEditor.getState().setObjectsTransforms(updates);
        }
        return;
      }
      const mq = marqueeRef.current;
      if (mq) {
        marqueeRef.current = null;
        const rect = mq.rect;
        setMarquee(null);
        if (mq.moved && rect) {
          const proj = useEditor.getState().history.present;
          const t = useEditor.getState().time;
          // Resolve assets from the fresh project (this window-listener closure captured a
          // stale `assetsById` from mount, when the project may have had no objects).
          // isRenderHidden so a child of a HIDDEN group isn't marquee-hit (else it would
          // resolve to and select the invisible group — slice 45c).
          const mqById = new Map(proj.objects.map((o) => [o.id, o] as const));
          const hits = proj.objects
            .filter((o) => !isRenderHidden(o, mqById) && !o.locked)
            .filter((o) => {
              const a = objectAABB(o, proj.assets.find((as) => as.id === o.assetId), t);
              return a ? aabbIntersect(rect, a) : false;
            })
            .map((o) => o.id);
          if (mq.additive) {
            const cur = useEditor.getState().selectedObjectIds;
            useEditor.getState().selectObjectsExpandingGroups([...cur, ...hits]); // slice 42: marquee hit -> whole group
          } else {
            useEditor.getState().selectObjectsExpandingGroups(hits);
          }
        } else if (!mq.additive) {
          useEditor.getState().selectObject(null); // a plain background click deselects
        }
        return;
      }
      const scUp = scaleRef.current;
      if (scUp) {
        const snap = scUp.snapshot;
        const last = scUp.last;
        scaleRef.current = null;
        if (last) {
          const s = useEditor.getState();
          s.selectObject(snap.objId);
          s.setProperties({ scaleX: last.scaleX, scaleY: last.scaleY, x: last.x, y: last.y });
        }
        return;
      }
      const rotUp = rotateRef.current;
      if (rotUp) {
        rotateRef.current = null;
        if (rotUp.last !== undefined) {
          useEditor.getState().selectObject(rotUp.objId);
          useEditor.getState().setProperty('rotation', rotUp.last);
        }
        return;
      }
      const gradUp = gradientDragRef.current;
      if (gradUp) {
        gradientDragRef.current = null;
        const finalGradient = gradUp.current;
        setGradientDrag(null);
        // applyGradientHandleDrag returns a fresh object on every move, so
        // current === start means no drag happened -> skip the no-op commit.
        if (finalGradient !== gradUp.start) {
          useEditor.getState().setVectorGradient(gradUp.property, finalGradient);
        }
        return;
      }
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
        } else if (draw.end && (s.activeTool === 'polygon' || s.activeTool === 'star')) {
          // Polygon/star stamp a PARAMETRIC primitive (re-editable in the Inspector).
          const spec = primitiveSpecFromDrag(
            s.activeTool,
            draw.start,
            draw.end,
            { polygonSides: s.polygonSides, starPoints: s.starPoints, starInnerRatio: s.starInnerRatio, cornerRadius: s.primitiveCornerRadius },
            MIN_DRAW_SIZE,
          );
          if (spec) s.addPrimitive(spec);
        } else if (draw.end && s.activeTool === 'line') {
          const path = primitivePathFromDrag(
            'line',
            draw.start,
            draw.end,
            { polygonSides: s.polygonSides, starPoints: s.starPoints, starInnerRatio: s.starInnerRatio, cornerRadius: s.primitiveCornerRadius },
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
      if (d?.multi) {
        if (d.moved) useEditor.getState().nudgeSelected(d.multi.dx, d.multi.dy); // one commit, all selected
      } else if (d && d.moved) {
        useEditor.getState().selectObject(d.id);
        useEditor.getState().setProperties({ x: d.curX, y: d.curY }); // already snapped
      }
      if (d) {
        setSnapGuides({ x: null, y: null });
        setDragOffset(null);
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
          {onionGhosts &&
            (() => {
              const { obj, asset } = onionGhosts;
              const ghost = (ghostTime: number, tint: string, opacity: number, key: string) => {
                const gs = sampleObject(obj, ghostTime);
                if (asset.shapeType === 'path') {
                  const path = gs.path ?? asset.path ?? { nodes: [], closed: false };
                  const anchor = resolveAnchor(obj, gs, 'path', pathBounds(path));
                  return (
                    <g key={key} transform={buildTransform(gs, anchor.anchorX, anchor.anchorY)} opacity={opacity}>
                      <path
                        data-testid={key}
                        d={pathToD(path)}
                        fill={tint}
                        fillOpacity={0.18}
                        stroke={tint}
                        strokeWidth={1.5 / zoom}
                      />
                    </g>
                  );
                }
                const anchor = resolveAnchor(obj, gs, asset.shapeType);
                const ShapeTag = asset.shapeType === 'rect' ? 'rect' : 'ellipse';
                return (
                  <g key={key} transform={buildTransform(gs, anchor.anchorX, anchor.anchorY)} opacity={opacity}>
                    <ShapeTag
                      data-testid={key}
                      {...geometryToSvgAttrs(asset.shapeType, gs.geometry ?? {})}
                      fill={tint}
                      fillOpacity={0.18}
                      stroke={tint}
                      strokeWidth={1.5 / zoom}
                    />
                  </g>
                );
              };
              return (
                <g data-testid="onion-skins" pointerEvents="none">
                  {onionGhosts.before.map((t, i) =>
                    ghost(t, 'var(--onion-before)', ONION_OPACITY[i] ?? 0.2, `onion-ghost-before-${i}`),
                  )}
                  {onionGhosts.after.map((t, i) =>
                    ghost(t, 'var(--onion-after)', ONION_OPACITY[i] ?? 0.2, `onion-ghost-after-${i}`),
                  )}
                </g>
              );
            })()}
          {renderLeaves.map((leaf) => {
            const o = leaf.object;
            const renderId = leaf.renderId;
            const topId = renderId.split('/')[0]; // instances are atomic in 47a: route to the top-level ancestor
            const asset = assetsById.get(o.assetId);
            if (asset?.kind === 'vector') {
              // Render shapes as real React elements so all attribute values (incl.
              // style.fill/stroke and the path `d`, which may derive from a loaded
              // .savig) are escaped by React — no dangerouslySetInnerHTML.
              // Effective gradients = the playhead sample (animated track) or the
              // static asset gradient. Matches the export's resolution exactly so the
              // editor preview shows the gradient even when it lives only on a track.
              const sampledObj = sampleObject(o, time);
              // During a gradient-handle drag, preview the in-progress gradient on
              // the dragged object's paint so the fill/stroke updates live.
              const dragG = gradientDrag && selectedGradient?.obj.id === o.id ? gradientDrag : null;
              const fillGrad =
                dragG?.property === 'fill'
                  ? dragG.gradient
                  : (sampledObj.fillGradient ?? asset.style.fillGradient);
              const strokeGrad =
                dragG?.property === 'stroke'
                  ? dragG.gradient
                  : (sampledObj.strokeGradient ?? asset.style.strokeGradient);
              // Dash: pathLength-normalized; offset = sampled (animated) ?? static.
              // Spread into both shape branches; undefined props are omitted by React.
              const dashed = !!asset.style.strokeDasharray && asset.style.strokeDasharray.length > 0;
              const dashProps = dashed
                ? {
                    strokeDasharray: asset.style.strokeDasharray!.join(' '),
                    pathLength: 1,
                    strokeDashoffset: sampledObj.strokeDashoffset ?? asset.style.strokeDashoffset ?? 0,
                  }
                : {};
              if (asset.shapeType === 'path') {
                return (
                  <g
                    key={renderId}
                    ref={register(renderId)}
                    data-testid={`object-${renderId}`}
                    data-savig-object={renderId}
                    data-selected={topId === selectedId}
                    className={styles.object}
                    onPointerDown={(e) => onObjectPointerDown(topId, e)}
                  >
                    <path
                      d={
                        o.shapeTrack && o.shapeTrack.length > 0
                          ? pathToD(samplePath(o.shapeTrack, time))
                          : asset.path
                            ? pathToDRings(asset.path, asset.compoundRings)
                            : ''
                      }
                      fillRule={asset.compoundRings && asset.compoundRings.length > 0 ? 'evenodd' : undefined}
                      fill={fillGrad ? paintRef(`savig-grad-${renderId}-fill`) : asset.style.fill}
                      stroke={strokeGrad ? paintRef(`savig-grad-${renderId}-stroke`) : asset.style.stroke}
                      strokeWidth={asset.style.strokeWidth}
                      strokeLinecap={asset.style.strokeLinecap}
                      strokeLinejoin={asset.style.strokeLinejoin}
                      {...dashProps}
                    />
                    {fillGrad && <GradientEl id={`savig-grad-${renderId}-fill`} g={fillGrad} />}
                    {strokeGrad && <GradientEl id={`savig-grad-${renderId}-stroke`} g={strokeGrad} />}
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
                  key={renderId}
                  ref={register(renderId)}
                  data-testid={`object-${renderId}`}
                  data-savig-object={renderId}
                  data-selected={topId === selectedId}
                  className={styles.object}
                  onPointerDown={(e) => onObjectPointerDown(topId, e)}
                >
                  <ShapeTag
                    {...geomAttrs}
                    fill={fillGrad ? paintRef(`savig-grad-${renderId}-fill`) : asset.style.fill}
                    stroke={strokeGrad ? paintRef(`savig-grad-${renderId}-stroke`) : asset.style.stroke}
                    strokeWidth={asset.style.strokeWidth}
                    strokeLinecap={asset.style.strokeLinecap}
                    strokeLinejoin={asset.style.strokeLinejoin}
                    {...dashProps}
                  />
                  {fillGrad && <GradientEl id={`savig-grad-${renderId}-fill`} g={fillGrad} />}
                  {strokeGrad && <GradientEl id={`savig-grad-${renderId}-stroke`} g={strokeGrad} />}
                </g>
              );
            }
            return (
              <use
                key={renderId}
                ref={register(renderId)}
                data-testid={`object-${renderId}`}
                data-savig-object={renderId}
                data-selected={topId === selectedId}
                className={styles.object}
                href={`#savig-asset-${o.assetId}`}
                onPointerDown={(e) => onObjectPointerDown(topId, e)}
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
          {selectedScalable && (
            <g ref={scaleGroupRef} transform={selectedScalable.transform} data-testid="scale-handles">
              {SCALE_HANDLE_IDS.map((id) => {
                const pos = scaleHandleLocalPositions(selectedScalable.bbox)[id];
                const size = HANDLE_SIZE / zoom;
                return (
                  <rect
                    key={id}
                    data-testid={`scale-handle-${id}`}
                    x={pos.x - size / 2}
                    y={pos.y - size / 2}
                    width={size}
                    height={size}
                    fill="var(--color-accent)"
                    stroke="var(--color-panel)"
                    style={{ cursor: 'pointer' }}
                    onPointerDown={(e) => onScaleHandlePointerDown(id, e)}
                  />
                );
              })}
            </g>
          )}
          {selectedGradient && (
            <g
              ref={gradientHandleGroupRef}
              transform={selectedGradient.transform}
              data-testid="gradient-handles"
            >
              {(() => {
                const liveGradient = gradientDrag?.gradient ?? selectedGradient.gradient;
                const handles = gradientHandlePositions(liveGradient, selectedGradient.bbox);
                const size = HANDLE_SIZE / zoom;
                const byId = Object.fromEntries(handles.map((h) => [h.id, h] as const));
                const lines =
                  liveGradient.type === 'linear'
                    ? ([['start', 'end']] as const)
                    : ([['center', 'radius'], ['center', 'focal']] as const);
                return (
                  <>
                    {lines.map(([a, b]) =>
                      byId[a] && byId[b] ? (
                        <line
                          key={`${a}-${b}`}
                          x1={byId[a].x}
                          y1={byId[a].y}
                          x2={byId[b].x}
                          y2={byId[b].y}
                          stroke="var(--color-accent)"
                          strokeWidth={1 / zoom}
                          pointerEvents="none"
                        />
                      ) : null,
                    )}
                    {handles.map((h) => (
                      <circle
                        key={h.id}
                        data-testid={`gradient-handle-${h.id}`}
                        cx={h.x}
                        cy={h.y}
                        r={size / 2}
                        fill="var(--color-panel)"
                        stroke="var(--color-accent)"
                        strokeWidth={1 / zoom}
                        style={{ cursor: 'pointer' }}
                        onPointerDown={(e) => onGradientHandlePointerDown(h.id, e)}
                      />
                    ))}
                  </>
                );
              })()}
            </g>
          )}
          {selectedRotatable && (
            <g
              ref={rotateHandleGroupRef}
              transform={selectedRotatable.transform}
              data-testid="rotate-handle-overlay"
            >
              {(() => {
                const { base, handle } = rotateHandleLocal(selectedRotatable.bbox, ROTATE_STALK / zoom);
                const size = HANDLE_SIZE / zoom;
                return (
                  <>
                    <line
                      x1={base.x}
                      y1={base.y}
                      x2={handle.x}
                      y2={handle.y}
                      stroke="var(--color-accent)"
                      strokeWidth={1 / zoom}
                      pointerEvents="none"
                    />
                    <circle
                      data-testid="rotate-handle"
                      cx={handle.x}
                      cy={handle.y}
                      r={size / 2}
                      fill="var(--color-panel)"
                      stroke="var(--color-accent)"
                      strokeWidth={1 / zoom}
                      style={{ cursor: 'pointer' }}
                      onPointerDown={onRotateHandlePointerDown}
                    />
                  </>
                );
              })()}
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
            if (!sel?.motionPath || sel.hidden || sel.locked) return null;
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
          {/* Multi-select outlines (slice 36): a thin dashed box per selected object.
              Handles (single-object) draw above; this just makes the set visible. */}
          {selectedIds.map((sid) => {
            const o = project.objects.find((x) => x.id === sid);
            const a = o && !o.hidden ? objectAABB(o, assetsById.get(o.assetId), time) : null;
            // Only objects that actually move follow the drag offset; a locked member
            // (excluded from the multi-drag) keeps its outline put (slice 37 review).
            const off = dragOffset && o && !o.locked ? dragOffset : null;
            return a ? (
              <rect
                key={`sel-${sid}`}
                data-testid={`selection-outline-${sid}`}
                x={a.minX + (off?.dx ?? 0)}
                y={a.minY + (off?.dy ?? 0)}
                width={a.maxX - a.minX}
                height={a.maxY - a.minY}
                fill="none"
                stroke="var(--color-accent)"
                strokeWidth={1 / zoom}
                strokeDasharray={`${3 / zoom} ${3 / zoom}`}
                pointerEvents="none"
              />
            ) : null;
          })}
          {/* Group scale handles for a multi-selection (slice 40). */}
          {groupBounds && (
            <g data-testid="group-handles">
              <rect
                x={groupBounds.minX}
                y={groupBounds.minY}
                width={groupBounds.maxX - groupBounds.minX}
                height={groupBounds.maxY - groupBounds.minY}
                fill="none"
                stroke="var(--color-accent)"
                strokeWidth={1 / zoom}
                pointerEvents="none"
              />
              {HANDLE_IDS.map((hid) => {
                const p = handleLocalPositions(groupBounds.maxX - groupBounds.minX, groupBounds.maxY - groupBounds.minY)[hid];
                return (
                  <rect
                    key={hid}
                    data-testid={`group-handle-${hid}`}
                    x={groupBounds.minX + p.x - 4 / zoom}
                    y={groupBounds.minY + p.y - 4 / zoom}
                    width={8 / zoom}
                    height={8 / zoom}
                    fill="var(--color-accent)"
                    onPointerDown={(e) => onGroupHandlePointerDown(hid, e)}
                  />
                );
              })}
              {/* Rotate handle: a stalk + circle above the group bbox top-centre (slice 41). */}
              <line
                x1={(groupBounds.minX + groupBounds.maxX) / 2}
                y1={groupBounds.minY}
                x2={(groupBounds.minX + groupBounds.maxX) / 2}
                y2={groupBounds.minY - ROTATE_STALK / zoom}
                stroke="var(--color-accent)"
                strokeWidth={1 / zoom}
                pointerEvents="none"
              />
              <circle
                data-testid="group-rotate-handle"
                cx={(groupBounds.minX + groupBounds.maxX) / 2}
                cy={groupBounds.minY - ROTATE_STALK / zoom}
                r={5 / zoom}
                fill="var(--color-accent)"
                onPointerDown={onGroupRotatePointerDown}
              />
            </g>
          )}
          {/* Marquee (rubber-band) selection rect (slice 38). */}
          {marquee && (
            <rect
              data-testid="marquee"
              x={marquee.minX}
              y={marquee.minY}
              width={marquee.maxX - marquee.minX}
              height={marquee.maxY - marquee.minY}
              fill="var(--color-accent)"
              fillOpacity={0.08}
              stroke="var(--color-accent)"
              strokeWidth={1 / zoom}
              strokeDasharray={`${3 / zoom} ${3 / zoom}`}
              pointerEvents="none"
            />
          )}
          {/* Alignment guides for the active move-drag snap (slice 33). */}
          {snapGuides.x !== null && (
            <line
              data-testid="snap-guide-x"
              x1={snapGuides.x}
              y1={-100000}
              x2={snapGuides.x}
              y2={100000}
              stroke="var(--color-accent)"
              strokeWidth={1 / zoom}
              pointerEvents="none"
            />
          )}
          {snapGuides.y !== null && (
            <line
              data-testid="snap-guide-y"
              x1={-100000}
              y1={snapGuides.y}
              x2={100000}
              y2={snapGuides.y}
              stroke="var(--color-accent)"
              strokeWidth={1 / zoom}
              pointerEvents="none"
            />
          )}
        </g>
      </svg>
    </div>
  );
}
