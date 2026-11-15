import { isBlendMode, type Project, type SceneObject } from '@savig/engine';
import { sanitizeAllObjects } from './sanitizeMasks';

// Blend modes (spec 2026-11-15-blend-modes): load-time check. A `blendMode` that is not one of the
// stored modes (including 'normal', which is never stored) is dropped, so the object draws normally
// and no unknown string ever reaches a `style` attribute.
function sanitizeBlendMode(o: SceneObject): SceneObject {
  if (!('blendMode' in o) || isBlendMode(o.blendMode)) return o;
  const out = { ...o };
  delete out.blendMode;
  return out;
}

export function sanitizeBlend(project: Project): Project {
  return sanitizeAllObjects(project, sanitizeBlendMode);
}
