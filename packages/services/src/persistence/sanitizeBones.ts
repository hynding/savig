import type { BoneSpec, Project, SceneObject } from '@savig/engine';
import { sanitizeAllObjects } from './sanitizeMasks';

// Bones (spec 2026-11-13-bone-tool §Model): load-time shape check for SceneObject.bone. A spec on
// a non-group, a non-finite or non-positive length, or a non-finite angle drops the whole spec
// (the group stays an ordinary group). Non-finite limits, or min > max, drop the limits;
// a non-boolean `pinned` is dropped. Same object back when nothing changes.

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function cleanBone(b: unknown): BoneSpec | null {
  if (!b || typeof b !== 'object') return null;
  const r = b as Record<string, unknown>;
  if (!finite(r.length) || r.length <= 0 || !finite(r.angle)) return null;
  const out: BoneSpec = { length: r.length, angle: r.angle };
  const min = finite(r.min) ? r.min : undefined;
  const max = finite(r.max) ? r.max : undefined;
  if (!(min !== undefined && max !== undefined && min > max)) {
    if (min !== undefined) out.min = min;
    if (max !== undefined) out.max = max;
  }
  if (r.pinned === true) out.pinned = true;
  return out;
}

function sanitizeObject(o: SceneObject): SceneObject {
  if (!('bone' in o)) return o;
  const b = o.isGroup ? cleanBone(o.bone) : null;
  if (b && JSON.stringify(b) === JSON.stringify(o.bone)) return o;
  const out = { ...o };
  if (b) out.bone = b;
  else delete out.bone;
  return out;
}

export function sanitizeBones(project: Project): Project {
  return sanitizeAllObjects(project, sanitizeObject);
}
