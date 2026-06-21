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
