// Framework-neutral scale/resize controller (slice 5, group C2) — single-object scale, multi-
// select group scale, and rect/ellipse resize. Extracted from `Stage/useScaleDrag.ts`, the
// hardest hook. The store is INJECTED (W2); the three snapshots live in closures. Group + single
// scale take a lazy `clientToLocal` port (content coords). RESIZE needs a stage↔object-local
// round-trip built from two SVG CTMs (handle group + content) — that's DOM-bound, so the adapter
// builds it once per resize move and hands it in as a `resizeCoords()` port (null when the handle
// CTM is unavailable, matching the original's early return; `hasContentCtm` flags whether snapping
// can run). Every branch RETURNS a preview descriptor (node/container transforms, the single-scale
// overlay transform, the resize geometry attrs, snap guides) the adapter applies (W5); `end`
// commits the last-previewed result.
import { buildTransform, geometryToSvgAttrs, resolveAnchor, sampleObject } from '@savig/engine';
import type { RenderState } from '@savig/engine';
import {
  SNAP_PX,
  snapScalePoint,
  snapScaleAlongSegment,
  snapPointToGridAxes,
  applyScaleHandleDrag,
  applyHandleResize,
  MIN_SCALE,
  type AABB,
  type HandleId,
  type ScaleResult,
} from '@savig/interaction';
import { selectEditProject } from '@savig/editor-state';
import type { ControllerStore } from './store';
import type { GetPoint, Point } from './coords';
import { pushPreview, type ContainerPreview, type NodeTransform } from './transformPreview';

type GroupItem = { id: string; ox: number; oy: number; osx: number; osy: number; ax: number; ay: number };
export type ScaleGroupSnapshot = {
  pivot: Point;
  corner: Point;
  sxAxis: boolean;
  syAxis: boolean;
  items: GroupItem[];
  targets: AABB[];
  sx: number;
  sy: number;
  moved: boolean;
};
export type ScaleSnapshot = {
  objId: string;
  state: RenderState;
  corner: Point;
  opposite: Point;
  anchorX: number;
  anchorY: number;
  startScaleX: number;
  startScaleY: number;
  baseX: number;
  baseY: number;
  rotationDeg: number;
};
export type ResizeSnapshot = {
  objId: string;
  isEllipse: boolean;
  width: number;
  height: number;
  anchorFracX: number;
  anchorFracY: number;
  baseX: number;
  baseY: number;
  scaleX: number;
  scaleY: number;
  rotationDeg: number;
};

/** The stage↔object-local round-trip the resize snap needs, built by the adapter from the handle-
 *  group + content SVG CTMs. `localX/localY` = the raw pointer in bbox-local coords. */
export interface ResizeCoords {
  localX: number;
  localY: number;
  toStage: (x: number, y: number) => Point;
  toLocal: (x: number, y: number) => Point;
  hasContentCtm: boolean;
}

