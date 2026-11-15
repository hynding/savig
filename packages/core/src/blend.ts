// Blend modes (spec 2026-11-15-blend-modes), agent surface. Root scene, fail loud.
import { BLEND_MODES, isBlendMode } from '@savig/engine';
import type { BlendMode, Project } from '@savig/engine';

/** Set the blend mode of `ids` ('normal' or null clears it). On a group, the whole subtree is
 *  composited first and blended as one. */
export function setBlendMode(project: Project, ids: string[], mode: BlendMode | 'normal' | null): Project {
  if (mode !== null && mode !== 'normal' && !isBlendMode(mode)) {
    throw new Error(`savig/core: unknown blend mode ${JSON.stringify(mode)} (use normal, ${BLEND_MODES.join(', ')})`);
  }
  const want = new Set(ids);
  for (const id of want) if (!project.objects.some((o) => o.id === id)) throw new Error(`savig/core: no object "${id}"`);
  return {
    ...project,
    objects: project.objects.map((o) => {
      if (!want.has(o.id)) return o;
      if (mode && mode !== 'normal') return { ...o, blendMode: mode };
      const rest = { ...o };
      delete rest.blendMode;
      return rest;
    }),
  };
}
