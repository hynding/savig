import { useRef, type RefObject } from 'react';
import { buildTransform, geometryToSvgAttrs, resolveAnchor, sampleObject } from '@savig/engine';
import type { Project, RenderState, SceneObject, Transform2D } from '@savig/engine';
import { useEditor } from '../../store/store';
import { selectEditProject } from '../../store/selectors';
import { SNAP_PX, isSymbolInstance, type AABB } from './snapping';
import { snapScalePoint, snapScaleAlongSegment } from './scaleSnap';
import { snapPointToGridAxes } from './gridSnap';
import { applyScaleHandleDrag, MIN_SCALE, type ScaleResult } from './scaleHandles';
import { applyHandleResize, type HandleId } from './resizeHandles';

/** Stage-runtime values the scale/resize previews need, captured once where the global pointer
 *  effect is registered (so capture semantics — notably the mount value of `zoom` — match the
 *  prior inline branches exactly). */
export interface ScaleDragCtx {
  nodes: Map<string, SVGGraphicsElement>;
  zoom: number;
  clientToLocal: (clientX: number, clientY: number) => { x: number; y: number } | null;
  setSnapGuides: (g: { x: number | null; y: number | null }) => void;
  contentRef: RefObject<SVGGElement | null>;
  handleGroupRef: RefObject<SVGGElement | null>;
  scaleGroupRef: RefObject<SVGGElement | null>;
  previewGroupChildren: (proj: Project, group: SceneObject, time: number, base: Transform2D) => void;
  previewInstanceChildren: (proj: Project, instance: SceneObject, time: number, base: Transform2D) => void;
}