export interface ScaleMoveCtx {
  clientToLocal: GetPoint; // content coords (group + single scale)
  resizeCoords: () => ResizeCoords | null; // built once per resize move; null if handle CTM missing
  zoom: number;
  bypass: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export interface ScalePreview {
  nodeTransforms: NodeTransform[];
  containerPreviews: ContainerPreview[];
  snapGuides: { x: number | null; y: number | null };
  /** Single-object scale: the scale-handle overlay group's transform. */
  scaleGroupTransform?: string;
  /** Resize: the shape (node.firstElementChild) geometry attributes to write. */
  geometry?: { objId: string; attrs: Record<string, string> };
}

export interface ScaleMoveResult {
  consumed: boolean;
  preview?: ScalePreview;
}

export function makeScaleDragController(store: ControllerStore) {
  let group: ScaleGroupSnapshot | null = null;
  let scale: { snapshot: ScaleSnapshot; targets: AABB[]; last?: ScaleResult } | null = null;
  let resize: {
    handle: HandleId;
    snapshot: ResizeSnapshot;
    targets: AABB[];
    last?: { width: number; height: number; baseX: number; baseY: number };
  } | null = null;

  const beginGroup = (snapshot: ScaleGroupSnapshot) => {
    group = snapshot;
  };
  const beginScale = (s: { snapshot: ScaleSnapshot; targets: AABB[] }) => {
    scale = s;
  };
  const beginResize = (s: { handle: HandleId; snapshot: ResizeSnapshot; targets: AABB[] }) => {
    resize = s;
  };

  const move = (ctx: ScaleMoveCtx): ScaleMoveResult => {
    const snapActive = store.getState().snapEnabled && !ctx.bypass;
    const gridActive = store.getState().gridEnabled && !ctx.bypass;

    const gs = group;
    if (gs) {
      const cur = ctx.clientToLocal();
      if (!cur) return { consumed: true };
      const denomX = gs.corner.x - gs.pivot.x;
      const denomY = gs.corner.y - gs.pivot.y;
      let corner = cur;
      let claimedX = false;
      let claimedY = false;
      let snapGuides: { x: number | null; y: number | null } = { x: null, y: null };
      if (snapActive) {
        const snap = snapScalePoint(cur, gs.sxAxis, gs.syAxis, gs.targets, SNAP_PX / ctx.zoom);
        corner = { x: snap.x, y: snap.y };
        claimedX = snap.guideX !== null;
        claimedY = snap.guideY !== null;
        snapGuides = { x: snap.guideX, y: snap.guideY };
      }
      if (gridActive) {
        corner = snapPointToGridAxes(corner, gs.sxAxis, gs.syAxis, claimedX, claimedY, store.getState().gridSize);
      }
      const sx = gs.sxAxis && Math.abs(denomX) > 1e-6 ? Math.max(MIN_SCALE, (corner.x - gs.pivot.x) / denomX) : 1;
      const sy = gs.syAxis && Math.abs(denomY) > 1e-6 ? Math.max(MIN_SCALE, (corner.y - gs.pivot.y) / denomY) : 1;
      gs.sx = sx;
      gs.sy = sy;
      gs.moved = true;
      const proj = selectEditProject(store.getState());
      const time = store.getState().time;
      const nodeTransforms: NodeTransform[] = [];
      const containerPreviews: ContainerPreview[] = [];
      for (const it of gs.items) {
        const obj = proj.objects.find((o) => o.id === it.id);
        if (!obj) continue;
        const pvx = it.ax + it.ox;
        const pvy = it.ay + it.oy; // the object's anchor point in artboard space
        const nx = gs.pivot.x + sx * (pvx - gs.pivot.x) - it.ax;
        const ny = gs.pivot.y + sy * (pvy - gs.pivot.y) - it.ay;
        const sampled = sampleObject(obj, time);
        const xf = buildTransform({ ...sampled, x: nx, y: ny, scaleX: it.osx * sx, scaleY: it.osy * sy }, it.ax, it.ay);
        const base = { x: nx, y: ny, scaleX: it.osx * sx, scaleY: it.osy * sy, rotation: sampled.rotation, opacity: sampled.opacity };
        pushPreview(obj, proj.assets, it.id, xf, base, nodeTransforms, containerPreviews);
      }
      return { consumed: true, preview: { nodeTransforms, containerPreviews, snapGuides } };
    }

    const sc = scale;
    if (sc) {
      const local = ctx.clientToLocal(); // content coords
      if (!local) return { consumed: true };
      const snap = sc.snapshot;
      let px = local.x;
      let py = local.y;
      const rotOk = Math.abs(snap.rotationDeg) < 1e-6;
      const isCorner = snap.corner.x !== snap.opposite.x && snap.corner.y !== snap.opposite.y;
      const sxAxis = snap.corner.x !== snap.opposite.x;
      const syAxis = snap.corner.y !== snap.opposite.y;
      const constrained = isCorner && (ctx.shiftKey || (ctx.altKey && snapActive));
      let claimedX = false;
      let claimedY = false;
      let snapGuides: { x: number | null; y: number | null } = { x: null, y: null };
      if (snapActive && rotOk) {
        const contentOf = (lx: number, ly: number) => ({
          x: snap.anchorX + snap.startScaleX * (lx - snap.anchorX) + snap.baseX,
          y: snap.anchorY + snap.startScaleY * (ly - snap.anchorY) + snap.baseY,
        });
        const aC = { x: snap.anchorX + snap.baseX, y: snap.anchorY + snap.baseY };
        const cC = contentOf(snap.corner.x, snap.corner.y);
        const oC = contentOf(snap.opposite.x, snap.opposite.y);
        const res =
          ctx.shiftKey && isCorner
            ? snapScaleAlongSegment({ x: px, y: py }, oC, cC, sc.targets, SNAP_PX / ctx.zoom, gridActive ? store.getState().gridSize : undefined)
            : ctx.altKey && isCorner
              ? snapScaleAlongSegment({ x: px, y: py }, aC, cC, sc.targets, SNAP_PX / ctx.zoom, gridActive ? store.getState().gridSize : undefined)
              : snapScalePoint({ x: px, y: py }, sxAxis, syAxis, sc.targets, SNAP_PX / ctx.zoom);
        px = res.x;
        py = res.y;
        claimedX = res.guideX !== null;
        claimedY = res.guideY !== null;
        snapGuides = { x: res.guideX, y: res.guideY };
      }
      if (gridActive && rotOk && !constrained) {
        const gp = snapPointToGridAxes({ x: px, y: py }, sxAxis, syAxis, claimedX, claimedY, store.getState().gridSize);
        px = gp.x;
        py = gp.y;
      }
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
        pointerX: px,
        pointerY: py,
        uniform: ctx.shiftKey,
        fromCenter: ctx.altKey,
      });
      sc.last = r;
      const previewTransform = buildTransform(
        { ...snap.state, scaleX: r.scaleX, scaleY: r.scaleY, x: r.x, y: r.y },
        snap.anchorX,
        snap.anchorY,
      );
      // Single scale writes its own node + the scale-handle overlay (no subtree preview).
      return {
        consumed: true,
        preview: {
          nodeTransforms: [{ id: snap.objId, transform: previewTransform }],
          containerPreviews: [],
          snapGuides,
          scaleGroupTransform: previewTransform,
        },
      };
    }

