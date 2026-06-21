import type { PathData, PathNode, PathPoint } from '../types';

export const SAMPLE_COUNT = 64;
export const FLATTEN_STEPS = 16;

function add(anchor: PathPoint, offset: PathPoint | undefined): PathPoint {
  return offset ? { x: anchor.x + offset.x, y: anchor.y + offset.y } : anchor;
}

function dist(a: PathPoint, b: PathPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function lerpPoint(a: PathPoint, b: PathPoint, t: number): PathPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function cubicAt(p0: PathPoint, c1: PathPoint, c2: PathPoint, p3: PathPoint, u: number): PathPoint {
  const v = 1 - u;
  const a = v * v * v;
  const b = 3 * v * v * u;
  const c = 3 * v * u * u;
  const d = u * u * u;
  return {
    x: a * p0.x + b * c1.x + c * c2.x + d * p3.x,
    y: a * p0.y + b * c1.y + c * c2.y + d * p3.y,
  };
}

// Flatten to a fine polyline along the actually-rendered curve, using the SAME L/C
// classification as pathToD's segment(): cubic iff prev.out || cur.in.
function flatten(path: PathData): PathPoint[] {
  const { nodes, closed } = path;
  if (nodes.length === 0) return [];
  const pts: PathPoint[] = [{ x: nodes[0].anchor.x, y: nodes[0].anchor.y }];
  const pushSegment = (prev: PathNode, cur: PathNode) => {
    if (prev.out || cur.in) {
      const c1 = add(prev.anchor, prev.out);
      const c2 = add(cur.anchor, cur.in);
      for (let s = 1; s <= FLATTEN_STEPS; s++) {
        pts.push(cubicAt(prev.anchor, c1, c2, cur.anchor, s / FLATTEN_STEPS));
      }
    } else {
      pts.push({ x: cur.anchor.x, y: cur.anchor.y });
    }
  };
  for (let i = 1; i < nodes.length; i++) pushSegment(nodes[i - 1], nodes[i]);
  if (closed && nodes.length > 1) pushSegment(nodes[nodes.length - 1], nodes[0]);
  return pts;
}

function pointAtLength(flat: PathPoint[], cum: number[], target: number): PathPoint {
  const total = cum[cum.length - 1];
  if (target <= 0) return { x: flat[0].x, y: flat[0].y };
  if (target >= total) return { x: flat[flat.length - 1].x, y: flat[flat.length - 1].y };
  let j = 1;
  while (j < cum.length && cum[j] < target) j++;
  const segLen = cum[j] - cum[j - 1];
  const t = segLen === 0 ? 0 : (target - cum[j - 1]) / segLen;
  return lerpPoint(flat[j - 1], flat[j], t);
}

// Resample to `n` points evenly spaced by arc length, lying on the rendered curve.
export function resample(path: PathData, n: number = SAMPLE_COUNT): PathNode[] {
  const flat = flatten(path);
  if (flat.length === 0) {
    return Array.from({ length: n }, () => ({ anchor: { x: 0, y: 0 } }));
  }
  const cum: number[] = [0];
  for (let i = 1; i < flat.length; i++) cum.push(cum[i - 1] + dist(flat[i - 1], flat[i]));
  const total = cum[cum.length - 1];
  if (total === 0) {
    return Array.from({ length: n }, () => ({ anchor: { x: flat[0].x, y: flat[0].y } }));
  }
  const out: PathNode[] = [];
  for (let i = 0; i < n; i++) {
    // n <= 1 (degenerate request) samples the start point only — avoids 0/0 on the
    // open-path i/(n-1) divisor.
    const frac = n <= 1 ? 0 : path.closed ? i / n : i / (n - 1);
    out.push({ anchor: pointAtLength(flat, cum, frac * total) });
  }
  return out;
}
