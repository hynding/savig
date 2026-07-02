import { useRef } from 'react';
import { buildTransform, sampleObject } from '@savig/engine';
import type { Project, SceneObject, Transform2D } from '@savig/engine';
import { useEditor } from '../../store/store';
import { selectEditProject } from '../../store/selectors';
import { computeSnap, resolveObjectAnchor, SNAP_PX, isSymbolInstance, type AABB } from '@savig/interaction';
import { computeSpacingSnap, type SpacingGuide } from '@savig/interaction';
import { snapAABBToGrid } from '@savig/interaction';

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

/** Stage-runtime values the move preview needs. (Object-drag reads `zoom` FRESH via getState —
 *  unlike the scale handles — so it isn't part of the ctx.) */
export interface ObjectDragCtx {
  nodes: Map<string, SVGGraphicsElement>;
  setSnapGuides: (g: { x: number | null; y: number | null }) => void;
  setSpacingGuides: (g: SpacingGuide[]) => void;
  setDragOffset: (d: { dx: number; dy: number } | null) => void;
  previewGroupChildren: (proj: Project, group: SceneObject, time: number, base: Transform2D) => void;
  previewInstanceChildren: (proj: Project, instance: SceneObject, time: number, base: Transform2D) => void;
}

const snapFor = (e: PointerEvent) => {
  const noBypass = !(e.metaKey || e.ctrlKey);
  return {
    snapActive: useEditor.getState().snapEnabled && noBypass,
    gridActive: useEditor.getState().gridEnabled && noBypass,
  };
};

/** Object move-dragging — single object + multi-selection (group bbox snap + equal-spacing +
 *  grid). Extracted from Stage.tsx (no behavior change). Owns the drag ref; Stage's
 *  onObjectPointerDown snapshots the DragState and calls begin. `move`/`end` are delegated from
 *  the shared onMove/onUp and return true while a move-drag is in progress. */
