// Motion editor (spec 2026-11-15-motion-editor): the framework-neutral model behind the Timeline's
// graph view. Pure functions only: `graphViewModel` reads the selected object's scalar tracks,
// and the helpers convert between a segment's easing and the absolute (time, value) positions of
// its Bézier handles. Pixel mapping stays in the component (it shares the Timeline's time scale).
import { applyEasing, easingAsBezier, isLockedInTree } from '@savig/engine';
import type { AnimatableProperty, CubicBezierEasing, Easing, Keyframe } from '@savig/engine';
import { selectActiveObjects, selectEditDuration } from '@savig/editor-state';
import type { EditorState, KeyframeRef } from '@savig/editor-state';

export interface GraphPoint {
  time: number;
  value: number;
}

export interface GraphKeyVM extends GraphPoint {
  selected: boolean;
}

/** The segment from key `index` to key `index + 1`, with its handles in (time, value). */
export interface GraphSegmentVM {
  /** Index of the segment's first key (its easing is that key's `easing`). */
  index: number;
  from: GraphPoint;
  /** The end point as interpolated (a rotation segment's shortest-path target, not the stored value). */
  to: GraphPoint;
  bezier: CubicBezierEasing;
  handleOut: GraphPoint;
  handleIn: GraphPoint;
  /** Δv = 0: handles only move in time. */
  flat: boolean;
}

export interface GraphCurveVM {
  property: AnimatableProperty;
  label: string;
  keys: GraphKeyVM[];
  segments: GraphSegmentVM[];
  /** Sampled curve over [0, duration] (holds before the first and after the last key). */
  samples: GraphPoint[];
  min: number;
  max: number;
}

export interface GraphVM {
  /** The object the graph shows, or null when nothing animatable is selected. */
  objectId: string | null;
  locked: boolean;
  duration: number;
  fps: number;
  curves: GraphCurveVM[];
  /** The curve in focus (keys + handles drawn), or null when there are no curves. */
  focus: GraphCurveVM | null;
  /** Value range of the focused curve, padded, for the vertical axis. */
  range: { min: number; max: number };
}

const LABELS: Partial<Record<AnimatableProperty, string>> = {
  x: 'X',
  y: 'Y',
  scaleX: 'Scale X',
  scaleY: 'Scale Y',
  rotation: 'Rotation',
  opacity: 'Opacity',
  skewX: 'Skew X',
  skewY: 'Skew Y',
  textPathOffset: 'Path offset',
};

