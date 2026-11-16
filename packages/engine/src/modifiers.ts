// Property modifiers (spec 2026-11-16-property-modifiers): procedural motion on a numeric property
// with no hand-placed keys. `wiggle` adds smooth deterministic noise to whatever the property
// would otherwise be (its keyed curve or its static base); `loop` repeats the keyed span after the
// last key (`cycle` starts over, `pingpong` plays back and forth). Applied inside `sampleObject`, so
// the editor, the runtime and every export (SVG, CSS, HTML, Lottie, PNG, GIF, video) pick them up
// with no further work.

//
// Modifiers everywhere (spec 2026-11-16-modifiers-everywhere) widens the targets beyond `tracks`:
// trim window, motion-path progress, primitive params, text-path offset and filter params take
// wiggle + loop; color, gradient and shape-morph tracks take loop only; the camera takes both per
// axis. Every sampler goes through `applyModifier` / `modifierTime`.

import type {
  AnimatableProperty, CameraAxis, LoopMode, LoopOnlyTarget, ModifierChannel, ModifierTarget, PropertyModifier,
  SceneObject, Wiggle,
} from './types';

export const LOOP_MODES: readonly LoopMode[] = ['cycle', 'pingpong'];

/** Properties that take modifiers: the transform plus vector geometry. */
export const MODIFIABLE_PROPERTIES: readonly AnimatableProperty[] = [
  'x', 'y', 'scaleX', 'scaleY', 'rotation', 'opacity', 'width', 'height', 'radiusX', 'radiusY', 'cornerRadius',
];

/** Further numeric `tracks` properties that take modifiers (modifiers everywhere). */
export const EXTRA_MODIFIABLE_PROPERTIES: readonly AnimatableProperty[] = [
  'sides', 'starPoints', 'innerRatio', 'primitiveRotation', 'textPathOffset',
];

/** Numeric channels outside `tracks`. */
export const MODIFIER_CHANNELS: readonly ModifierChannel[] = ['trimStart', 'trimEnd', 'trimOffset', 'motionProgress'];

/** Keyed tracks that loop but cannot wiggle (not numbers). */
export const LOOP_ONLY_TARGETS: readonly LoopOnlyTarget[] = ['fill', 'stroke', 'fillGradient', 'strokeGradient', 'shape'];

export const CAMERA_AXES: readonly CameraAxis[] = ['x', 'y', 'zoom', 'rotation'];

const FILTER_PREFIX = 'filter:';

/** The modifier key for a filter param. */
export const filterModifierKey = (filterId: string, param: string): `filter:${string}` => `filter:${filterId}.${param}`;

/** `{ filterId, param }` for a filter modifier key, or null for any other key. */
export function parseFilterModifierKey(key: string): { filterId: string; param: string } | null {
  if (!key.startsWith(FILTER_PREFIX)) return null;
  const rest = key.slice(FILTER_PREFIX.length);
  const dot = rest.lastIndexOf('.');
  if (dot <= 0 || dot === rest.length - 1) return null;
  return { filterId: rest.slice(0, dot), param: rest.slice(dot + 1) };
}

/** True for every key an object modifier may use. */
export function isModifierTarget(key: unknown): key is ModifierTarget {
  if (typeof key !== 'string') return false;
  return (
    (MODIFIABLE_PROPERTIES as readonly string[]).includes(key) ||
    (EXTRA_MODIFIABLE_PROPERTIES as readonly string[]).includes(key) ||
    (MODIFIER_CHANNELS as readonly string[]).includes(key) ||
    (LOOP_ONLY_TARGETS as readonly string[]).includes(key) ||
    parseFilterModifierKey(key) !== null
  );
}

/** False for the loop-only targets (colors, gradients, shape morph). */
export function canWiggle(key: ModifierTarget): boolean {
  return !(LOOP_ONLY_TARGETS as readonly string[]).includes(key);
}

/** The keyed track a target's LOOP repeats (any track shape: only `time` is read). */
export function modifierTrack(obj: SceneObject, key: ModifierTarget): readonly { time: number }[] | undefined {
  switch (key) {
    case 'fill':
    case 'stroke':
      return obj.colorTracks?.[key];
    case 'fillGradient':
      return obj.gradientTracks?.fill;
    case 'strokeGradient':
      return obj.gradientTracks?.stroke;
    case 'shape':
      return obj.shapeTrack;
    case 'trimStart':
      return obj.trim?.startTrack;
    case 'trimEnd':
      return obj.trim?.endTrack;
    case 'trimOffset':
      return obj.trim?.offsetTrack;
    case 'motionProgress':
      return obj.motionPath?.progress;
  }
  const f = parseFilterModifierKey(key);
  if (f) return obj.filterTracks?.[`${f.filterId}.${f.param}`];
  return obj.tracks[key as AnimatableProperty];
}


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

