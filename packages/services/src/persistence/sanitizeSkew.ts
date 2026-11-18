import type { Project, SceneObject } from '@savig/engine';
import { sanitizeAllObjects } from './sanitizeMasks';

// Skew (spec 2026-11-18-skew-distort): load-time check. A base `skewX` / `skewY` that is not a
// finite number is dropped, so the object draws unskewed. A zero skew is dropped too, keeping the
// stored document identical to one that never had skew. Range is clamped at sample time.
function sanitizeObjectSkew(o: SceneObject): SceneObject {
  const b = o.base as unknown as Record<string, unknown> | undefined;
  if (!b || (!('skewX' in b) && !('skewY' in b))) return o;
  const base = { ...o.base };
  for (const k of ['skewX', 'skewY'] as const) {
    if (!(k in b)) continue;
    const v = b[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v === 0) delete base[k];
  }
  return { ...o, base };
}

export function sanitizeSkew(project: Project): Project {
  return sanitizeAllObjects(project, sanitizeObjectSkew);
}
