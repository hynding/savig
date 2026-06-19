import type { Easing, EasingName } from './types';

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
