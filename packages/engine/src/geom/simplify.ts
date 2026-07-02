import type { PathPoint } from '../types';

// Perpendicular distance from p to the infinite line through a-b. When a == b,
// the "line" degenerates to a point and we return the point distance.
function perpDistance(p: PathPoint, a: PathPoint, b: PathPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs(dx * (a.y - p.y) - dy * (a.x - p.x)) / len;
}

// Ramer–Douglas–Peucker. Returns a subset of `points` (endpoints always kept)
// whose polyline stays within `epsilon` of the original. `epsilon <= 0` or a
// 2-or-fewer-point input is returned as a shallow copy, unchanged.
export function simplify(points: PathPoint[], epsilon: number): PathPoint[] {
  if (points.length <= 2 || epsilon <= 0) return points.slice();
  const a = points[0];
  const b = points[points.length - 1];
  let maxDist = 0;
  let idx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDistance(points[i], a, b);
    if (d > maxDist) {
      maxDist = d;
      idx = i;
    }
  }
  if (maxDist > epsilon) {
    const left = simplify(points.slice(0, idx + 1), epsilon);
    const right = simplify(points.slice(idx), epsilon);
    // `right` repeats the split point that ends `left`; drop the duplicate.
    return left.slice(0, -1).concat(right);
  }
  return [a, b];
}
