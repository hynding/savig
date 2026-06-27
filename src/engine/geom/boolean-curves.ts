import type { PathPoint } from '../types';

export interface Cubic {
  p0: PathPoint;
  c1: PathPoint;
  c2: PathPoint;
  p3: PathPoint;
}

const lerp = (a: PathPoint, b: PathPoint, t: number): PathPoint => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

export function evalCubic(c: Cubic, t: number): PathPoint {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return {
    x: a * c.p0.x + b * c.c1.x + d * c.c2.x + e * c.p3.x,
    y: a * c.p0.y + b * c.c1.y + d * c.c2.y + e * c.p3.y,
  };
}

export function reverseCubic(c: Cubic): Cubic {
  return { p0: c.p3, c1: c.c2, c2: c.c1, p3: c.p0 };
}

/** De Casteljau split at `t`, returning the LEFT [0,t] sub-cubic. */
function splitLeft(c: Cubic, t: number): Cubic {
  const ab = lerp(c.p0, c.c1, t);
  const bc = lerp(c.c1, c.c2, t);
  const cd = lerp(c.c2, c.p3, t);
  const abc = lerp(ab, bc, t);
  const bcd = lerp(bc, cd, t);
  const p = lerp(abc, bcd, t);
  return { p0: c.p0, c1: ab, c2: abc, p3: p };
}

/** De Casteljau split at `t`, returning the RIGHT [t,1] sub-cubic. */
function splitRight(c: Cubic, t: number): Cubic {
  const ab = lerp(c.p0, c.c1, t);
  const bc = lerp(c.c1, c.c2, t);
  const cd = lerp(c.c2, c.p3, t);
  const abc = lerp(ab, bc, t);
  const bcd = lerp(bc, cd, t);
  const p = lerp(abc, bcd, t);
  return { p0: p, c1: bcd, c2: cd, p3: c.p3 };
}

/** Sub-cubic over [t0,t1]; if t0 > t1 the result is reversed (traversal-ordered). */
export function splitCubicRange(c: Cubic, t0: number, t1: number): Cubic {
  const lo = Math.min(t0, t1);
  const hi = Math.max(t0, t1);
  // Take the right [lo,1] piece, then the left of the remapped hi within it.
  const right = splitRight(c, lo);
  const remapped = lo >= 1 ? 1 : (hi - lo) / (1 - lo);
  const sub = splitLeft(right, Math.min(1, Math.max(0, remapped)));
  return t0 <= t1 ? sub : reverseCubic(sub);
}

/**
 * Nearest point on a cubic to `p`, returned as its parameter `t` and distance.
 * Assumes the squared-distance function is unimodal within ±1 seed interval of the
 * coarse minimum — true for the simple arc / line / path segments boolean operands
 * produce. A self-intersecting cubic could yield a local rather than global minimum.
 */
export function projectToCubic(c: Cubic, p: PathPoint): { t: number; dist: number } {
  const d2 = (q: PathPoint) => (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
  // Coarse seed across the parameter range.
  const SEED = 24;
  let bestT = 0;
  let bestD = Infinity;
  for (let i = 0; i <= SEED; i++) {
    const t = i / SEED;
    const dd = d2(evalCubic(c, t));
    if (dd < bestD) {
      bestD = dd;
      bestT = t;
    }
  }
  // Ternary-search refine around the seed.
  let lo = Math.max(0, bestT - 1 / SEED);
  let hi = Math.min(1, bestT + 1 / SEED);
  for (let i = 0; i < 40; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (d2(evalCubic(c, m1)) < d2(evalCubic(c, m2))) hi = m2;
    else lo = m1;
  }
  const t = (lo + hi) / 2;
  return { t, dist: Math.sqrt(d2(evalCubic(c, t))) };
}

export function isStraightCubic(c: Cubic, eps = 1e-6): boolean {
  const vx = c.p3.x - c.p0.x;
  const vy = c.p3.y - c.p0.y;
  const len = Math.hypot(vx, vy);
  if (len < eps) return true; // degenerate point
  // Perpendicular distance of each control point from the p0->p3 line.
  const cross = (q: PathPoint) => Math.abs((q.x - c.p0.x) * vy - (q.y - c.p0.y) * vx) / len;
  return cross(c.c1) < eps && cross(c.c2) < eps;
}
