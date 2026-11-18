// Skew (spec 2026-11-18-skew-distort), agent surface. Root scene, fail loud.
import { MAX_SKEW } from '@savig/engine';
import type { Easing, Project } from '@savig/engine';
import { setKeyframe } from './build';

export interface SkewInput {
  /** Horizontal shear in degrees (±85). */
  skewX?: number;
  /** Vertical shear in degrees (±85). */
  skewY?: number;
  /** When given, key the skew at this time instead of setting the static base. */
  time?: number;
  easing?: Easing;
}

/** Shear object `id` (Flash Free Transform skew), about its anchor. Without `time` it sets the
 *  static base skew (0 removes it); with `time` it keys skewX / skewY at that time. */
export function setSkew(project: Project, id: string, input: SkewInput): Project {
  const obj = project.objects.find((o) => o.id === id);
  if (!obj) throw new Error(`savig/core: no object "${id}"`);
  const entries = (['skewX', 'skewY'] as const).filter((k) => input[k] !== undefined);
  if (entries.length === 0) throw new Error('savig/core: setSkew needs skewX and/or skewY');
  for (const k of entries) {
    const v = input[k]!;
    if (!Number.isFinite(v) || Math.abs(v) > MAX_SKEW) throw new Error(`savig/core: ${k} must be a number between -${MAX_SKEW} and ${MAX_SKEW} (got ${v})`);
  }
  if (input.time !== undefined) {
    let p = project;
    for (const k of entries) p = setKeyframe(p, { objectId: id, property: k, time: input.time, value: input[k]!, easing: input.easing });
    return p;
  }
  const base = { ...obj.base };
  for (const k of entries) {
    if (input[k] === 0) delete base[k];
    else base[k] = input[k];
  }
  return { ...project, objects: project.objects.map((o) => (o.id === id ? { ...o, base } : o)) };
}
