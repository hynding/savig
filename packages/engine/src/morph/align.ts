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

// The rotation+winding that best matches `b` to `a` (equal lengths). Closed: all cyclic
// offsets in both windings. Open: forward vs reversed only (offset always 0). Ties:
// lowest offset, forward winding (strict `<` keeps the first-seen forward offset 0).
export function bestAlignment(
  b: PathNode[],
  a: PathNode[],
  closed: boolean,
): { offset: number; reversed: boolean } {
  const n = b.length;
  if (n === 0) return { offset: 0, reversed: false };
  let best = { offset: 0, reversed: false };
  let bestCost = cost(a, b); // forward, offset 0 (seed)
  const consider = (cand: PathNode[], offset: number, reversed: boolean) => {
    const c = cost(a, cand);
    if (c < bestCost) {
      bestCost = c;
      best = { offset, reversed };
    }
  };
  const reversed = b.slice().reverse();
  if (closed) {
    // Forward offset 0 is the seed, so start forward rotations at k=1.
    for (let k = 1; k < n; k++) consider(rotate(b, k), k, false);
    for (let k = 0; k < n; k++) consider(rotate(reversed, k), k, true);
  } else {
    consider(reversed, 0, true);
  }
  return best;
}

// Reorder `b` (rotation + winding) to best match `a` (same length). Thin wrapper over
// bestAlignment so resampled reconcile keeps byte-identical output.
export function align(b: PathNode[], a: PathNode[], closed: boolean): PathNode[] {
  // Callers pass equal-length arrays (both from resample(_, SAMPLE_COUNT)); cost/rotate
  // assume a.length === b.length.
  const { offset, reversed } = bestAlignment(b, a, closed);
  const base = reversed ? b.slice().reverse() : b;
  return rotate(base, offset);
}
