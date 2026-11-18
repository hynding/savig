// 3D rotation (spec 2026-11-18-3d-rotation), agent surface. Root scene, fail loud.
import type { Easing, Project } from '@savig/engine';
import { applyPerspective, PERSPECTIVE_DISTANCE_DEFAULT } from '@savig/engine';
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

const PERSPECTIVE_REFUSALS: Record<string, string> = {
  'not-a-drawing': 'is not a shape or path',
  locked: 'is locked',
  morphing: 'has shape keys',
  'animated-shape': 'has an animated size',
  'live-boolean': 'is a live boolean result',
  skinned: 'is bound to bones',
  empty: 'has no outline',
  flat: 'has no 3D rotation to bake (set rotationX / rotationY first)',
  'animated-3d': 'has keyed or modified 3D rotation (perspective bakes a still pose)',
  'too-close': 'would pass the eye at this distance (use a larger distance or smaller angle)',
  'zero-scale': 'is scaled to zero',
};

/** Bake drawing `id`'s static 3D rotation into its outline as true perspective, seen from
 *  `distance` stage pixels (default 1000; smaller = stronger foreshortening), and clear
 *  rotationX / rotationY. Rect / ellipse / polygon / star become paths. */
export function bakePerspective(project: Project, id: string, input: { distance?: number; time?: number } = {}): Project {
  if (!project.objects.some((o) => o.id === id)) throw new Error(`savig/core: no object "${id}"`);
  const distance = input.distance ?? PERSPECTIVE_DISTANCE_DEFAULT;
  if (!Number.isFinite(distance) || distance <= 0) throw new Error(`savig/core: distance must be a positive number (got ${input.distance})`);
  const r = applyPerspective(project.objects, project.assets, id, input.time ?? 0, distance);
  if ('refused' in r) throw new Error(`savig/core: "${id}" ${PERSPECTIVE_REFUSALS[r.refused]}`);
  return { ...project, objects: r.objects, assets: r.assets };
}