type GroupItem = { id: string; ox: number; oy: number; osx: number; osy: number; ax: number; ay: number };
type GroupSnapshot = {
  pivot: { x: number; y: number };
  corner: { x: number; y: number };
  sxAxis: boolean;
  syAxis: boolean;
  items: GroupItem[];
  targets: AABB[];
  sx: number;
  sy: number;
  moved: boolean;
};
type ScaleSnapshot = {
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
type ResizeSnapshot = {
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

const snapFor = (e: PointerEvent) => {
  const noBypass = !(e.metaKey || e.ctrlKey);
  return {
    snapActive: useEditor.getState().snapEnabled && noBypass,
    gridActive: useEditor.getState().gridEnabled && noBypass,
  };
};

/** Scale-handle dragging — single object, multi-selection group scale, and rect/ellipse resize.
 *  Extracted from Stage.tsx (no behavior change). Owns all three interaction refs; Stage's
 *  pointer-down handlers snapshot from their derived memos and call begin*. `move`/`end` are
 *  delegated from the shared onMove/onUp (the three + the other drags are mutually exclusive, so
 *  the call position is immaterial) and return true while a scale/resize is in progress. */
export function useScaleDrag() {
  const groupRef = useRef<GroupSnapshot | null>(null);
  const scaleRef = useRef<{ snapshot: ScaleSnapshot; targets: AABB[]; last?: ScaleResult } | null>(null);
  const resizeRef = useRef<{ handle: HandleId; snapshot: ResizeSnapshot; targets: AABB[]; last?: { width: number; height: number; baseX: number; baseY: number } } | null>(null);

  const beginGroup = (snapshot: GroupSnapshot) => {
    groupRef.current = snapshot;
  };
  const beginScale = (s: { snapshot: ScaleSnapshot; targets: AABB[] }) => {
    scaleRef.current = s;
  };
  const beginResize = (s: { handle: HandleId; snapshot: ResizeSnapshot; targets: AABB[] }) => {
    resizeRef.current = s;
  };

  const move = (e: PointerEvent, ctx: ScaleDragCtx): boolean => {
    const { snapActive, gridActive } = snapFor(e);
    const gs = groupRef.current;
    if (gs) {
      const cur = ctx.clientToLocal(e.clientX, e.clientY);
      if (!cur) return true;
      const denomX = gs.corner.x - gs.pivot.x;
      const denomY = gs.corner.y - gs.pivot.y;
      // Snap the dragged corner to other objects' edges/centers + the artboard (slice scale-snap).
      let corner = cur;
      let claimedX = false;
      let claimedY = false;
      if (snapActive) {
        const snap = snapScalePoint(cur, gs.sxAxis, gs.syAxis, gs.targets, SNAP_PX / ctx.zoom);
        corner = { x: snap.x, y: snap.y };
        claimedX = snap.guideX !== null;
        claimedY = snap.guideY !== null;
        ctx.setSnapGuides({ x: snap.guideX, y: snap.guideY });
      } else {
        ctx.setSnapGuides({ x: null, y: null }); // snap toggled off mid-drag -> drop any stale guide
      }
      if (gridActive) {
        // grid-snap the dragged corner on axes object-snap didn't claim (group scale is free per-axis)
        corner = snapPointToGridAxes(corner, gs.sxAxis, gs.syAxis, claimedX, claimedY, useEditor.getState().gridSize);
      }
      const sx = gs.sxAxis && Math.abs(denomX) > 1e-6 ? Math.max(MIN_SCALE, (corner.x - gs.pivot.x) / denomX) : 1;
      const sy = gs.syAxis && Math.abs(denomY) > 1e-6 ? Math.max(MIN_SCALE, (corner.y - gs.pivot.y) / denomY) : 1;
      gs.sx = sx;
      gs.sy = sy;
      gs.moved = true;
      const proj = selectEditProject(useEditor.getState());
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
        const node = ctx.nodes.get(it.id);
        if (node) node.setAttribute('transform', xf);
        else if (obj.isGroup)
          ctx.previewGroupChildren(proj, obj, time, { x: nx, y: ny, scaleX: it.osx * sx, scaleY: it.osy * sy, rotation: sampled.rotation, opacity: sampled.opacity }); // group has no node — preview its subtree
        else if (isSymbolInstance(obj, proj.assets))
          ctx.previewInstanceChildren(proj, obj, time, { x: nx, y: ny, scaleX: it.osx * sx, scaleY: it.osy * sy, rotation: sampled.rotation, opacity: sampled.opacity }); // instance has no node — preview its leaves
      }
      return true;
    }
    const sc = scaleRef.current;
    if (sc) {
      const local = ctx.clientToLocal(e.clientX, e.clientY); // content coords
      if (!local) return true;
      const snap = sc.snapshot;
      // Snap the dragged corner to other objects' edges/centers + the artboard (slice scale-snap).
      // Adjust the POINTER onto (constraint ∩ guide) so applyScaleHandleDrag's own projection is a
      // no-op and the edge lands on the guide. Only when snap is on AND the object is axis-aligned.
      let px = local.x;
      let py = local.y;
      const rotOk = Math.abs(snap.rotationDeg) < 1e-6;
      const isCorner = snap.corner.x !== snap.opposite.x && snap.corner.y !== snap.opposite.y;
      const sxAxis = snap.corner.x !== snap.opposite.x;
      const syAxis = snap.corner.y !== snap.opposite.y;
      // Shift (uniform) always projects onto a diagonal so grid is skipped. Alt (from-centre)
      // projects onto the anchor→corner ray ONLY in the object-snap path; applyScaleHandleDrag's
      // own alt scaling is free per-axis, so grid is valid for alt when object-snap is off.
      const constrained = isCorner && (e.shiftKey || (e.altKey && snapActive));
      let claimedX = false;
      let claimedY = false;
      if (snapActive && rotOk) {
        const contentOf = (lx: number, ly: number) => ({
          x: snap.anchorX + snap.startScaleX * (lx - snap.anchorX) + snap.baseX,
          y: snap.anchorY + snap.startScaleY * (ly - snap.anchorY) + snap.baseY,
        });
        const aC = { x: snap.anchorX + snap.baseX, y: snap.anchorY + snap.baseY };
        const cC = contentOf(snap.corner.x, snap.corner.y);
        const oC = contentOf(snap.opposite.x, snap.opposite.y);
        const res =
          e.shiftKey && isCorner
            ? snapScaleAlongSegment({ x: px, y: py }, oC, cC, sc.targets, SNAP_PX / ctx.zoom, gridActive ? useEditor.getState().gridSize : undefined)
            : e.altKey && isCorner
              ? snapScaleAlongSegment({ x: px, y: py }, aC, cC, sc.targets, SNAP_PX / ctx.zoom, gridActive ? useEditor.getState().gridSize : undefined)
              : snapScalePoint({ x: px, y: py }, sxAxis, syAxis, sc.targets, SNAP_PX / ctx.zoom);
        px = res.x;
        py = res.y;
        claimedX = res.guideX !== null;
        claimedY = res.guideY !== null;
        ctx.setSnapGuides({ x: res.guideX, y: res.guideY });
      } else {
        ctx.setSnapGuides({ x: null, y: null }); // snap off / rotated mid-drag -> drop any stale guide
      }
      if (gridActive && rotOk && !constrained) {
        // grid-snap the dragged corner/edge on unclaimed axes (free scale only — keeps the diagonal intact)
        const gp = snapPointToGridAxes({ x: px, y: py }, sxAxis, syAxis, claimedX, claimedY, useEditor.getState().gridSize);
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
        uniform: e.shiftKey,
        fromCenter: e.altKey,
      });
      sc.last = r;
      const previewTransform = buildTransform(
        { ...snap.state, scaleX: r.scaleX, scaleY: r.scaleY, x: r.x, y: r.y },
        snap.anchorX,
        snap.anchorY,
      );
      const node = ctx.nodes.get(snap.objId);
      if (node) node.setAttribute('transform', previewTransform);
      if (ctx.scaleGroupRef.current) ctx.scaleGroupRef.current.setAttribute('transform', previewTransform);
      return true;
    }
    const rz = resizeRef.current;
    if (rz) {
      const group = ctx.handleGroupRef.current;
      const ctm = group?.getScreenCTM();
      const svg = group?.ownerSVGElement;
      if (!group || !ctm || !svg) return true;
      const ptn = svg.createSVGPoint();
      ptn.x = e.clientX;
      ptn.y = e.clientY;
      const local = ptn.matrixTransform(ctm.inverse());
      const snap = rz.snapshot;
      let lx = local.x;
      let ly = local.y;
      // Snap the dragged corner/edge to other objects' edges/centers + the artboard
      // (slice scale-snap 2/2) and/or the grid. Targets are STAGE-space, but applyHandleResize
      // wants the pointer in OBJECT-LOCAL coords; so snap in stage space then convert back. Only
      // when the object is axis-aligned (rotation≈0), matching the scale handler.
      const cg = ctx.contentRef.current;
      const cctm = cg?.getScreenCTM();
      const rotOk = Math.abs(snap.rotationDeg) < 1e-6;
      if ((snapActive || gridActive) && rotOk && cctm) {
        const cctmInv = cctm.inverse();
        const ctmInv = ctm.inverse();
        // One transform at a time (jsdom's matrixTransform result isn't chainable). local(bbox) ->
        // screen -> content, and the inverse, so we snap in stage space.
        const xform = (m: DOMMatrix, x: number, y: number) => {
          const p = svg.createSVGPoint();
          p.x = x;
          p.y = y;
          const q = p.matrixTransform(m);
          return { x: q.x, y: q.y };
        };
        const toStage = (x: number, y: number) => {
          const s2 = xform(ctm, x, y);
          return xform(cctmInv, s2.x, s2.y);
        };
        const toLocal = (x: number, y: number) => {
          const s2 = xform(cctm, x, y);
          return xform(ctmInv, s2.x, s2.y);
        };
        const h = rz.handle;
        const movesLeft = h === 'nw' || h === 'w' || h === 'sw';
        const movesRight = h === 'ne' || h === 'e' || h === 'se';
        const movesTop = h === 'nw' || h === 'n' || h === 'ne';
        const movesBottom = h === 'sw' || h === 's' || h === 'se';
        const sxAxis = movesLeft || movesRight;
        const syAxis = movesTop || movesBottom;
        const isCorner = sxAxis && syAxis;
        const constrained = isCorner && e.shiftKey; // uniform / uniform+centre → stays on its diagonal
        const dragged = toStage(local.x, local.y); // raw pointer in stage space
        let stageX = dragged.x;
        let stageY = dragged.y;
        let claimedX = false;
        let claimedY = false;
        if (snapActive) {
          // Start positions (stage space) of the bbox corners that define the constraint lines —
          // mirrors applyHandleResize's `fixed`/`dragged`/`centre`.
          const draggedCorner = toStage(movesRight ? snap.width : 0, movesBottom ? snap.height : 0);
          const fixedCorner = toStage(movesRight ? 0 : snap.width, movesBottom ? 0 : snap.height);
          const centerPt = toStage(snap.width / 2, snap.height / 2);
          const thr = SNAP_PX / ctx.zoom;
          const res =
            isCorner && e.shiftKey && !e.altKey
              ? snapScaleAlongSegment(dragged, fixedCorner, draggedCorner, rz.targets, thr, gridActive ? useEditor.getState().gridSize : undefined) // uniform: fixed→dragged diagonal
              : isCorner && e.shiftKey && e.altKey
                ? snapScaleAlongSegment(dragged, centerPt, draggedCorner, rz.targets, thr, gridActive ? useEditor.getState().gridSize : undefined) // uniform+from-center: centre→dragged
                : snapScalePoint(dragged, sxAxis, syAxis, rz.targets, thr); // free / alt-only: per dragged axis
          stageX = res.x;
          stageY = res.y;
          claimedX = res.guideX !== null;
          claimedY = res.guideY !== null;
          ctx.setSnapGuides({ x: res.guideX, y: res.guideY });
        } else {
          ctx.setSnapGuides({ x: null, y: null });
        }
        if (gridActive && !constrained) {
          // grid-snap the dragged edge/corner in stage space on unclaimed axes (free resize only)
          const gp = snapPointToGridAxes({ x: stageX, y: stageY }, sxAxis, syAxis, claimedX, claimedY, useEditor.getState().gridSize);
          stageX = gp.x;
          stageY = gp.y;
        }
        const back = toLocal(stageX, stageY);
        lx = back.x;
        ly = back.y;
      } else {
        ctx.setSnapGuides({ x: null, y: null }); // snap off / rotated mid-drag -> drop any stale guide
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
        uniform: e.shiftKey,
        fromCenter: e.altKey,
      });
      rz.last = r;
      const node = ctx.nodes.get(snap.objId);
      const obj = selectEditProject(useEditor.getState()).objects.find((o) => o.id === snap.objId);
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
      return true;
    }
    return false;
  };

  const end = (ctx: Pick<ScaleDragCtx, 'setSnapGuides'>): boolean => {
    const gsUp = groupRef.current;
    if (gsUp) {
      groupRef.current = null;
      ctx.setSnapGuides({ x: null, y: null }); // clear scale-snap guides
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
      return true;
    }
    const scUp = scaleRef.current;
    if (scUp) {
      const snap = scUp.snapshot;
      const last = scUp.last;
      scaleRef.current = null;
      ctx.setSnapGuides({ x: null, y: null }); // clear scale-snap guides
      if (last) {
        const s = useEditor.getState();
        s.selectObject(snap.objId);
        s.setProperties({ scaleX: last.scaleX, scaleY: last.scaleY, x: last.x, y: last.y });
      }
      return true;
    }
    const rz = resizeRef.current;
    if (rz) {
      const snap = rz.snapshot;
      const last = rz.last;
      resizeRef.current = null;
      ctx.setSnapGuides({ x: null, y: null }); // clear scale-snap guides
      if (last) {
        const s = useEditor.getState();
        s.selectObject(snap.objId);
        const geom = snap.isEllipse
          ? { radiusX: last.width / 2, radiusY: last.height / 2 }
          : { width: last.width, height: last.height };
        s.setProperties({ ...geom, x: last.baseX, y: last.baseY });
      }
      return true;
    }
    return false;
  };

  return { beginGroup, beginScale, beginResize, move, end };
}