export function useObjectDrag() {
  const dragRef = useRef<DragState | null>(null);

  const begin = (state: DragState) => {
    dragRef.current = state;
  };

  const move = (e: PointerEvent, ctx: ObjectDragCtx): boolean => {
    const { snapActive, gridActive } = snapFor(e);
    const d = dragRef.current;
    if (!d) return false;
    const z = useEditor.getState().zoom ?? 1;
    if (d.multi) {
      // Move-drag the whole selection; snap the GROUP bbox to other objects + the
      // artboard (slice 44). Preview each member at its origin + the snapped delta;
      // one commit on pointer-up (nudgeSelected uses the corrected d.multi.dx/dy).
      const rawdx = (e.clientX - d.startX) / z;
      const rawdy = (e.clientY - d.startY) / z;
      let dx = rawdx;
      let dy = rawdy;
      let claimX = false;
      let claimY = false;
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
        ctx.setSnapGuides({ x: snap.guideX, y: snap.guideY });
        ctx.setSpacingGuides(spGuides);
      } else {
        ctx.setSnapGuides({ x: null, y: null });
        ctx.setSpacingGuides([]);
      }
      if (gridActive && d.baseAABB) {
        const gs = snapAABBToGrid(
          { minX: d.baseAABB.minX + dx, maxX: d.baseAABB.maxX + dx, minY: d.baseAABB.minY + dy, maxY: d.baseAABB.maxY + dy },
          useEditor.getState().gridSize,
        );
        if (!claimX) dx += gs.dx; // grid fills axes object-snap didn't claim
        if (!claimY) dy += gs.dy;
      }
      d.multi.dx = dx;
      d.multi.dy = dy;
      d.moved = true;
      const proj = selectEditProject(useEditor.getState());
      const time = useEditor.getState().time;
      for (const it of d.multi.items) {
        const obj = proj.objects.find((o) => o.id === it.id);
        if (!obj) continue;
        const sampled = sampleObject(obj, time);
        const resolved = resolveObjectAnchor(obj, proj.assets.find((a) => a.id === obj.assetId), sampled);
        const ax = resolved ? resolved.anchorX : obj.anchorX;
        const ay = resolved ? resolved.anchorY : obj.anchorY;
        const nx = it.ox + dx;
        const ny = it.oy + dy;
        const xf = buildTransform({ ...sampled, x: nx, y: ny }, ax, ay);
        const node = ctx.nodes.get(it.id);
        if (node) node.setAttribute('transform', xf);
        else if (obj.isGroup)
          ctx.previewGroupChildren(proj, obj, time, { x: nx, y: ny, scaleX: sampled.scaleX, scaleY: sampled.scaleY, rotation: sampled.rotation, opacity: sampled.opacity }); // group has no node — preview its subtree
        else if (isSymbolInstance(obj, proj.assets))
          ctx.previewInstanceChildren(proj, obj, time, { x: nx, y: ny, scaleX: sampled.scaleX, scaleY: sampled.scaleY, rotation: sampled.rotation, opacity: sampled.opacity }); // instance has no node — preview its leaves
      }
      ctx.setDragOffset({ dx, dy });
      return true;
    }
    // Raw (unsnapped) pointer position; snapping is applied fresh each move (no feedback).
    const rawX = d.originX + (e.clientX - d.startX) / z;
    const rawY = d.originY + (e.clientY - d.startY) / z;
    let adjX = 0; // total adjustment over raw, per axis (object-snap + spacing + grid)
    let adjY = 0;
    let claimX = false; // axis claimed by object/spacing snap → grid won't override it
    let claimY = false;
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
      ctx.setSnapGuides({ x: snap.guideX, y: snap.guideY });
      ctx.setSpacingGuides(spGuides);
    } else {
      ctx.setSnapGuides({ x: null, y: null });
      ctx.setSpacingGuides([]);
    }
    if (gridActive && d.baseAABB) {
      const gs = snapAABBToGrid(
        {
          minX: d.baseAABB.minX + (rawX - d.originX) + adjX,
          maxX: d.baseAABB.maxX + (rawX - d.originX) + adjX,
          minY: d.baseAABB.minY + (rawY - d.originY) + adjY,
          maxY: d.baseAABB.maxY + (rawY - d.originY) + adjY,
        },
        useEditor.getState().gridSize,
      );
      if (!claimX) adjX += gs.dx; // grid fills axes object/spacing snap didn't claim
      if (!claimY) adjY += gs.dy;
    }
    d.curX = rawX + adjX;
    d.curY = rawY + adjY;
    ctx.setDragOffset({ dx: d.curX - d.originX, dy: d.curY - d.originY }); // outline follows
    d.moved = true;
    // Live preview only: write the transform imperatively to the node, without
    // committing — the single history entry is pushed once on pointer-up so a
    // whole drag is one undo step.
    const proj = selectEditProject(useEditor.getState());
    const obj = proj.objects.find((o) => o.id === d.id);
    const node = ctx.nodes.get(d.id);
    if (obj && node) {
      const sampled = sampleObject(obj, useEditor.getState().time);
      // Resolve the absolute pivot (vector anchors are fractional) so the previewed
      // transform matches the committed one for rotated/scaled objects.
      const resolved = resolveObjectAnchor(obj, proj.assets.find((a) => a.id === obj.assetId), sampled);
      const ax = resolved ? resolved.anchorX : obj.anchorX;
      const ay = resolved ? resolved.anchorY : obj.anchorY;
      node.setAttribute('transform', buildTransform({ ...sampled, x: d.curX, y: d.curY }, ax, ay));
    } else if (obj && isSymbolInstance(obj, proj.assets)) {
      // An instance has no node of its own — repaint its leaves at the dragged position (47b).
      const sampled = sampleObject(obj, useEditor.getState().time);
      ctx.previewInstanceChildren(proj, obj, useEditor.getState().time, { x: d.curX, y: d.curY, scaleX: sampled.scaleX, scaleY: sampled.scaleY, rotation: sampled.rotation, opacity: sampled.opacity });
    }
    return true;
  };

  const end = (ctx: Pick<ObjectDragCtx, 'setSnapGuides' | 'setSpacingGuides' | 'setDragOffset'>): boolean => {
    const d = dragRef.current;
    if (!d) return false;
    if (d.multi) {
      if (d.moved) useEditor.getState().nudgeSelected(d.multi.dx, d.multi.dy); // one commit, all selected
    } else if (d.moved) {
      useEditor.getState().selectObject(d.id);
      useEditor.getState().setProperties({ x: d.curX, y: d.curY }); // already snapped
    }
    ctx.setSnapGuides({ x: null, y: null });
    ctx.setSpacingGuides([]);
    ctx.setDragOffset(null);
    dragRef.current = null;
    return true;
  };

  return { begin, move, end };
}
