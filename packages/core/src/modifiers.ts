// Property modifiers (spec 2026-11-16-property-modifiers), agent surface. Root scene, fail loud.
import { isPropertyModifier, LOOP_MODES, MODIFIABLE_PROPERTIES, withModifier } from '@savig/engine';
import type { AnimatableProperty, LoopMode, Project, Wiggle } from '@savig/engine';

export interface ModifierInput {
  /** Wiggle to set; null removes the wiggle. Omitted = unchanged. */
  wiggle?: Wiggle | null;
  /** Loop mode after the last key; 'none' or null removes it. Omitted = unchanged. */
  loop?: LoopMode | 'none' | null;
}

/** Set (merge) or clear the modifier on `property` of object `id`. `clear: true` removes both. */
export function setModifier(project: Project, id: string, property: AnimatableProperty, input: ModifierInput & { clear?: boolean }): Project {
  if (!MODIFIABLE_PROPERTIES.includes(property)) {
    throw new Error(`savig/core: property ${JSON.stringify(property)} takes no modifiers (use ${MODIFIABLE_PROPERTIES.join(', ')})`);
  }
  const obj = project.objects.find((o) => o.id === id);
  if (!obj) throw new Error(`savig/core: no object "${id}"`);
  if (input.clear) return { ...project, objects: project.objects.map((o) => (o.id === id ? withModifier(o, property, null) : o)) };
  const patch: { wiggle?: Wiggle; loop?: LoopMode } = {};
  if (input.loop !== undefined) {
    if (input.loop !== null && input.loop !== 'none' && !LOOP_MODES.includes(input.loop)) {
      throw new Error(`savig/core: unknown loop mode ${JSON.stringify(input.loop)} (use cycle, pingpong or none)`);
    }
    patch.loop = input.loop === null || input.loop === 'none' ? undefined : input.loop;
  }
  if (input.wiggle !== undefined) {
    if (input.wiggle !== null && !isPropertyModifier({ wiggle: input.wiggle })) {
      throw new Error('savig/core: wiggle needs a finite amplitude, a frequency >= 0 and an integer seed');
    }
    patch.wiggle = input.wiggle ?? undefined;
  }
  return { ...project, objects: project.objects.map((o) => (o.id === id ? withModifier(o, property, patch) : o)) };
}
