/** Semantic animation macros — verbs an agent composes (fadeIn, moveTo, spin, stagger…) that
 *  expand to the slice-1 `setKeyframe` calls. Raises the abstraction from cubic-bezier numbers to
 *  intent, which is where an LLM is strongest. Pure; each returns a new `Project`. */
import { applyMotionPreset as applyPresetTracks, createPresetPack, findMotionPreset, mergePresets, newId, presetFromObject, readPresetPack } from '@savig/engine';
import type { PresetPack } from '@savig/engine';
import type { Easing, Project, SceneObject } from '@savig/engine';
import { setKeyframe, setTrimKeyframe } from './build';

export interface TimingOpts {
  /** Start time in seconds (default 0). */
  start?: number;
  /** Duration in seconds (default 0.5). */
  duration?: number;
  /** Easing of the TO keyframe (default 'easeInOut'). */
  easing?: Easing;
}

function requireObject(project: Project, id: string): SceneObject {
  const o = project.objects.find((x) => x.id === id);
  if (!o) throw new Error(`savig/core: no object with id "${id}"`);
  return o;
}

function ramp(
  project: Project,
  objectId: string,
  property: Parameters<typeof setKeyframe>[1]['property'],
  from: number,
  to: number,
  t: TimingOpts,
): Project {
  const start = t.start ?? 0;
  const duration = t.duration ?? 0.5;
  let p = setKeyframe(project, { objectId, property, time: start, value: from });
  p = setKeyframe(p, { objectId, property, time: start + duration, value: to, easing: t.easing ?? 'easeInOut' });
  return p;
}

/** Fade opacity 0 → 1. */
export function fadeIn(project: Project, objectId: string, t: TimingOpts = {}): Project {
  return ramp(project, objectId, 'opacity', 0, 1, t);
}

/** Fade opacity 1 → 0. */
export function fadeOut(project: Project, objectId: string, t: TimingOpts = {}): Project {
  return ramp(project, objectId, 'opacity', 1, 0, t);
}

/** Move to an absolute (x, y). Either axis may be omitted (left unanimated). `from` defaults to the
 *  object's current base position. */
export function moveTo(
  project: Project,
  objectId: string,
  to: { x?: number; y?: number; fromX?: number; fromY?: number },
  t: TimingOpts = {},
): Project {
  const obj = requireObject(project, objectId);
  let p = project;
  if (to.x !== undefined) p = ramp(p, objectId, 'x', to.fromX ?? obj.base.x, to.x, t);
  if (to.y !== undefined) p = ramp(p, objectId, 'y', to.fromY ?? obj.base.y, to.y, t);
  return p;
}

/** Scale to a target factor (uniform `scale`, or per-axis). `from` defaults to the object's base. */
export function scaleTo(
  project: Project,
  objectId: string,
  to: { scale?: number; scaleX?: number; scaleY?: number; from?: number },
  t: TimingOpts = {},
): Project {
  const obj = requireObject(project, objectId);
  const targetX = to.scaleX ?? to.scale;
  const targetY = to.scaleY ?? to.scale;
  let p = project;
  if (targetX !== undefined) p = ramp(p, objectId, 'scaleX', to.from ?? obj.base.scaleX, targetX, t);
  if (targetY !== undefined) p = ramp(p, objectId, 'scaleY', to.from ?? obj.base.scaleY, targetY, t);
  return p;
}

/** Rotate to an absolute angle (degrees). `from` defaults to the object's base rotation. */
export function rotateTo(project: Project, objectId: string, toDeg: number, t: TimingOpts & { from?: number } = {}): Project {
  const obj = requireObject(project, objectId);
  return ramp(project, objectId, 'rotation', t.from ?? obj.base.rotation, toDeg, t);
}

/** Spin `turns` full rotations from the current base angle (linear by default). */
export function spin(project: Project, objectId: string, turns: number, t: TimingOpts = {}): Project {
  const obj = requireObject(project, objectId);
  const from = obj.base.rotation;
  return ramp(project, objectId, 'rotation', from, from + 360 * turns, { easing: 'linear', ...t });
}

