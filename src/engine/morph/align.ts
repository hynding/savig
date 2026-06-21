import type { PathNode, PathPoint } from '../types';

function sqDist(a: PathPoint, b: PathPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx * dx + dy * dy;
}

function cost(a: PathNode[], b: PathNode[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += sqDist(a[i].anchor, b[i].anchor);
  return s;
}

function rotate(nodes: PathNode[], k: number): PathNode[] {
  if (k === 0) return nodes;
  return nodes.slice(k).concat(nodes.slice(0, k));
}

// Reorder `b` (rotation + winding) to best match `a` (same length). Closed: all cyclic
// offsets in both windings. Open: forward vs reversed only. Ties: lowest offset,
// forward winding (strict `<` keeps the first-seen, which is forward offset 0).
export function align(b: PathNode[], a: PathNode[], closed: boolean): PathNode[] {
  // Callers pass equal-length arrays (both from resample(_, SAMPLE_COUNT)); cost/rotate
  // assume a.length === b.length.
  const n = b.length;
  if (n === 0) return b;
  const reversed = b.slice().reverse();
  let best = b;
  let bestCost = cost(a, b);
  const consider = (cand: PathNode[]) => {
    const c = cost(a, cand);
    if (c < bestCost) {
      bestCost = c;
      best = cand;
    }
  };
  if (closed) {
    // Forward offset 0 is already the seed (best/bestCost above), so start forward
    // rotations at k=1 to avoid re-evaluating it.
    for (let k = 1; k < n; k++) consider(rotate(b, k));
    for (let k = 0; k < n; k++) consider(rotate(reversed, k));
  } else {
    consider(reversed);
  }
  return best;
}
