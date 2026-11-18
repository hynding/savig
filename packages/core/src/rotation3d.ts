// 3D rotation (spec 2026-11-18-3d-rotation), agent surface. Root scene, fail loud.
import type { Easing, Project } from '@savig/engine';
import { setKeyframe } from './build';

export interface Rotation3DInput {
  /** Degrees about the object's own horizontal axis (tips the top away). */
  rotationX?: number;
  /** Degrees about the object's own vertical axis (turns it like a door; 180 shows the back). */
  rotationY?: number;
  /** When given, key the angles at this time instead of setting the static base. */
  time?: number;
  easing?: Easing;
}

/** Turn object `id` in depth about its anchor (Animate's 3D Rotation; orthographic). Without
 *  `time` it sets the static base angles (0 removes them); with `time` it keys rotationX /
 *  rotationY at that time (unwrapped: 0 → 360 turns all the way round). */
export function setRotation3D(project: Project, id: string, input: Rotation3DInput): Project {
  const obj = project.objects.find((o) => o.id === id);
  if (!obj) throw new Error(`savig/core: no object "${id}"`);
  const entries = (['rotationX', 'rotationY'] as const).filter((k) => input[k] !== undefined);
  if (entries.length === 0) throw new Error('savig/core: setRotation3D needs rotationX and/or rotationY');
  for (const k of entries) {
    if (!Number.isFinite(input[k]!)) throw new Error(`savig/core: ${k} must be a finite number of degrees (got ${input[k]})`);
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
