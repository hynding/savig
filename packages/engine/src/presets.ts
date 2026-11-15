// Motion presets (spec 2026-11-15-motion-presets): one-click animations as DATA. A preset is a set
// of transform tracks on normalized time (0..1 of its duration) whose values are relative to the
// object's own value where the preset starts — so "Slide in from left" works wherever the object
// sits. Pure: `applyMotionPreset` returns the object's new tracks.
import { snapToFrame, upsertKeyframe } from './keyframes';
import { sampleObject } from './sample';
import type { Easing, Keyframe, MotionPreset, PresetKey, PresetProperty, PresetTrack, SceneObject } from './types';

/** The transform properties a preset may animate. */
export const PRESET_PROPERTIES: readonly PresetProperty[] = ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'opacity'];

const off = (keys: PresetKey[]): PresetTrack => ({ mode: 'offset', keys });
const fac = (keys: PresetKey[]): PresetTrack => ({ mode: 'factor', keys });
const k = (t: number, v: number, easing?: Easing): PresetKey => (easing ? { t, v, easing } : { t, v });
const scaleBoth = (keys: PresetKey[]) => ({ scaleX: fac(keys), scaleY: fac(keys) });

/** The built-in library. Entrances end on the object's own pose, exits start from it, and
 *  emphasis presets start and end on it. */