const FILTER_PARAM_WIGGLE: Record<string, number> = {
  blur: 2, dx: 4, dy: 4, opacity: 0.2, strength: 0.5, brightness: 0.2, contrast: 0.2, saturation: 0.3, hue: 30,
};

/** Default wiggle size for any wiggle-able target (object channel, filter param). */
export function defaultModifierAmplitude(key: ModifierTarget): number {
  switch (key) {
    case 'trimStart':
    case 'trimEnd':
    case 'trimOffset':
    case 'innerRatio':
      return 0.1;
    case 'motionProgress':
    case 'textPathOffset':
      return 0.05;
    case 'sides':
    case 'starPoints':
      return 1;
    case 'primitiveRotation':
      return 10;
  }
  const f = parseFilterModifierKey(key);
  if (f) return FILTER_PARAM_WIGGLE[f.param] ?? 1;
  return defaultWiggleAmplitude(key as AnimatableProperty);
}

/** Default camera-shake size per axis. */
export function defaultCameraWiggleAmplitude(axis: CameraAxis): number {
  return axis === 'zoom' ? 0.05 : axis === 'rotation' ? 2 : 10;
}

export const WIGGLE_MAX_FREQUENCY = 30;

/** Remap `time` for a looping keyed track: unchanged up to the last key, then repeated. */
export function loopTime(track: readonly { time: number }[], time: number, mode: LoopMode): number {
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

/** The time a looping track is read at (unchanged without a loop or with fewer than two keys). */
export function modifierTime(m: PropertyModifier | undefined, track: readonly { time: number }[] | undefined, time: number): number {
  return m?.loop && track && track.length >= 2 ? loopTime(track, time, m.loop) : time;
}

/** Apply modifier `m` (salted by `salt`, usually the target key): the keyed `track` loops, then the
 *  wiggle is added. `sampleAt` reads the unmodified value. */
export function applyModifier(
  m: PropertyModifier | undefined,
  salt: string,
  track: readonly { time: number }[] | undefined,
  time: number,
  sampleAt: (t: number) => number,
): number {
  if (!m) return sampleAt(time);
  let v = sampleAt(modifierTime(m, track, time));
  if (m.wiggle) v += wiggleOffset(m.wiggle, salt, time);
  return v;
}

/** Apply `obj`'s modifier for `prop`: keyed tracks loop, then the wiggle is added. */
export function modifiedValue(
  obj: SceneObject,
  prop: ModifierTarget,
  time: number,
  sampleAt: (t: number) => number,
): number {
  return applyModifier(obj.modifiers?.[prop], prop, modifierTrack(obj, prop), time, sampleAt);
}

/** The time `obj`'s loop-only target `key` (color, gradient, shape morph) is read at. */
export function objectModifierTime(obj: SceneObject, key: ModifierTarget, time: number): number {
  const m = obj.modifiers?.[key];
  return m ? modifierTime(m, modifierTrack(obj, key), time) : time;
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
export function wiggleAt(obj: SceneObject, prop: ModifierTarget, time: number): number {
  const w = obj.modifiers?.[prop]?.wiggle;
  return w ? wiggleOffset(w, prop, time) : 0;
}

/** `obj` with `prop`'s modifier set to `m` (merged), or removed when `m` is null or ends up empty.
 *  `modifiers` itself is dropped when the last one goes (parity at rest). */
export function withModifier(obj: SceneObject, prop: ModifierTarget, m: Partial<PropertyModifier> | null): SceneObject {
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

/** `obj` without the modifiers of filter `filterId` (when the filter is removed). */
export function withoutFilterModifiers(obj: SceneObject, filterId: string): SceneObject {
  if (!obj.modifiers) return obj;
  const keys = Object.keys(obj.modifiers).filter((k) => parseFilterModifierKey(k)?.filterId === filterId);
  if (keys.length === 0) return obj;
  const all = { ...obj.modifiers } as Record<string, PropertyModifier>;
  for (const k of keys) delete all[k];
  const out: SceneObject = { ...obj, modifiers: all };
  if (Object.keys(all).length === 0) delete out.modifiers;
  return out;
}

/** Merge (or with null remove) a camera axis modifier; `modifiers` is dropped when empty. */
export function withCameraModifier<C extends { modifiers?: Partial<Record<CameraAxis, PropertyModifier>> }>(
  camera: C, axis: CameraAxis, m: Partial<PropertyModifier> | null,
): C {
  const cur = camera.modifiers?.[axis] ?? {};
  const next: PropertyModifier = m === null ? {} : { ...cur, ...m };
  if (next.wiggle === undefined) delete next.wiggle;
  if (next.loop === undefined) delete next.loop;
  const all = { ...(camera.modifiers ?? {}) };
  if (next.wiggle || next.loop) all[axis] = next;
  else delete all[axis];
  const out: C = { ...camera, modifiers: all };
  if (Object.keys(all).length === 0) delete (out as { modifiers?: unknown }).modifiers;
  return out;
}
