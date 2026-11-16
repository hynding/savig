import { isPropertyModifier, MODIFIABLE_PROPERTIES, type AnimatableProperty, type Project, type PropertyModifier, type SceneObject } from '@savig/engine';
import { sanitizeAllObjects } from './sanitizeMasks';

// Property modifiers (spec 2026-11-16-property-modifiers): load-time check. Entries for properties
// that take no modifiers, and malformed entries, are dropped; an empty `modifiers` is removed.
function sanitizeObjectModifiers(o: SceneObject): SceneObject {
  if (!('modifiers' in o)) return o;
  const raw = o.modifiers as unknown;
  const kept: Partial<Record<AnimatableProperty, PropertyModifier>> = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw)) {
      if (!MODIFIABLE_PROPERTIES.includes(k as AnimatableProperty) || !isPropertyModifier(v)) continue;
      const m: PropertyModifier = {};
      if (v.loop) m.loop = v.loop;
      if (v.wiggle) m.wiggle = { amplitude: v.wiggle.amplitude, frequency: v.wiggle.frequency, ...(v.wiggle.seed !== undefined ? { seed: v.wiggle.seed } : {}) };
      kept[k as AnimatableProperty] = m;
    }
  }
  const out = { ...o };
  if (Object.keys(kept).length > 0) out.modifiers = kept;
  else delete out.modifiers;
  return out;
}

export function sanitizeModifiers(project: Project): Project {
  return sanitizeAllObjects(project, sanitizeObjectModifiers);
}