export const BUILTIN_MOTION_PRESETS: readonly MotionPreset[] = [
  // --- Entrances ---
  { id: 'fade-in', name: 'Fade in', category: 'entrance', duration: 0.5, tracks: { opacity: fac([k(0, 0, 'easeOut'), k(1, 1)]) } },
  { id: 'slide-in-left', name: 'Slide in from left', category: 'entrance', duration: 0.6, tracks: { x: off([k(0, -200, 'easeOut'), k(1, 0)]), opacity: fac([k(0, 0, 'easeOut'), k(0.6, 1)]) } },
  { id: 'slide-in-right', name: 'Slide in from right', category: 'entrance', duration: 0.6, tracks: { x: off([k(0, 200, 'easeOut'), k(1, 0)]), opacity: fac([k(0, 0, 'easeOut'), k(0.6, 1)]) } },
  { id: 'slide-in-up', name: 'Slide in from below', category: 'entrance', duration: 0.6, tracks: { y: off([k(0, 150, 'easeOut'), k(1, 0)]), opacity: fac([k(0, 0, 'easeOut'), k(0.6, 1)]) } },
  { id: 'slide-in-down', name: 'Slide in from above', category: 'entrance', duration: 0.6, tracks: { y: off([k(0, -150, 'easeOut'), k(1, 0)]), opacity: fac([k(0, 0, 'easeOut'), k(0.6, 1)]) } },
  { id: 'pop-in', name: 'Pop in', category: 'entrance', duration: 0.5, tracks: { ...scaleBoth([k(0, 0, 'easeOut'), k(0.7, 1.12, 'easeInOut'), k(1, 1)]), opacity: fac([k(0, 0, 'easeOut'), k(0.3, 1)]) } },
  { id: 'zoom-in', name: 'Zoom in', category: 'entrance', duration: 0.6, tracks: { ...scaleBoth([k(0, 0.3, 'easeOut'), k(1, 1)]), opacity: fac([k(0, 0, 'easeOut'), k(0.5, 1)]) } },
  { id: 'drop-in', name: 'Drop in (bounce)', category: 'entrance', duration: 0.9, tracks: { y: off([k(0, -220, 'easeIn'), k(0.55, 0, 'easeOut'), k(0.72, -40, 'easeIn'), k(0.86, 0, 'easeOut'), k(0.93, -10, 'easeIn'), k(1, 0)]) } },
  { id: 'spin-in', name: 'Spin in', category: 'entrance', duration: 0.7, tracks: { rotation: off([k(0, -180, 'easeOut'), k(1, 0)]), ...scaleBoth([k(0, 0, 'easeOut'), k(1, 1)]) } },
  // --- Exits ---
  { id: 'fade-out', name: 'Fade out', category: 'exit', duration: 0.5, tracks: { opacity: fac([k(0, 1, 'easeIn'), k(1, 0)]) } },
  { id: 'slide-out-left', name: 'Slide out to left', category: 'exit', duration: 0.6, tracks: { x: off([k(0, 0, 'easeIn'), k(1, -200)]), opacity: fac([k(0.4, 1, 'easeIn'), k(1, 0)]) } },
  { id: 'slide-out-right', name: 'Slide out to right', category: 'exit', duration: 0.6, tracks: { x: off([k(0, 0, 'easeIn'), k(1, 200)]), opacity: fac([k(0.4, 1, 'easeIn'), k(1, 0)]) } },
  { id: 'pop-out', name: 'Pop out', category: 'exit', duration: 0.5, tracks: { ...scaleBoth([k(0, 1, 'easeInOut'), k(0.3, 1.12, 'easeIn'), k(1, 0)]), opacity: fac([k(0.7, 1, 'easeIn'), k(1, 0)]) } },
  { id: 'zoom-out', name: 'Zoom out', category: 'exit', duration: 0.6, tracks: { ...scaleBoth([k(0, 1, 'easeIn'), k(1, 0.3)]), opacity: fac([k(0.5, 1, 'easeIn'), k(1, 0)]) } },
  // --- Emphasis ---
  { id: 'pulse', name: 'Pulse', category: 'emphasis', duration: 0.6, tracks: scaleBoth([k(0, 1), k(0.5, 1.15), k(1, 1)]) },
  { id: 'shake', name: 'Shake', category: 'emphasis', duration: 0.5, tracks: { x: off([k(0, 0, 'linear'), k(0.15, -12, 'linear'), k(0.35, 12, 'linear'), k(0.55, -9, 'linear'), k(0.75, 6, 'linear'), k(1, 0)]) } },
  { id: 'wobble', name: 'Wobble', category: 'emphasis', duration: 0.8, tracks: { rotation: off([k(0, 0), k(0.2, -10), k(0.4, 8), k(0.6, -5), k(0.8, 2), k(1, 0)]) } },
  { id: 'bounce', name: 'Bounce', category: 'emphasis', duration: 0.8, tracks: { y: off([k(0, 0, 'easeOut'), k(0.3, -40, 'easeIn'), k(0.55, 0, 'easeOut'), k(0.75, -15, 'easeIn'), k(1, 0)]) } },
  { id: 'flash', name: 'Flash', category: 'emphasis', duration: 0.8, tracks: { opacity: fac([k(0, 1, 'linear'), k(0.25, 0, 'linear'), k(0.5, 1, 'linear'), k(0.75, 0, 'linear'), k(1, 1)]) } },
  { id: 'spin', name: 'Spin', category: 'emphasis', duration: 1, tracks: { rotation: off([k(0, 0), k(1, 360)]) } },
];

export function findMotionPreset(id: string, extra: readonly MotionPreset[] = []): MotionPreset | undefined {
  return extra.find((p) => p.id === id) ?? BUILTIN_MOTION_PRESETS.find((p) => p.id === id);
}

export interface ApplyPresetOpts {
  /** Start time in seconds (frame-snapped). */
  start: number;
  /** Seconds; default the preset's own duration. */
  duration?: number;
  fps: number;
}

/** The object's tracks with `preset` applied from `opts.start`: each animated property gets the
 *  preset's keys (relative to the property's value at the start), replacing any keys of that
 *  property inside the preset's window. Rotation keys are written `raw`, so a 360° spin turns. */
