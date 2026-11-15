// Motion presets (spec 2026-11-15-motion-presets): one-click animations as DATA. A preset is a set
// of transform tracks on normalized time (0..1 of its duration) whose values are relative to the
// object's own value where the preset starts — so "Slide in from left" works wherever the object
// sits. Pure: `applyMotionPreset` returns the object's new tracks.
import { snapToFrame, upsertKeyframe } from './keyframes';
import { sampleObject } from './sample';
import type { Easing, Keyframe, SceneObject } from './types';

/** The transform properties a preset may animate. */
export const PRESET_PROPERTIES = ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'opacity'] as const;
export type PresetProperty = (typeof PRESET_PROPERTIES)[number];

/** How a preset value relates to the object's value at the start:
 *  - `offset`: base + v (position, rotation)
 *  - `factor`: base × v (scale; opacity that should end at the object's own opacity)
 *  - `absolute`: v as is */
export type PresetValueMode = 'offset' | 'factor' | 'absolute';

export interface PresetKey {
  /** 0..1 of the preset's duration. */
  t: number;
  v: number;
  /** Easing of the segment that starts here (default 'easeInOut'). */
  easing?: Easing;
}

export interface PresetTrack {
  mode: PresetValueMode;
  keys: PresetKey[];
}

export type MotionPresetCategory = 'entrance' | 'exit' | 'emphasis' | 'custom';

export interface MotionPreset {
  id: string;
  name: string;
  category: MotionPresetCategory;
  /** Default duration in seconds. */
  duration: number;
  tracks: Partial<Record<PresetProperty, PresetTrack>>;
}

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
