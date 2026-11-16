// Property modifiers (specs 2026-11-16-property-modifiers, 2026-11-16-modifiers-everywhere), agent
// surface. Root scene, fail loud.
import {
  CAMERA_AXES, canWiggle, defaultCameraPose, EXTRA_MODIFIABLE_PROPERTIES, isModifierTarget, isPropertyModifier, LOOP_MODES,
  LOOP_ONLY_TARGETS, MODIFIABLE_PROPERTIES, MODIFIER_CHANNELS, parseFilterModifierKey, withCameraModifier, withModifier,
} from '@savig/engine';
import type { CameraAxis, LoopMode, ModifierTarget, Project, PropertyModifier, Wiggle } from '@savig/engine';

export interface ModifierInput {
  /** Wiggle to set; null removes the wiggle. Omitted = unchanged. */
  wiggle?: Wiggle | null;
  /** Loop mode after the last key; 'none' or null removes it. Omitted = unchanged. */
  loop?: LoopMode | 'none' | null;
}

const TARGET_LIST = [...MODIFIABLE_PROPERTIES, ...EXTRA_MODIFIABLE_PROPERTIES, ...MODIFIER_CHANNELS, ...LOOP_ONLY_TARGETS, 'filter:<filterId>.<param>'].join(', ');

function patchOf(input: ModifierInput, wiggleOk: boolean, what: string): { wiggle?: Wiggle; loop?: LoopMode } {
  const patch: { wiggle?: Wiggle; loop?: LoopMode } = {};
  if (input.loop !== undefined) {
    if (input.loop !== null && input.loop !== 'none' && !LOOP_MODES.includes(input.loop)) {
      throw new Error(`savig/core: unknown loop mode ${JSON.stringify(input.loop)} (use cycle, pingpong or none)`);
    }
    patch.loop = input.loop === null || input.loop === 'none' ? undefined : input.loop;
  }
  if (input.wiggle !== undefined) {
    if (input.wiggle !== null && !wiggleOk) throw new Error(`savig/core: ${what} loops only (colors, gradients and shape morphs cannot wiggle)`);
    if (input.wiggle !== null && !isPropertyModifier({ wiggle: input.wiggle })) {
      throw new Error('savig/core: wiggle needs a finite amplitude, a frequency >= 0 and an integer seed');
    }
    patch.wiggle = input.wiggle ?? undefined;
  }
  return patch;
}

/** Set (merge) or clear the modifier on `property` of object `id`. `clear: true` removes both.
 *  `property` is any `ModifierTarget`: a transform/geometry/primitive property, trimStart/trimEnd/
 *  trimOffset, motionProgress, a loop-only fill/stroke/fillGradient/strokeGradient/shape, or a
 *  filter param `filter:<filterId>.<param>`. */
export function setModifier(project: Project, id: string, property: ModifierTarget, input: ModifierInput & { clear?: boolean }): Project {
  if (!isModifierTarget(property)) {
    throw new Error(`savig/core: property ${JSON.stringify(property)} takes no modifiers (use ${TARGET_LIST})`);
  }
  const obj = project.objects.find((o) => o.id === id);
  if (!obj) throw new Error(`savig/core: no object "${id}"`);
  const f = parseFilterModifierKey(property);
  if (f && !obj.filters?.some((x) => x.id === f.filterId)) throw new Error(`savig/core: object "${id}" has no filter "${f.filterId}"`);
  if (input.clear) return { ...project, objects: project.objects.map((o) => (o.id === id ? withModifier(o, property, null) : o)) };
  const patch = patchOf(input, canWiggle(property), `"${property}"`);
  return { ...project, objects: project.objects.map((o) => (o.id === id ? withModifier(o, property, patch) : o)) };
}

/** Set (merge) or clear the root camera's modifier on `axis` (x, y, zoom, rotation): a wiggle is
 *  camera shake, a loop repeats the axis keys. Seeds a default camera when there is none. */
export function setCameraModifier(project: Project, axis: CameraAxis, input: ModifierInput & { clear?: boolean }): Project {
  if (!CAMERA_AXES.includes(axis)) throw new Error(`savig/core: camera axis ${JSON.stringify(axis)} is not one of ${CAMERA_AXES.join(', ')}`);
  const cam = project.camera ?? { base: defaultCameraPose(project.meta.width, project.meta.height), tracks: {} };
  const next = input.clear ? withCameraModifier(cam, axis, null) : withCameraModifier(cam, axis, patchOf(input, true, 'camera') as Partial<PropertyModifier>);
  return { ...project, camera: next };
}
