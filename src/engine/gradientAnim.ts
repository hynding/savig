import { applyEasing } from './easing';
import { interpolateColor } from './color';
import type { Gradient, GradientKeyframe, GradientStop } from './types';

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function lerpStops(a: GradientStop[], b: GradientStop[], t: number): GradientStop[] {
  return a.map((sa, i) => {
    const sb = b[i];
    const stop: GradientStop = {
      offset: lerp(sa.offset, sb.offset, t),
      color: interpolateColor(sa.color, sb.color, t),
    };
    const oa = sa.opacity ?? 1;
    const ob = sb.opacity ?? 1;
    if (oa !== 1 || ob !== 1) stop.opacity = lerp(oa, ob, t);
    return stop;
  });
}

/**
 * Interpolate two gradients. STEPS-holds (returns `a` until t>=1, then `b`) when
 * the gradients are not smoothly interpolable: different type, or different stop
 * count. Otherwise lerps geometry, per-stop offset/opacity, and colors (via
 * interpolateColor, inheriting its hold-on-unparseable behavior).
 */
export function interpolateGradient(a: Gradient, b: Gradient, t: number): Gradient {
  if (a.type !== b.type || a.stops.length !== b.stops.length) {
    return t >= 1 ? b : a;
  }
  const stops = lerpStops(a.stops, b.stops, t);
  if (a.type === 'linear' && b.type === 'linear') {
    return {
      type: 'linear',
      x1: lerp(a.x1, b.x1, t),
      y1: lerp(a.y1, b.y1, t),
      x2: lerp(a.x2, b.x2, t),
      y2: lerp(a.y2, b.y2, t),
      stops,
    };
  }
  if (a.type === 'radial' && b.type === 'radial') {
    const out: Gradient = {
      type: 'radial',
      cx: lerp(a.cx, b.cx, t),
      cy: lerp(a.cy, b.cy, t),
      r: lerp(a.r, b.r, t),
      stops,
    };
    // Focal point lerps only when BOTH endpoints define it; otherwise held absent.
    if (a.fx !== undefined && b.fx !== undefined) out.fx = lerp(a.fx, b.fx, t);
    if (a.fy !== undefined && b.fy !== undefined) out.fy = lerp(a.fy, b.fy, t);
    return out;
  }
  return t >= 1 ? b : a; // unreachable given the type guard above
}

/**
 * Resolve a gradient track to a Gradient at `time`. Mirrors sampleColor's
 * bracket/clamp/per-keyframe-easing.
 */
export function sampleGradient(track: GradientKeyframe[], time: number): Gradient {
  if (track.length === 0) {
    throw new Error('sampleGradient: track must contain at least one keyframe');
  }
  const first = track[0];
  const last = track[track.length - 1];
  if (time <= first.time) return first.gradient;
  if (time >= last.time) return last.gradient;
  let a = first;
  let b = last;
  for (let i = 0; i < track.length - 1; i++) {
    if (time >= track[i].time && time < track[i + 1].time) {
      a = track[i];
      b = track[i + 1];
      break;
    }
  }
  const span = b.time - a.time;
  const raw = span === 0 ? 0 : (time - a.time) / span;
  return interpolateGradient(a.gradient, b.gradient, applyEasing(a.easing, raw));
}
