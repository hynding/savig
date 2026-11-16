import { canWiggle, CAMERA_AXES, isModifierTarget, isPropertyModifier, type Camera, type CameraAxis, type ModifierTarget, type Project, type PropertyModifier, type SceneObject } from '@savig/engine';
import { sanitizeAllObjects } from './sanitizeMasks';

// Property modifiers (specs 2026-11-16-property-modifiers, 2026-11-16-modifiers-everywhere):
// load-time check. Entries for keys that take no modifiers, malformed entries and a wiggle on a
// loop-only target (color, gradient, shape) are dropped; an empty `modifiers` is removed. Camera
// modifiers get the same treatment per axis.
function clean(v: PropertyModifier, wiggleOk: boolean): PropertyModifier | null {
  const m: PropertyModifier = {};
  if (v.loop) m.loop = v.loop;
  if (v.wiggle && wiggleOk) m.wiggle = { amplitude: v.wiggle.amplitude, frequency: v.wiggle.frequency, ...(v.wiggle.seed !== undefined ? { seed: v.wiggle.seed } : {}) };
  return m.loop || m.wiggle ? m : null;
}

function sanitizeObjectModifiers(o: SceneObject): SceneObject {
  if (!('modifiers' in o)) return o;
  const raw = o.modifiers as unknown;
  const kept: Partial<Record<ModifierTarget, PropertyModifier>> = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw)) {
      if (!isModifierTarget(k) || !isPropertyModifier(v)) continue;
      const m = clean(v, canWiggle(k));
      if (m) kept[k] = m;
    }
  }
  const out = { ...o };
  if (Object.keys(kept).length > 0) out.modifiers = kept;
  else delete out.modifiers;
  return out;
}

function sanitizeCamera(c: Camera | undefined): Camera | undefined {
  if (!c || !('modifiers' in c)) return c;
  const raw = c.modifiers as unknown;
  const kept: Partial<Record<CameraAxis, PropertyModifier>> = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw)) {
      if (!(CAMERA_AXES as readonly string[]).includes(k) || !isPropertyModifier(v)) continue;
      const m = clean(v, true);
      if (m) kept[k as CameraAxis] = m;
    }
  }
  const out = { ...c };
  if (Object.keys(kept).length > 0) out.modifiers = kept;
  else delete out.modifiers;
  return out;
}

export function sanitizeModifiers(project: Project): Project {
  let p = sanitizeAllObjects(project, sanitizeObjectModifiers);
  if (p.camera && 'modifiers' in p.camera) p = { ...p, camera: sanitizeCamera(p.camera) };
  if (p.scenes?.some((s) => s.camera && 'modifiers' in s.camera)) {
    p = { ...p, scenes: p.scenes.map((s) => (s.camera && 'modifiers' in s.camera ? { ...s, camera: sanitizeCamera(s.camera) } : s)) };
  }
  return p;
}
