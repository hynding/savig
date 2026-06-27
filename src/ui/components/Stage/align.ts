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

/** Shift every item by ONE delta so the selection's combined bbox centre lands on the frame centre
 *  (frameW/2, frameH/2). Moves the selection as a rigid group (relative positions preserved). >=1 item.
 *  Editor-only layout op (align-to-artboard). */
export function computeCenterOnFrame(
  items: AlignItem[],
  frameW: number,
  frameH: number,
): { id: string; x?: number; y?: number }[] {
  const g = groupBBox(items.map((i) => i.aabb));
  if (!g || items.length < 1) return [];
  const dx = frameW / 2 - (g.minX + g.maxX) / 2;
  const dy = frameH / 2 - (g.minY + g.maxY) / 2;
  if (Math.abs(dx) < EPS && Math.abs(dy) < EPS) return [];
  return items.map((it) => ({ id: it.id, x: it.x + dx, y: it.y + dy }));
}

/** Align each item's `edge` to the ARTBOARD frame (not to the group bbox): left→0, right→frameW,
 *  hcenter→frameW/2, top→0, bottom→frameH, vcenter→frameH/2. Per-item delta; >=1 item.
 *  Editor-only layout op (edge-align-to-artboard; complements computeCenterOnFrame). */
export function computeAlignToFrame(
  items: AlignItem[],
  edge: AlignEdge,
  frameW: number,
  frameH: number,
): { id: string; x?: number; y?: number }[] {
  const horizontal = edge === 'left' || edge === 'hcenter' || edge === 'right';
  const out: { id: string; x?: number; y?: number }[] = [];
  for (const it of items) {
    const a = it.aabb;
    let d: number;
    if (edge === 'left') d = 0 - a.minX;
    else if (edge === 'right') d = frameW - a.maxX;
    else if (edge === 'hcenter') d = frameW / 2 - (a.minX + a.maxX) / 2;
    else if (edge === 'top') d = 0 - a.minY;
    else if (edge === 'bottom') d = frameH - a.maxY;
    else d = frameH / 2 - (a.minY + a.maxY) / 2; // vcenter
    if (Math.abs(d) < EPS) continue;
    out.push(horizontal ? { id: it.id, x: it.x + d } : { id: it.id, y: it.y + d });
  }
  return out;
}

/** Distribute by equal CENTER spacing along `axis`: the first & last items (by center) stay put;
 *  intermediate items move so all centers are evenly spaced. Needs >=3 items. */
export function computeDistributeCenters(
  items: AlignItem[],
  axis: DistributeAxis,
): { id: string; x?: number; y?: number }[] {
  if (items.length < 3) return [];
  const horizontal = axis === 'h';
  const center = (a: AABB) => (horizontal ? (a.minX + a.maxX) / 2 : (a.minY + a.maxY) / 2);
  const sorted = [...items].sort((p, q) => center(p.aabb) - center(q.aabb));
  const firstC = center(sorted[0].aabb);
  const lastC = center(sorted[sorted.length - 1].aabb);
  const step = (lastC - firstC) / (sorted.length - 1);
  const out: { id: string; x?: number; y?: number }[] = [];
  sorted.forEach((it, i) => {
    const d = firstC + i * step - center(it.aabb);
    if (Math.abs(d) >= EPS) out.push(horizontal ? { id: it.id, x: it.x + d } : { id: it.id, y: it.y + d });
  });
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

/** Distribute by an EXACT pixel `gap` between consecutive boxes along `axis`. The first item
 *  (by lo edge) stays fixed; each subsequent box is placed `gap` after the previous box's hi edge.
 *  Needs >=2 items. (Complements computeDistribute's derived gap.) */
export function computeDistributeSpacing(
  items: AlignItem[],
  axis: DistributeAxis,
  gap: number,
): { id: string; x?: number; y?: number }[] {
  if (items.length < 2) return [];
  const horizontal = axis === 'h';
  const lo = (a: AABB) => (horizontal ? a.minX : a.minY);
  const hi = (a: AABB) => (horizontal ? a.maxX : a.maxY);
  const sorted = [...items].sort((p, q) => lo(p.aabb) - lo(q.aabb));
  const out: { id: string; x?: number; y?: number }[] = [];
  let cursor = lo(sorted[0].aabb);
  for (const it of sorted) {
    const d = cursor - lo(it.aabb);
    if (Math.abs(d) >= EPS) out.push(horizontal ? { id: it.id, x: it.x + d } : { id: it.id, y: it.y + d });
    cursor += hi(it.aabb) - lo(it.aabb) + gap;
  }
  return out;
}
