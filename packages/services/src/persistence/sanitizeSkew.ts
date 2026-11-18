import type { Project, SceneObject } from '@savig/engine';
import { sanitizeAllObjects } from './sanitizeMasks';

// Skew (spec 2026-11-18-skew-distort): load-time check. A base `skewX` / `skewY` that is not a
// finite number is dropped, so the object draws unskewed. A zero skew is dropped too, keeping the
// stored document identical to one that never had skew. Range is clamped at sample time.
// 3D rotation (spec 2026-11-18-3d-rotation) `rotationX` / `rotationY` follow the same rule.
const OPTIONAL_KEYS = ['skewX', 'skewY', 'rotationX', 'rotationY'] as const;

function sanitizeObjectSkew(o: SceneObject): SceneObject {
  const b = o.base as unknown as Record<string, unknown> | undefined;
  if (!b || !OPTIONAL_KEYS.some((k) => k in b)) return o;
  const base = { ...o.base };
  for (const k of OPTIONAL_KEYS) {
    if (!(k in b)) continue;
    const v = b[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v === 0) delete base[k];
  }
  return { ...o, base };
}

export function sanitizeSkew(project: Project): Project {
  return sanitizeAllObjects(project, sanitizeObjectSkew);
}
