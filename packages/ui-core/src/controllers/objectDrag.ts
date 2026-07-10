// Framework-neutral object move-drag controller (slice 5, group C) — single object + multi-select
// (group bbox snap + equal-spacing + grid). Extracted from `Stage/useObjectDrag.ts`. The store is
// INJECTED (W2); the DragState lives in a closure. `move` takes the raw pointer + snap-bypass flag
// (no coordinate port — object-drag works in client deltas / zoom, not stage-local coords) and
// RETURNS a preview descriptor (node transforms + container previews + snap/spacing guides + drag
// offset) the adapter applies (W5) rather than writing nodes itself; `end` commits the same
// already-snapped values it last previewed (preview coord == commit coord).
//
// NOTE the deliberate single-vs-multi asymmetry preserved from the original: the SINGLE branch
// only previews a leaf node or a symbol instance (a single group gets no live subtree preview —
// its node lookup missed and it isn't an instance); the MULTI branch also previews groups.
import { buildTransform, sampleObject } from '@savig/engine';
import type { Transform2D } from '@savig/engine';
import {
  computeSnap,
  computeSpacingSnap,
  resolveObjectAnchor,
  snapAABBToGrid,
  isSymbolInstance,
  SNAP_PX,
  type AABB,
  type SpacingGuide,
} from '@savig/interaction';
import { selectEditProject } from '@savig/editor-state';
import type { ControllerStore } from './store';
import { pushPreview, type ContainerPreview, type NodeTransform } from './transformPreview';