export function applyMotionPreset(obj: SceneObject, preset: MotionPreset, opts: ApplyPresetOpts): SceneObject['tracks'] {
  const fps = opts.fps;
  const start = Math.max(0, snapToFrame(opts.start, fps));
  const duration = Math.max(1 / fps, opts.duration ?? preset.duration);
  const end = start + duration;
  const at = sampleObject(obj, start);
  const tracks = { ...obj.tracks };
  for (const prop of PRESET_PROPERTIES) {
    const spec = preset.tracks[prop];
    if (!spec?.keys.length) continue;
    const base = at[prop];
    const value = (v: number) => (spec.mode === 'offset' ? base + v : spec.mode === 'factor' ? base * v : v);
    const eps = 1e-6;
    // Keys inside the window give way to the preset; keys outside it stay.
    let track: Keyframe[] = (tracks[prop] ?? []).filter((kf) => kf.time < start - eps || kf.time > end + eps);
    for (const key of spec.keys) {
      const time = snapToFrame(start + key.t * duration, fps);
      const kf: Keyframe = { time, value: value(key.v), easing: key.easing ?? 'easeInOut' };
      if (prop === 'rotation') kf.rotationMode = 'raw';
      track = upsertKeyframe(track, kf);
    }
    tracks[prop] = track;
  }
  return tracks;
}

/** Capture an object's transform animation as a custom preset (spec 2026-11-15-motion-presets
 *  slice 2). The window runs from the first to the last key of its transform tracks; values are
 *  stored relative to the pose at the window's start (offset for position and rotation, factor
 *  for scale and opacity unless that start value is 0, then absolute), so applying the preset to
 *  the same object at the same time reproduces its motion. Null when there is nothing to capture
 *  (no transform keys, or all keys at one instant). */
export function presetFromObject(obj: SceneObject, opts: { id: string; name: string }): MotionPreset | null {
  const props = PRESET_PROPERTIES.filter((p) => (obj.tracks[p]?.length ?? 0) > 0);
  if (!props.length) return null;
  const t0 = Math.min(...props.map((p) => obj.tracks[p]![0].time));
  const t1 = Math.max(...props.map((p) => obj.tracks[p]!.at(-1)!.time));
  const duration = t1 - t0;
  if (!(duration > 1e-9)) return null;
  const pose = sampleObject(obj, t0);
  const tracks: MotionPreset['tracks'] = {};
  for (const p of props) {
    const base = pose[p];
    const scaled = p === 'scaleX' || p === 'scaleY' || p === 'opacity';
    const mode: PresetTrack['mode'] = scaled ? (Math.abs(base) > 1e-9 ? 'factor' : 'absolute') : 'offset';
    tracks[p] = {
      mode,
      keys: obj.tracks[p]!.map((kf): PresetKey => ({
        t: (kf.time - t0) / duration,
        v: mode === 'offset' ? kf.value - base : mode === 'factor' ? kf.value / base : kf.value,
        easing: kf.easing,
      })),
    };
  }
  return { id: opts.id, name: opts.name, category: 'custom', duration, tracks };
}

/** True when `x` is a well-formed motion preset (load-time check for project files). */
export function isMotionPreset(x: unknown): x is MotionPreset {
  if (!x || typeof x !== 'object') return false;
  const p = x as Record<string, unknown>;
  if (typeof p.id !== 'string' || !p.id || typeof p.name !== 'string') return false;
  if (!['entrance', 'exit', 'emphasis', 'custom'].includes(p.category as string)) return false;
  if (typeof p.duration !== 'number' || !(p.duration > 0) || !Number.isFinite(p.duration)) return false;
  if (!p.tracks || typeof p.tracks !== 'object') return false;
  for (const [prop, tr] of Object.entries(p.tracks as Record<string, unknown>)) {
    if (!(PRESET_PROPERTIES as readonly string[]).includes(prop)) return false;
    const t = tr as Record<string, unknown> | null;
    if (!t || !['offset', 'factor', 'absolute'].includes(t.mode as string) || !Array.isArray(t.keys)) return false;
    for (const k of t.keys as Record<string, unknown>[]) {
      if (!k || typeof k.t !== 'number' || typeof k.v !== 'number' || !Number.isFinite(k.t) || !Number.isFinite(k.v)) return false;
    }
  }
  return true;
}
