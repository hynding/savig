/** Headless color-swatch verbs (roadmap 12). The project palette and its GLOBAL colors: painting
 *  root-scene shapes or text from a global swatch links them, and recoloring the swatch recolors
 *  every linked fill/stroke. Thin, fail-loud wrappers over the engine's pure swatch operations. */
import {
  addSwatch as engineAdd,
  applySwatchToAssets,
  projectSwatches,
  removeSwatch,
  swatchColor,
  updateSwatch,
} from '@savig/engine';
import type { Project, SwatchPaint } from '@savig/engine';

function requireSwatch(project: Project, swatchId: string): void {
  if (!projectSwatches(project).some((s) => s.id === swatchId)) throw new Error(`savig/core: unknown swatch "${swatchId}"`);
}

function requireColor(color: string): void {
  if (!swatchColor(color)) throw new Error(`savig/core: swatch color must be a hex color like "#ff8800" (got "${color}")`);
}

/** Add a swatch. `id` defaults to the first free `swatch1`, `swatch2`…; the name defaults to the color. */
export function addSwatch(project: Project, opts: { color: string; name?: string; global?: boolean; id?: string }): { project: Project; id: string } {
  requireColor(opts.color);
  const taken = new Set(projectSwatches(project).map((s) => s.id));
  let id = opts.id;
  if (!id) {
    let n = 1;
    while (taken.has(`swatch${n}`)) n++;
    id = `swatch${n}`;
  }
  return { project: engineAdd(project, { id, color: opts.color, name: opts.name, global: opts.global }), id };
}

/** Rename / recolor / (un)globalize a swatch, or delete it (`delete: true`: colors stay, links go).
 *  Recoloring a GLOBAL swatch recolors every fill/stroke still linked to it. */
export function editSwatch(project: Project, swatchId: string, patch: { name?: string; color?: string; global?: boolean; delete?: boolean }): Project {
  requireSwatch(project, swatchId);
  if (patch.delete) return removeSwatch(project, swatchId);
  if (patch.color !== undefined) requireColor(patch.color);
  if (patch.name === undefined && patch.color === undefined && patch.global === undefined) {
    throw new Error('savig/core: editSwatch needs name, color, global or delete');
  }
  return updateSwatch(project, swatchId, { name: patch.name, color: patch.color, global: patch.global });
}

/** Paint root-scene objects' fill or stroke with a swatch (linking them when it is global). Every
 *  id must be a shape or text object. */
export function applySwatch(project: Project, swatchId: string, paint: SwatchPaint, objectIds: readonly string[]): Project {
  requireSwatch(project, swatchId);
  if (paint !== 'fill' && paint !== 'stroke') throw new Error(`savig/core: paint must be "fill" or "stroke" (got "${String(paint)}")`);
  if (objectIds.length === 0) throw new Error('savig/core: applySwatch needs at least one object id');
  const assetIds: string[] = [];
  for (const id of objectIds) {
    const obj = project.objects.find((o) => o.id === id);
    if (!obj) throw new Error(`savig/core: no object "${id}"`);
    const asset = obj.assetId ? project.assets.find((a) => a.id === obj.assetId) : undefined;
    if (asset?.kind !== 'vector' && asset?.kind !== 'text') throw new Error(`savig/core: object "${id}" is not a shape or text, so it has no ${paint} to paint`);
    assetIds.push(asset.id);
  }
  return applySwatchToAssets(project, swatchId, paint, assetIds);
}