export interface DragState {
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

export interface ObjectDragPreview {
  nodeTransforms: NodeTransform[];
  containerPreviews: ContainerPreview[];
  snapGuides: { x: number | null; y: number | null };
  spacingGuides: SpacingGuide[];
  dragOffset: { dx: number; dy: number } | null;
}

export interface ObjectMoveResult {
  consumed: boolean;
  preview?: ObjectDragPreview;
}

export function makeObjectDragController(store: ControllerStore) {
  let drag: DragState | null = null;

  const begin = (state: DragState) => {
    drag = state;
  };

  const move = (clientX: number, clientY: number, bypass: boolean): ObjectMoveResult => {
    const snapActive = store.getState().snapEnabled && !bypass;
    const gridActive = store.getState().gridEnabled && !bypass;
    const d = drag;
    if (!d) return { consumed: false };
    const z = store.getState().zoom ?? 1;
    const nodeTransforms: NodeTransform[] = [];
    const containerPreviews: ContainerPreview[] = [];

    if (d.multi) {
      // Move-drag the whole selection; snap the GROUP bbox to other objects + the artboard
      // (slice 44). Preview each member at its origin + the snapped delta; one commit on
      // pointer-up (nudgeSelected uses the corrected d.multi.dx/dy).
      const rawdx = (clientX - d.startX) / z;
      const rawdy = (clientY - d.startY) / z;
      let dx = rawdx;
      let dy = rawdy;
      let claimX = false;
      let claimY = false;
      let snapGuides: { x: number | null; y: number | null } = { x: null, y: null };
      let spacingGuides: SpacingGuide[] = [];
      if (snapActive && d.baseAABB) {
        const moving: AABB = {
          minX: d.baseAABB.minX + rawdx,
          maxX: d.baseAABB.maxX + rawdx,
          minY: d.baseAABB.minY + rawdy,
          maxY: d.baseAABB.maxY + rawdy,
        };
        const snap = computeSnap(moving, d.targets, SNAP_PX / z);
        dx = rawdx + snap.dx;
        dy = rawdy + snap.dy;
        claimX = snap.guideX !== null;
        claimY = snap.guideY !== null;
        // Equal-spacing snap for the COMBINED multi-select bbox (mirrors the single-object path):
        // fills an axis only when edge-snap didn't claim it; targets already exclude the selection.
        const movingSnapped: AABB = { minX: d.baseAABB.minX + dx, maxX: d.baseAABB.maxX + dx, minY: d.baseAABB.minY + dy, maxY: d.baseAABB.maxY + dy };
        const sp = computeSpacingSnap(movingSnapped, d.targets, SNAP_PX / z);
        const useSpX = snap.guideX === null;
        const useSpY = snap.guideY === null;
        if (useSpX) dx += sp.dx;
        if (useSpY) dy += sp.dy;
        const spGuides = sp.guides.filter((g) => (g.orientation === 'h' ? useSpX : useSpY));
        claimX = snap.guideX !== null || spGuides.some((g) => g.orientation === 'h');
        claimY = snap.guideY !== null || spGuides.some((g) => g.orientation === 'v');
        snapGuides = { x: snap.guideX, y: snap.guideY };
        spacingGuides = spGuides;
      }
      if (gridActive && d.baseAABB) {
        const gs = snapAABBToGrid(
          { minX: d.baseAABB.minX + dx, maxX: d.baseAABB.maxX + dx, minY: d.baseAABB.minY + dy, maxY: d.baseAABB.maxY + dy },
          store.getState().gridSize,
        );
        if (!claimX) dx += gs.dx; // grid fills axes object-snap didn't claim
        if (!claimY) dy += gs.dy;
      }
      d.multi.dx = dx;
      d.multi.dy = dy;
      d.moved = true;
      const proj = selectEditProject(store.getState());
      const time = store.getState().time;
      for (const it of d.multi.items) {
        const obj = proj.objects.find((o) => o.id === it.id);
        if (!obj) continue;
        const asset = proj.assets.find((a) => a.id === obj.assetId);
        const sampled = sampleObject(obj, time, asset?.kind === 'vector' ? asset.primitive : undefined);
        const resolved = resolveObjectAnchor(obj, asset, sampled);
        const ax = resolved ? resolved.anchorX : obj.anchorX;
        const ay = resolved ? resolved.anchorY : obj.anchorY;
        const nx = it.ox + dx;
        const ny = it.oy + dy;
        const xf = buildTransform({ ...sampled, x: nx, y: ny }, ax, ay);
        const base: Transform2D = { x: nx, y: ny, scaleX: sampled.scaleX, scaleY: sampled.scaleY, rotation: sampled.rotation, opacity: sampled.opacity };
        pushPreview(obj, proj.assets, it.id, xf, base, nodeTransforms, containerPreviews);
      }
      return {
        consumed: true,
        preview: { nodeTransforms, containerPreviews, snapGuides, spacingGuides, dragOffset: { dx, dy } },
      };
    }

    // Raw (unsnapped) pointer position; snapping is applied fresh each move (no feedback).
    const rawX = d.originX + (clientX - d.startX) / z;
    const rawY = d.originY + (clientY - d.startY) / z;
    let adjX = 0; // total adjustment over raw, per axis (object-snap + spacing + grid)
    let adjY = 0;
    let claimX = false; // axis claimed by object/spacing snap → grid won't override it
    let claimY = false;
    let snapGuides: { x: number | null; y: number | null } = { x: null, y: null };
    let spacingGuides: SpacingGuide[] = [];
    if (snapActive && d.baseAABB) {
      const moving: AABB = {
        minX: d.baseAABB.minX + (rawX - d.originX),
        maxX: d.baseAABB.maxX + (rawX - d.originX),
        minY: d.baseAABB.minY + (rawY - d.originY),
        maxY: d.baseAABB.maxY + (rawY - d.originY),
      };
      const snap = computeSnap(moving, d.targets, SNAP_PX / z);
      adjX = snap.dx;
      adjY = snap.dy;
      // Equal-spacing snap fills an axis only when edge-snap didn't claim it (edge wins). Compute
      // on the edge-snapped bbox so the dimension segments land at the final position.
      const movingSnapped: AABB = {
        minX: moving.minX + adjX,
        maxX: moving.maxX + adjX,
        minY: moving.minY + adjY,
        maxY: moving.maxY + adjY,
      };
      const sp = computeSpacingSnap(movingSnapped, d.targets, SNAP_PX / z);
      const useSpX = snap.guideX === null;
      const useSpY = snap.guideY === null;
      if (useSpX) adjX += sp.dx;
      if (useSpY) adjY += sp.dy;
      const spGuides = sp.guides.filter((g) => (g.orientation === 'h' ? useSpX : useSpY));
      claimX = snap.guideX !== null || spGuides.some((g) => g.orientation === 'h');
      claimY = snap.guideY !== null || spGuides.some((g) => g.orientation === 'v');
      snapGuides = { x: snap.guideX, y: snap.guideY };
      spacingGuides = spGuides;
    }
    if (gridActive && d.baseAABB) {
      const gs = snapAABBToGrid(
        {
          minX: d.baseAABB.minX + (rawX - d.originX) + adjX,
          maxX: d.baseAABB.maxX + (rawX - d.originX) + adjX,
          minY: d.baseAABB.minY + (rawY - d.originY) + adjY,
          maxY: d.baseAABB.maxY + (rawY - d.originY) + adjY,
        },
        store.getState().gridSize,
      );
      if (!claimX) adjX += gs.dx; // grid fills axes object/spacing snap didn't claim
      if (!claimY) adjY += gs.dy;
    }
    d.curX = rawX + adjX;
    d.curY = rawY + adjY;
    d.moved = true;
    // Live preview only: emit the transform to the node, without committing — the single history
    // entry is pushed once on pointer-up so a whole drag is one undo step.
    const proj = selectEditProject(store.getState());
    const obj = proj.objects.find((o) => o.id === d.id);
    if (obj) {
      const asset = proj.assets.find((a) => a.id === obj.assetId);
      const sampled = sampleObject(obj, store.getState().time, asset?.kind === 'vector' ? asset.primitive : undefined);
      // Resolve the absolute pivot (vector anchors are fractional) so the previewed transform
      // matches the committed one for rotated/scaled objects.
      const resolved = resolveObjectAnchor(obj, asset, sampled);
      const ax = resolved ? resolved.anchorX : obj.anchorX;
      const ay = resolved ? resolved.anchorY : obj.anchorY;
      const base: Transform2D = { x: d.curX, y: d.curY, scaleX: sampled.scaleX, scaleY: sampled.scaleY, rotation: sampled.rotation, opacity: sampled.opacity };
      // Single-branch asymmetry (see header): leaf node OR instance only — NOT group.
      if (isSymbolInstance(obj, proj.assets)) {
        containerPreviews.push({ kind: 'instance', objId: d.id, base });
      } else if (!obj.isGroup) {
        nodeTransforms.push({ id: d.id, transform: buildTransform({ ...sampled, x: d.curX, y: d.curY }, ax, ay) });
      }
    }
    return {
      consumed: true,
      preview: { nodeTransforms, containerPreviews, snapGuides, spacingGuides, dragOffset: { dx: d.curX - d.originX, dy: d.curY - d.originY } },
    };
  };

  const end = (): { consumed: boolean } => {
    const d = drag;
    if (!d) return { consumed: false };
    if (d.multi) {
      if (d.moved) store.getState().nudgeSelected(d.multi.dx, d.multi.dy); // one commit, all selected
    } else if (d.moved) {
      store.getState().selectObject(d.id);
      store.getState().setProperties({ x: d.curX, y: d.curY }); // already snapped
    }
    drag = null;
    return { consumed: true };
  };

  return { begin, move, end };
}

export type ObjectDragController = ReturnType<typeof makeObjectDragController>;
