import type { PathData, PathNode } from '../types';
import { flattenPath, pointAtLength } from '../geom/arcLength';

export const SAMPLE_COUNT = 64;

// Resample to `n` points evenly spaced by arc length, lying on the rendered curve.
export function resample(path: PathData, n: number = SAMPLE_COUNT): PathNode[] {
  const flat = flattenPath(path);
  if (flat.pts.length === 0) {
    return Array.from({ length: n }, () => ({ anchor: { x: 0, y: 0 } }));
  }
  const total = flat.total;
  if (total === 0) {
    const p = flat.pts[0];
    return Array.from({ length: n }, () => ({ anchor: { x: p.x, y: p.y } }));
  }
  const out: PathNode[] = [];
  for (let i = 0; i < n; i++) {
    // n <= 1 (degenerate request) samples the start point only — avoids 0/0 on the
    // open-path i/(n-1) divisor.
    const frac = n <= 1 ? 0 : path.closed ? i / n : i / (n - 1);
    out.push({ anchor: pointAtLength(flat, frac * total) });
  }
  return out;
}
