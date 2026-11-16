// Property modifiers (spec 2026-11-16-property-modifiers): procedural motion on a numeric property
// with no hand-placed keys. `wiggle` adds smooth deterministic noise to whatever the property
// would otherwise be (its keyed curve or its static base); `loop` repeats the keyed span after the
// last key (`cycle` starts over, `pingpong` plays back and forth). Applied inside `sampleObject`, so
// the editor, the runtime and every export (SVG, CSS, HTML, Lottie, PNG, GIF, video) pick them up
// with no further work.

import type { AnimatableProperty, Keyframe, LoopMode, PropertyModifier, SceneObject, Wiggle } from './types';

export const LOOP_MODES: readonly LoopMode[] = ['cycle', 'pingpong'];

/** Properties that take modifiers: the transform plus vector geometry. */
export const MODIFIABLE_PROPERTIES: readonly AnimatableProperty[] = [
  'x', 'y', 'scaleX', 'scaleY', 'rotation', 'opacity', 'width', 'height', 'radiusX', 'radiusY', 'cornerRadius',
];


/** Sensible default wiggle size for a property (in that property's units). */
export function defaultWiggleAmplitude(prop: AnimatableProperty): number {
  switch (prop) {
    case 'rotation':
      return 10;
    case 'scaleX':
    case 'scaleY':
      return 0.1;
    case 'opacity':
      return 0.2;
    default:
      return 10;
  }
}

export const WIGGLE_MAX_FREQUENCY = 30;

/** Remap `time` for a looping keyed track: unchanged up to the last key, then repeated. */
export function loopTime(track: Keyframe[], time: number, mode: LoopMode): number {
  if (track.length < 2) return time;
  const t0 = track[0].time;
  const t1 = track[track.length - 1].time;
  const span = t1 - t0;
  if (!(span > 0) || time <= t1) return time;
  const k = (time - t0) / span;
  const cycle = Math.floor(k);
  const frac = k - cycle;
  if (mode === 'pingpong') return cycle % 2 === 0 ? t0 + frac * span : t1 - frac * span;
  return t0 + frac * span;
}

// 32-bit integer hash -> [-1, 1].
function lattice(seed: number, salt: number, i: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(seed + 0x7f4a7c15, 0xc2b2ae35) ^ Math.imul(salt, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
}

function saltOf(prop: string): number {
  let h = 0;
  for (let i = 0; i < prop.length; i++) h = (Math.imul(h, 31) + prop.charCodeAt(i)) | 0;
  return h;
}

/** Smooth deterministic noise in about [-1, 1] at `u` (lattice units): Catmull-Rom through hashed
 *  lattice values, so it is continuous with a continuous slope. */
export function smoothNoise(seed: number, salt: number, u: number): number {
  const i = Math.floor(u);
  const f = u - i;
  const p0 = lattice(seed, salt, i - 1);
  const p1 = lattice(seed, salt, i);
  const p2 = lattice(seed, salt, i + 1);
  const p3 = lattice(seed, salt, i + 2);
  const f2 = f * f;
  const f3 = f2 * f;
  return 0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f2 + (-p0 + 3 * p1 - 3 * p2 + p3) * f3);
}

/** The wiggle offset for `prop` at `time`. 0 when amplitude or frequency is 0. */
export function wiggleOffset(w: Wiggle, prop: string, time: number): number {
  if (!(w.amplitude !== 0) || !(w.frequency > 0)) return 0;
  return w.amplitude * Math.max(-1, Math.min(1, smoothNoise(w.seed ?? 0, saltOf(prop), time * w.frequency)));
}

/** Apply `obj`'s modifier for `prop`: keyed tracks loop, then the wiggle is added. */
export function modifiedValue(
  obj: SceneObject,
  prop: AnimatableProperty,
  time: number,
  sampleAt: (t: number) => number,
): number {
  const m = obj.modifiers?.[prop];
  if (!m) return sampleAt(time);
  const track = obj.tracks[prop];
  const t = m.loop && track && track.length >= 2 ? loopTime(track, time, m.loop) : time;
  let v = sampleAt(t);
  if (m.wiggle) v += wiggleOffset(m.wiggle, prop, time);
  return v;
}

export function isPropertyModifier(v: unknown): v is PropertyModifier {
  if (!v || typeof v !== 'object') return false;
  const m = v as Record<string, unknown>;
  if (m.loop !== undefined && !LOOP_MODES.includes(m.loop as LoopMode)) return false;
  if (m.wiggle !== undefined) {
    const w = m.wiggle as Record<string, unknown>;
    if (!w || typeof w !== 'object') return false;
    if (typeof w.amplitude !== 'number' || !Number.isFinite(w.amplitude)) return false;
    if (typeof w.frequency !== 'number' || !Number.isFinite(w.frequency) || w.frequency < 0) return false;
    if (w.seed !== undefined && (typeof w.seed !== 'number' || !Number.isInteger(w.seed))) return false;
  }
  return m.loop !== undefined || m.wiggle !== undefined;
}

/** The wiggle part of `prop`'s value at `time` (0 without a wiggle). Editors subtract it when
 *  writing a value the user set by eye, so the wiggle rides on top instead of being baked in. */
export function wiggleAt(obj: SceneObject, prop: AnimatableProperty, time: number): number {
  const w = obj.modifiers?.[prop]?.wiggle;
  return w ? wiggleOffset(w, prop, time) : 0;
}

/** `obj` with `prop`'s modifier set to `m` (merged), or removed when `m` is null or ends up empty.
 *  `modifiers` itself is dropped when the last one goes (parity at rest). */
export function withModifier(obj: SceneObject, prop: AnimatableProperty, m: Partial<PropertyModifier> | null): SceneObject {
  const cur = obj.modifiers?.[prop] ?? {};
  const next: PropertyModifier = m === null ? {} : { ...cur, ...m };
  if (next.wiggle === undefined) delete next.wiggle;
  if (next.loop === undefined) delete next.loop;
  const all = { ...(obj.modifiers ?? {}) };
  if (next.wiggle || next.loop) all[prop] = next;
  else delete all[prop];
  const out: SceneObject = { ...obj, modifiers: all };
  if (Object.keys(all).length === 0) delete out.modifiers;
  return out;
}
