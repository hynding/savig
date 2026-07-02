// Framework-neutral easing-curve helpers (slice 5, group D). The `EasingEditor` widget is
// stateless — each pointer move synchronously builds a new easing and calls `onChange` — so there
// is no drag state to own; what's extractable is the pure curve/param math, which a Svelte
// EasingEditor would reuse verbatim. The DOM `fromClient` (client px → param via
// getBoundingClientRect) stays in the React component. No store dependency here.
import { applyEasing } from '@savig/engine';
import type { CubicBezierEasing, Easing, EasingName } from '@savig/engine';

// Widget geometry (SVG user units).
export const EASING_W = 120;
export const EASING_H = 120;
export const EASING_PAD = 30;
export const EASING_PRESETS: EasingName[] = ['linear', 'easeIn', 'easeOut', 'easeInOut'];
export const DEFAULT_CUSTOM_EASING: CubicBezierEasing = { type: 'cubicBezier', p1: 0.42, p2: 0, p3: 0.58, p4: 1 };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
export const easingRound2 = (n: number) => Math.round(n * 100) / 100;
export const clampX = (n: number) => clamp(n, 0, 1);
export const clampY = (n: number) => clamp(n, -0.5, 1.5);

export const toSx = (t: number) => t * EASING_W;
export const toSy = (y: number) => EASING_PAD + (1 - y) * EASING_H;

export function curveSamples(value: Easing, n = 24): Array<{ t: number; y: number }> {
  const out: Array<{ t: number; y: number }> = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push({ t, y: applyEasing(value, t) });
  }
  return out;
}

export function curvePoints(value: Easing): string {
  return curveSamples(value)
    .map(({ t, y }) => `${toSx(t)},${toSy(y)}`)
    .join(' ');
}

/** Build a new cubic-bezier easing moving control point 1 to (x,y) (clamped to the widget range). */
export function setBezierP1(bezier: CubicBezierEasing, x: number, y: number): Easing {
  return { type: 'cubicBezier', p1: clampX(x), p2: clampY(y), p3: bezier.p3, p4: bezier.p4 };
}

/** Build a new cubic-bezier easing moving control point 2 to (x,y) (clamped to the widget range). */
export function setBezierP2(bezier: CubicBezierEasing, x: number, y: number): Easing {
  return { type: 'cubicBezier', p1: bezier.p1, p2: bezier.p2, p3: clampX(x), p4: clampY(y) };
}
