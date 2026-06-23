// Pure align/distribute geometry for the multi-selection (slice 43). Operates on stage
// AABBs; returns per-object {id, x?|y?} updates fed to setObjectsTransforms. Translation
// shifts an AABB uniformly, so newX = x + (target - aabb.minX) is exact for any
// rotation/scale. Editor-only; never touches geometry/export/runtime/persistence.

import { groupBBox, type AABB } from './snapping';

export type AlignEdge = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';
export type DistributeAxis = 'h' | 'v';
export interface AlignItem {
  id: string;
  aabb: AABB;
  x: number;
  y: number;
}

const EPS = 1e-6;

export function computeAlign(items: AlignItem[], edge: AlignEdge): { id: string; x?: number; y?: number }[] {
  const g = groupBBox(items.map((i) => i.aabb));
  if (!g || items.length < 2) return [];
  const horizontal = edge === 'left' || edge === 'hcenter' || edge === 'right';
  const out: { id: string; x?: number; y?: number }[] = [];
  for (const it of items) {
    const a = it.aabb;
    let d: number;
    if (edge === 'left') d = g.minX - a.minX;
    else if (edge === 'right') d = g.maxX - a.maxX;
    else if (edge === 'hcenter') d = (g.minX + g.maxX) / 2 - (a.minX + a.maxX) / 2;
    else if (edge === 'top') d = g.minY - a.minY;
    else if (edge === 'bottom') d = g.maxY - a.maxY;
    else d = (g.minY + g.maxY) / 2 - (a.minY + a.maxY) / 2; // vcenter
    if (Math.abs(d) < EPS) continue;
    out.push(horizontal ? { id: it.id, x: it.x + d } : { id: it.id, y: it.y + d });
  }
  return out;
}

export function computeDistribute(
  items: AlignItem[],
  axis: DistributeAxis,
): { id: string; x?: number; y?: number }[] {
  if (items.length < 3) return [];
  const horizontal = axis === 'h';
  const lo = (a: AABB) => (horizontal ? a.minX : a.minY);
  const hi = (a: AABB) => (horizontal ? a.maxX : a.maxY);
  const sorted = [...items].sort((p, q) => lo(p.aabb) - lo(q.aabb));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span = hi(last.aabb) - lo(first.aabb);
  const sizes = sorted.reduce((s, it) => s + (hi(it.aabb) - lo(it.aabb)), 0);
  const gap = (span - sizes) / (sorted.length - 1); // equal gap between consecutive boxes
  const out: { id: string; x?: number; y?: number }[] = [];
  let cursor = lo(first.aabb);
  for (const it of sorted) {
    const d = cursor - lo(it.aabb);
    if (Math.abs(d) >= EPS) out.push(horizontal ? { id: it.id, x: it.x + d } : { id: it.id, y: it.y + d });
    cursor += hi(it.aabb) - lo(it.aabb) + gap;
  }
  return out;
}