/** Pop: scale up to `scale` and back to the base scale over the duration (3 keyframes, easeInOut). */
export function pulse(project: Project, objectId: string, scale: number, t: TimingOpts = {}): Project {
  const obj = requireObject(project, objectId);
  const start = t.start ?? 0;
  const duration = t.duration ?? 0.5;
  const mid = start + duration / 2;
  let p = project;
  for (const prop of ['scaleX', 'scaleY'] as const) {
    const b = prop === 'scaleX' ? obj.base.scaleX : obj.base.scaleY;
    p = setKeyframe(p, { objectId, property: prop, time: start, value: b });
    p = setKeyframe(p, { objectId, property: prop, time: mid, value: scale, easing: t.easing ?? 'easeInOut' });
    p = setKeyframe(p, { objectId, property: prop, time: start + duration, value: b, easing: t.easing ?? 'easeInOut' });
  }
  return p;
}

/** Stroke draw-on: trim `end` 0 → 1 (reveals the stroke along its path). */
export function drawOn(project: Project, objectId: string, t: TimingOpts = {}): Project {
  const start = t.start ?? 0;
  const duration = t.duration ?? 0.5;
  let p = setTrimKeyframe(project, { objectId, prop: 'end', time: start, value: 0 });
  p = setTrimKeyframe(p, { objectId, prop: 'end', time: start + duration, value: 1, easing: t.easing ?? 'easeInOut' });
  return p;
}

/** Apply a per-object macro to many objects with a staggered start (each id offset by `stride`
 *  seconds). `apply(project, id, start) => project` — compose any macro: e.g.
 *  `stagger(p, ids, 0.1, (p, id, start) => fadeIn(p, id, { start }))`. */
export function stagger(
  project: Project,
  ids: string[],
  stride: number,
  apply: (project: Project, id: string, start: number) => Project,
): Project {
  let p = project;
  ids.forEach((id, i) => {
    p = apply(p, id, i * stride);
  });
  return p;
}

/** Apply a motion preset (spec 2026-11-15-motion-presets; ids from `BUILTIN_MOTION_PRESETS`, e.g.
 *  'pop-in', 'slide-in-left', 'shake', 'fade-out') from `start` (default 0), optionally stretched
 *  to `duration` seconds. Values are relative to the object's pose at `start`. */
export function motionPreset(project: Project, objectId: string, presetId: string, t: { start?: number; duration?: number } = {}): Project {
  const obj = requireObject(project, objectId);
  const preset = findMotionPreset(presetId, project.motionPresets);
  if (!preset) throw new Error(`savig/core: no motion preset "${presetId}"`);
  const tracks = applyPresetTracks(obj, preset, { start: t.start ?? 0, duration: t.duration, fps: project.meta.fps });
  return { ...project, objects: project.objects.map((o) => (o.id === objectId ? { ...o, tracks } : o)) };
}

/** Save an object's transform animation as a project motion preset (relative to its pose at its
 *  first key) under `id` (default derived from the name). Reuse it with `motionPreset`. */
export function saveMotionPreset(project: Project, objectId: string, name: string, id?: string): Project {
  const obj = requireObject(project, objectId);
  const pid = id ?? `custom-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'preset'}`;
  if (findMotionPreset(pid, project.motionPresets)) throw new Error(`savig/core: a motion preset "${pid}" already exists`);
  const preset = presetFromObject(obj, { id: pid, name });
  if (!preset) throw new Error(`savig/core: "${objectId}" has no transform keyframes spanning time to save`);
  return { ...project, motionPresets: [...(project.motionPresets ?? []), preset] };
}

/** Preset packs (spec 2026-11-16-preset-library): the project's saved motion presets as a
 *  shareable pack (the same file format the editor's Export pack writes). */
export function exportPresetPack(project: Project, name?: string): PresetPack {
  return createPresetPack(project.motionPresets ?? [], name);
}

/** Add a preset pack's presets (parsed JSON: a pack, an array, or one preset) to the project.
 *  Exact duplicates are skipped; clashing ids get fresh ones. Throws when it holds no presets. */
export function importPresetPack(project: Project, json: unknown): { project: Project; added: number; skipped: number } {
  const { presets, added, skipped } = mergePresets(project.motionPresets ?? [], readPresetPack(json), newId);
  return { project: added ? { ...project, motionPresets: presets } : project, added, skipped };
}
