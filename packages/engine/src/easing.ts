import type { CubicBezierEasing, Easing, EasingName } from './types';

export const easingRegistry: Record<EasingName, (t: number) => number> = {
  linear: (t) => t,
  easeIn: (t) => t * t,
  easeOut: (t) => t * (2 - t),
  easeInOut: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
};

/**
 * Returns a function mapping progress t∈[0,1] to eased progress, for the CSS
 * cubic-bezier(x1, y1, x2, y2) curve. Solves x→t with Newton-Raphson and a
 * bisection fallback, then evaluates y.
 */
function cubicBezier(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;

  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;

  const solveX = (x: number) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const xError = sampleX(t) - x;
      if (Math.abs(xError) < 1e-6) return t;
      const dx = sampleDX(t);
      if (Math.abs(dx) < 1e-6) break;
      t -= xError / dx;
      // Keep the Newton-Raphson guess in-domain; bisection rescues stalls.
      t = Math.min(1, Math.max(0, t));
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 30; i++) {
      const xValue = sampleX(t);
      if (Math.abs(xValue - x) < 1e-6) return t;
      if (x > xValue) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  };

  return (t: number) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return sampleY(solveX(t));
  };
}

export function applyEasing(easing: Easing, t: number): number {
  if (typeof easing === 'string') {
    return easingRegistry[easing](t);
  }
  return cubicBezier(easing.p1, easing.p2, easing.p3, easing.p4)(t);
}

const THIRD = 1 / 3;
/** An easing as a cubic Bézier (motion editor, spec 2026-11-15-motion-editor). linear / easeIn /
 *  easeOut are exact (they are quadratics); easeInOut is piecewise quadratic, so it is approximated. */
export function easingAsBezier(e: Easing): CubicBezierEasing {
  if (typeof e !== 'string') return e;
  switch (e) {
    case 'linear':
      return { type: 'cubicBezier', p1: THIRD, p2: THIRD, p3: 2 * THIRD, p4: 2 * THIRD };
    case 'easeIn':
      return { type: 'cubicBezier', p1: THIRD, p2: 0, p3: 2 * THIRD, p4: THIRD };
    case 'easeOut':
      return { type: 'cubicBezier', p1: THIRD, p2: 2 * THIRD, p3: 2 * THIRD, p4: 1 };
    case 'easeInOut':
      return { type: 'cubicBezier', p1: 0.45, p2: 0, p3: 0.55, p4: 1 };
  }
}

/** Split a segment's easing at progress `u` (0..1 of its time) into the easings of the two halves,
 *  so inserting a key there leaves the motion unchanged (exact for Bézier and the quadratic named
 *  easings; linear stays linear). Returns null when a half has no value span to normalize by
 *  (the eased value at `u` is exactly 0 or 1) — the caller then keeps the original easing. */
export function splitEasing(e: Easing, u: number): [Easing, Easing] | null {
  if (e === 'linear') return ['linear', 'linear'];
  if (!(u > 0 && u < 1)) return null;
  const b = easingAsBezier(e);
  // Solve x(s) = u on the Bézier (0,0) (p1,p2) (p3,p4) (1,1) by bisection (x is monotone).
  const bx = (s: number) => 3 * (1 - s) * (1 - s) * s * b.p1 + 3 * (1 - s) * s * s * b.p3 + s * s * s;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (bx(mid) < u) lo = mid;
    else hi = mid;
  }
  const s = (lo + hi) / 2;
  // de Casteljau at s.
  type P = [number, number];
  const lerp = (a: P, c: P): P => [a[0] + (c[0] - a[0]) * s, a[1] + (c[1] - a[1]) * s];
  const p0: P = [0, 0];
  const p1: P = [b.p1, b.p2];
  const p2: P = [b.p3, b.p4];
  const p3: P = [1, 1];
  const a1 = lerp(p0, p1);
  const a2 = lerp(p1, p2);
  const a3 = lerp(p2, p3);
  const b1 = lerp(a1, a2);
  const b2 = lerp(a2, a3);
  const m = lerp(b1, b2);
  const ym = m[1];
  if (Math.abs(ym) < 1e-9 || Math.abs(1 - ym) < 1e-9) return null;
  const left: CubicBezierEasing = { type: 'cubicBezier', p1: a1[0] / m[0], p2: a1[1] / ym, p3: b1[0] / m[0], p4: b1[1] / ym };
  const right: CubicBezierEasing = {
    type: 'cubicBezier',
    p1: (b2[0] - m[0]) / (1 - m[0]),
    p2: (b2[1] - ym) / (1 - ym),
    p3: (a3[0] - m[0]) / (1 - m[0]),
    p4: (a3[1] - ym) / (1 - ym),
  };
  return [left, right];
}