/** Human label for a property chip ("cornerRadius" → "Corner radius"). */
export function propertyLabel(p: AnimatableProperty): string {
  const known = LABELS[p];
  if (known) return known;
  const words = p.replace(/([A-Z])/g, ' $1').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Named easings as Béziers: shared with the engine (insert-key splitting uses it too).
export { easingAsBezier } from '@savig/engine';

/** The value a segment interpolates towards: rotation takes the shortest path unless `raw`. */
export function segmentTarget(property: AnimatableProperty, a: Keyframe, b: Keyframe): number {
  if (property !== 'rotation' || a.rotationMode === 'raw') return b.value;
  const delta = ((((b.value - a.value) % 360) + 540) % 360) - 180;
  return a.value + delta;
}

/** Handle positions of a segment from `from` to `to` with easing `bezier`. */
export function segmentHandles(from: GraphPoint, to: GraphPoint, bezier: CubicBezierEasing): { handleOut: GraphPoint; handleIn: GraphPoint } {
  const dt = to.time - from.time;
  const dv = to.value - from.value;
  return {
    handleOut: { time: from.time + bezier.p1 * dt, value: from.value + bezier.p2 * dv },
    handleIn: { time: from.time + bezier.p3 * dt, value: from.value + bezier.p4 * dv },
  };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** The easing after dragging one handle of a segment to `p` (time x clamped to the segment;
 *  value y clamped to −1..2 of the span; a flat segment keeps its y). */
export function handleToEasing(from: GraphPoint, to: GraphPoint, bezier: CubicBezierEasing, which: 'out' | 'in', p: GraphPoint): CubicBezierEasing {
  const dt = to.time - from.time;
  const dv = to.value - from.value;
  const x = dt > 0 ? round4(clamp((p.time - from.time) / dt, 0, 1)) : which === 'out' ? bezier.p1 : bezier.p3;
  const flat = Math.abs(dv) < 1e-12;
  const y = flat ? (which === 'out' ? bezier.p2 : bezier.p4) : round4(clamp((p.value - from.value) / dv, -1, 2));
  return which === 'out' ? { ...bezier, p1: x, p2: y } : { ...bezier, p3: x, p4: y };
}

/** Round axis ticks covering [min, max] (about `count` of them). */
export function valueTicks(min: number, max: number, count = 5): number[] {
  const span = max - min;
  if (!(span > 0) || !Number.isFinite(span)) return [min];
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

function sampleTrack(property: AnimatableProperty, track: Keyframe[], duration: number): GraphPoint[] {
  const out: GraphPoint[] = [];
  const end = Math.max(duration, track[track.length - 1].time);
  out.push({ time: 0, value: track[0].value });
  if (track[0].time > 0) out.push({ time: track[0].time, value: track[0].value });
  for (let i = 0; i + 1 < track.length; i++) {
    const a = track[i];
    const b = track[i + 1];
    const target = segmentTarget(property, a, b);
    const n = 32;
    for (let k = 1; k <= n; k++) {
      const u = k / n;
      out.push({ time: a.time + u * (b.time - a.time), value: a.value + (target - a.value) * applyEasing(a.easing, u) });
    }
    // The next segment starts from the stored value (a rotation may have wrapped).
    if (target !== b.value) out.push({ time: b.time, value: b.value });
  }
  const last = track[track.length - 1];
  if (end > last.time) out.push({ time: end, value: last.value });
  return out;
}

function buildCurve(objectId: string, property: AnimatableProperty, track: Keyframe[], duration: number, sel: KeyframeRef | null): GraphCurveVM {
  const keys = track.map((k) => ({
    time: k.time,
    value: k.value,
    selected: !!sel && sel.objectId === objectId && sel.property === property && Math.abs(sel.time - k.time) < 1e-9,
  }));
  const segments: GraphSegmentVM[] = [];
  for (let i = 0; i + 1 < track.length; i++) {
    const a = track[i];
    const from = { time: a.time, value: a.value };
    const to = { time: track[i + 1].time, value: segmentTarget(property, a, track[i + 1]) };
    const bezier = easingAsBezier(a.easing);
    segments.push({ index: i, from, to, bezier, ...segmentHandles(from, to, bezier), flat: Math.abs(to.value - from.value) < 1e-12 });
  }
  const samples = sampleTrack(property, track, duration);
  let min = Infinity;
  let max = -Infinity;
  for (const p of samples) {
    min = Math.min(min, p.value);
    max = Math.max(max, p.value);
  }
  return { property, label: propertyLabel(property), keys, segments, samples, min, max };
}

/** Pad a value range for display; a flat range opens to ±1 (or ±10% of its magnitude). */
export function paddedRange(min: number, max: number): { min: number; max: number } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
  const span = max - min;
  if (span < 1e-9) {
    const half = Math.max(1, Math.abs(min) * 0.1);
    return { min: min - half, max: max + half };
  }
  return { min: min - span * 0.1, max: max + span * 0.1 };
}

/** The graph for the selected object. `focus` picks the curve; without it (or when it names no
 *  curve) the selected keyframe's property, else the first animated property, is in focus. */
/** A drag in progress: draw `property` from this track instead of the stored one (no commit). */
export interface GraphPreview {
  property: AnimatableProperty;
  track: Keyframe[];
}

/** `track` with the key at `fromTime` moved to (`time`, `value`), easing kept. A move onto another
 *  key's time is refused (the track comes back unchanged), as moveScalarKeyframe does. */
export function trackWithKeyMoved(track: Keyframe[], fromTime: number, time: number, value: number): Keyframe[] {
  const kf = track.find((k) => Math.abs(k.time - fromTime) < 1e-9);
  if (!kf) return track;
  const rest = track.filter((k) => k !== kf);
  if (rest.some((k) => Math.abs(k.time - time) < 1e-9)) return track;
  return [...rest, { ...kf, time, value }].sort((a, b) => a.time - b.time);
}

/** `track` with the easing of key `index` (the segment it starts) replaced. */
export function trackWithEasing(track: Keyframe[], index: number, easing: Easing): Keyframe[] {
  return track.map((k, i) => (i === index ? { ...k, easing } : k));
}

/** Round a dragged value to a precision that suits the visible span (about 1/1000 of it). */
export function roundForSpan(value: number, span: number): number {
  if (!(span > 0)) return value;
  const step = 10 ** Math.floor(Math.log10(span / 1000));
  return Number((Math.round(value / step) * step).toPrecision(12));
}

export function graphViewModel(state: EditorState, focus?: AnimatableProperty | null, preview?: GraphPreview | null): GraphVM {
  const fps = state.history.present.meta.fps;
  const duration = selectEditDuration(state);
  const objects = selectActiveObjects(state);
  const obj = objects.find((o) => o.id === state.selectedObjectId);
  const empty: GraphVM = { objectId: null, locked: false, duration, fps, curves: [], focus: null, range: { min: 0, max: 1 } };
  if (!obj) return empty;
  const sel = state.selectedKeyframe;
  const curves = (Object.entries(obj.tracks) as [AnimatableProperty, Keyframe[] | undefined][])
    .filter((e): e is [AnimatableProperty, Keyframe[]] => !!e[1]?.length)
    .map(([property, track]) => buildCurve(obj.id, property, preview?.property === property ? preview.track : track, duration, sel));
  const locked = isLockedInTree(obj, new Map(objects.map((o) => [o.id, o] as const)));
  const pick =
    curves.find((c) => c.property === focus) ??
    curves.find((c) => sel && sel.objectId === obj.id && c.property === sel.property) ??
    curves[0] ??
    null;
  let range = { min: 0, max: 1 };
  if (pick) {
    // Keep the focused curve's handles on screen too (an overshooting handle lies outside the curve).
    const vs = pick.segments.flatMap((sg) => (sg.flat ? [] : [sg.handleOut.value, sg.handleIn.value]));
    range = paddedRange(Math.min(pick.min, ...vs), Math.max(pick.max, ...vs));
  }
  return { objectId: obj.id, locked, duration, fps, curves, focus: pick, range };
}
