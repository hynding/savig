import { applyEasing } from './easing';
import { interpolateColor } from './color';
import type { Gradient, GradientKeyframe, GradientStop } from './types';

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const STOP_EPS = 1e-6;

// Piecewise-linear sample of a (sorted-defensively) stop list at `offset`, clamped to
// the first/last stop outside the range. Returns a canonical GradientStop.
export function stopAt(stops: GradientStop[], offset: number): GradientStop {
  const sorted = [...stops].sort((p, q) => p.offset - q.offset);
  if (offset <= sorted[0].offset) return { ...sorted[0], offset };
  const last = sorted[sorted.length - 1];
  if (offset >= last.offset) return { ...last, offset };
  let lo = sorted[0];
  let hi = last;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (offset >= sorted[i].offset && offset <= sorted[i + 1].offset) {
      lo = sorted[i];
      hi = sorted[i + 1];
      break;
    }
  }
  const span = hi.offset - lo.offset;
  const local = span < STOP_EPS ? 0 : (offset - lo.offset) / span;
  const stop: GradientStop = { offset, color: interpolateColor(lo.color, hi.color, local) };
  const olo = lo.opacity ?? 1;
  const ohi = hi.opacity ?? 1;
  if (olo !== 1 || ohi !== 1) {
    const o = lerp(olo, ohi, local);
    if (o < 1) stop.opacity = o; // canonical: omit when fully opaque
  }
  return stop;
}

// Resample both stop lists at the sorted-unique union of their offsets so they share
// offsets and length (then lerpStops applies). Inserted stops are colinear -> seamless.
function reconcileStops(a: GradientStop[], b: GradientStop[]): { an: GradientStop[]; bn: GradientStop[] } {
  const offsets: number[] = [];
  for (const o of [...a, ...b].map((s) => s.offset).sort((p, q) => p - q)) {
    if (offsets.length === 0 || o - offsets[offsets.length - 1] > STOP_EPS) offsets.push(o);
  }
  return { an: offsets.map((o) => stopAt(a, o)), bn: offsets.map((o) => stopAt(b, o)) };
}

function lerpStops(a: GradientStop[], b: GradientStop[], t: number): GradientStop[] {
  return a.map((sa, i) => {
    const sb = b[i];
    const stop: GradientStop = {
      offset: lerp(sa.offset, sb.offset, t),
      color: interpolateColor(sa.color, sb.color, t),
    };
    const oa = sa.opacity ?? 1;
    const ob = sb.opacity ?? 1;
    if (oa !== 1 || ob !== 1) {
      // Omit when the lerped value is fully opaque so the result stays structurally
      // canonical (opacity omitted == 1), matching gradientStopAttrs' emit rule.
      const o = lerp(oa, ob, t);
      if (o < 1) stop.opacity = o;
    }
    return stop;
  });
}

/**
 * Interpolate two gradients. STEPS-holds (returns `a` until t>=1, then `b`) only on a
 * TYPE mismatch (linear<->radial morph is geometrically ambiguous). Same-type gradients
 * with DIFFERENT stop counts are reconciled to the union of their offsets (slice 34) and
 * then lerped; same count keeps the index-lerp. Geometry, per-stop offset/opacity, and
 * colors lerp (via interpolateColor, inheriting its hold-on-unparseable behavior).
 */
export function interpolateGradient(a: Gradient, b: Gradient, t: number): Gradient {
  if (a.type !== b.type) {
    return t >= 1 ? b : a;
  }
  const { an, bn } =
    a.stops.length === b.stops.length ? { an: a.stops, bn: b.stops } : reconcileStops(a.stops, b.stops);
  const stops = lerpStops(an, bn, t);
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
    // The focal point is atomic (SVG pairs fx/fy): lerp only when BOTH endpoints
    // fully define it, otherwise hold it absent so we never emit a half-set focal.
    if (a.fx !== undefined && a.fy !== undefined && b.fx !== undefined && b.fy !== undefined) {
      out.fx = lerp(a.fx, b.fx, t);
      out.fy = lerp(a.fy, b.fy, t);
    }
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