    const rz = resize;
    if (rz) {
      const rc = ctx.resizeCoords();
      if (!rc) return { consumed: true }; // handle CTM unavailable — consume, no resize
      const snap = rz.snapshot;
      let lx = rc.localX;
      let ly = rc.localY;
      const rotOk = Math.abs(snap.rotationDeg) < 1e-6;
      let snapGuides: { x: number | null; y: number | null } = { x: null, y: null };
      if ((snapActive || gridActive) && rotOk && rc.hasContentCtm) {
        const h = rz.handle;
        const movesLeft = h === 'nw' || h === 'w' || h === 'sw';
        const movesRight = h === 'ne' || h === 'e' || h === 'se';
        const movesTop = h === 'nw' || h === 'n' || h === 'ne';
        const movesBottom = h === 'sw' || h === 's' || h === 'se';
        const sxAxis = movesLeft || movesRight;
        const syAxis = movesTop || movesBottom;
        const isCorner = sxAxis && syAxis;
        const constrained = isCorner && ctx.shiftKey; // uniform / uniform+centre → stays on its diagonal
        const dragged = rc.toStage(rc.localX, rc.localY); // raw pointer in stage space
        let stageX = dragged.x;
        let stageY = dragged.y;
        let claimedX = false;
        let claimedY = false;
        if (snapActive) {
          const draggedCorner = rc.toStage(movesRight ? snap.width : 0, movesBottom ? snap.height : 0);
          const fixedCorner = rc.toStage(movesRight ? 0 : snap.width, movesBottom ? 0 : snap.height);
          const centerPt = rc.toStage(snap.width / 2, snap.height / 2);
          const thr = SNAP_PX / ctx.zoom;
          const res =
            isCorner && ctx.shiftKey && !ctx.altKey
              ? snapScaleAlongSegment(dragged, fixedCorner, draggedCorner, rz.targets, thr, gridActive ? store.getState().gridSize : undefined) // uniform: fixed→dragged diagonal
              : isCorner && ctx.shiftKey && ctx.altKey
                ? snapScaleAlongSegment(dragged, centerPt, draggedCorner, rz.targets, thr, gridActive ? store.getState().gridSize : undefined) // uniform+from-center: centre→dragged
                : snapScalePoint(dragged, sxAxis, syAxis, rz.targets, thr); // free / alt-only: per dragged axis
          stageX = res.x;
          stageY = res.y;
          claimedX = res.guideX !== null;
          claimedY = res.guideY !== null;
          snapGuides = { x: res.guideX, y: res.guideY };
        }
        if (gridActive && !constrained) {
          const gp = snapPointToGridAxes({ x: stageX, y: stageY }, sxAxis, syAxis, claimedX, claimedY, store.getState().gridSize);
          stageX = gp.x;
          stageY = gp.y;
        }
        const back = rc.toLocal(stageX, stageY);
        lx = back.x;
        ly = back.y;
      }
      const r = applyHandleResize({
        handle: rz.handle,
        localX: lx,
        localY: ly,
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
        uniform: ctx.shiftKey,
        fromCenter: ctx.altKey,
      });
      rz.last = r;
      const obj = selectEditProject(store.getState()).objects.find((o) => o.id === snap.objId);
      if (!obj) return { consumed: true, preview: { nodeTransforms: [], containerPreviews: [], snapGuides } };
      const geometry = snap.isEllipse ? { radiusX: r.width / 2, radiusY: r.height / 2 } : { width: r.width, height: r.height };
      const previewState = { ...sampleObject(obj, store.getState().time), x: r.baseX, y: r.baseY, geometry };
      const anchor = resolveAnchor(obj, previewState, snap.isEllipse ? 'ellipse' : 'rect');
      return {
        consumed: true,
        preview: {
          nodeTransforms: [{ id: snap.objId, transform: buildTransform(previewState, anchor.anchorX, anchor.anchorY) }],
          containerPreviews: [],
          snapGuides,
          geometry: { objId: snap.objId, attrs: geometryToSvgAttrs(snap.isEllipse ? 'ellipse' : 'rect', geometry) },
        },
      };
    }
    return { consumed: false };
  };

  const end = (): { consumed: boolean } => {
    const gsUp = group;
    if (gsUp) {
      group = null;
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
        store.getState().setObjectsTransforms(updates);
      }
      return { consumed: true };
    }
    const scUp = scale;
    if (scUp) {
      const snap = scUp.snapshot;
      const last = scUp.last;
      scale = null;
      if (last) {
        const s = store.getState();
        s.selectObject(snap.objId);
        s.setProperties({ scaleX: last.scaleX, scaleY: last.scaleY, x: last.x, y: last.y });
      }
      return { consumed: true };
    }
    const rzUp = resize;
    if (rzUp) {
      const snap = rzUp.snapshot;
      const last = rzUp.last;
      resize = null;
      if (last) {
        const s = store.getState();
        s.selectObject(snap.objId);
        const geom = snap.isEllipse ? { radiusX: last.width / 2, radiusY: last.height / 2 } : { width: last.width, height: last.height };
        s.setProperties({ ...geom, x: last.baseX, y: last.baseY });
      }
      return { consumed: true };
    }
    return { consumed: false };
  };

  return { beginGroup, beginScale, beginResize, move, end };
}

export type ScaleDragController = ReturnType<typeof makeScaleDragController>;
