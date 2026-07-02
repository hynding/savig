import { flattenPath, pointAtLength, type Flattened } from './geom/arcLength';
import type { PathData, PathPoint } from './types';

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

function pointFromFlat(flat: Flattened, frac: number): PathPoint {
  if (flat.pts.length === 0) return { x: 0, y: 0 };
  if (flat.total === 0) return { x: flat.pts[0].x, y: flat.pts[0].y };
  return pointAtLength(flat, clamp01(frac) * flat.total);
}

// Point on the guide at a normalized [0,1] arc-length fraction. Degenerate guards
// mirror resample: empty -> origin, zero-length -> the start point.
export function pointAtFraction(path: PathData, frac: number): PathPoint {
  return pointFromFlat(flattenPath(path), frac);
}

// Tangent direction (degrees, atan2) at a normalized fraction, via a small central
// finite difference in arc-length space; one-sided at the ends. Degenerate -> 0.
export function tangentAngleDeg(path: PathData, frac: number): number {
  const flat = flattenPath(path);
  if (flat.pts.length < 2 || flat.total === 0) return 0;
  const f = clamp01(frac);
  const eps = 1e-3; // fraction of the curve used as the finite-difference step
  const lo = Math.max(0, f - eps);
  const hi = Math.min(1, f + eps);
  const a = pointFromFlat(flat, lo);
  const b = pointFromFlat(flat, hi);
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}
