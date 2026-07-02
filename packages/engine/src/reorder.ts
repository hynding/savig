import type { SceneObject } from './types';

export type ReorderOp = 'front' | 'forward' | 'backward' | 'back';

/** Reorder `id` within the z-stack; return a new objects array with contiguous
 *  zOrders (0..N-1) in the new order. The array element order is preserved; only
 *  each object's `zOrder` is rewritten. Returns the SAME `objects` reference for a
 *  no-op (unknown id, N < 2, or already at the requested extreme). */
export function reorderObjects(objects: SceneObject[], id: string, op: ReorderOp): SceneObject[] {
  if (objects.length < 2) return objects;
  const order = [...objects].sort((a, b) => a.zOrder - b.zOrder);
  const idx = order.findIndex((o) => o.id === id);
  if (idx === -1) return objects;
  const last = order.length - 1;
  let next: SceneObject[];
  if (op === 'forward') {
    if (idx >= last) return objects;
    next = [...order];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
  } else if (op === 'backward') {
    if (idx <= 0) return objects;
    next = [...order];
    [next[idx], next[idx - 1]] = [next[idx - 1], next[idx]];
  } else if (op === 'front') {
    if (idx >= last) return objects;
    next = [...order.slice(0, idx), ...order.slice(idx + 1), order[idx]];
  } else {
    // back
    if (idx <= 0) return objects;
    next = [order[idx], ...order.slice(0, idx), ...order.slice(idx + 1)];
  }
  const zById = new Map(next.map((o, z) => [o.id, z] as const));
  return objects.map((o) => ({ ...o, zOrder: zById.get(o.id)! }));
}

/** Move `draggedId` to `targetId`'s slot in the z-stack, displaced in the drag
 *  direction: dragging down (dragged was above the target in the front-first panel)
 *  lands it just below the target; dragging up lands it just above. Reassigns
 *  contiguous zOrders (0..N-1). Returns the SAME `objects` reference for a no-op
 *  (same id, unknown id, N < 2, or the resulting order is unchanged). */
export function moveObjectToTarget(
  objects: SceneObject[],
  draggedId: string,
  targetId: string,
): SceneObject[] {
  if (objects.length < 2 || draggedId === targetId) return objects;
  const panel = [...objects].sort((a, b) => b.zOrder - a.zOrder).map((o) => o.id); // front-first
  const di = panel.indexOf(draggedId);
  const ti = panel.indexOf(targetId);
  if (di === -1 || ti === -1) return objects;
  const before = panel.join(' ');
  panel.splice(di, 1);
  const t = panel.indexOf(targetId);
  panel.splice(di < ti ? t + 1 : t, 0, draggedId); // down -> below target; up -> above
  if (panel.join(' ') === before) return objects; // order unchanged -> no-op
  const n = panel.length;
  const zById = new Map(panel.map((id, i) => [id, n - 1 - i] as const));
  return objects.map((o) => ({ ...o, zOrder: zById.get(o.id)! }));
}
