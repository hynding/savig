// Paint bucket (spec 2026-11-15-paint-bucket-eraser), agent surface. Root scene, fail loud: a
// click on a line, an open area or a locked shape throws instead of silently doing nothing.
import { applyPaintBucket } from '@savig/engine';
import type { Easing, Project } from '@savig/engine';

export interface PaintBucketOpts {
  x: number;
  y: number;
  /** #rgb or #rrggbb. */
  color: string;
  /** Where on the timeline the shapes are sampled (default 0). */
  time?: number;
  /** Key the colour at this time instead of setting the static fill (recolour only). */
  keyAt?: number;
  easing?: Easing;
  /** Id for a new fill shape (its asset gets `<id>-asset`). */
  id?: string;
}

export interface PaintBucketResult {
  project: Project;
  /** 'recolor': an existing shape's fill changed; 'fill': a new fill shape was added. */
  kind: 'recolor' | 'fill';
  id: string;
}

export function paintBucket(project: Project, opts: PaintBucketOpts): PaintBucketResult {
  if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(opts.color)) throw new Error(`savig/core: paintBucket color must be #rgb or #rrggbb, got "${opts.color}"`);
  if (opts.id !== undefined && project.objects.some((o) => o.id === opts.id)) throw new Error(`savig/core: id "${opts.id}" is already used`);
  const id = opts.id;
  const r = applyPaintBucket(project, { x: opts.x, y: opts.y }, opts.time ?? 0, opts.color.toLowerCase(), {
    ...(opts.keyAt !== undefined ? { keyAt: opts.keyAt } : {}),
    ...(opts.easing ? { easing: opts.easing } : {}),
    // The engine asks for the object id and derives the asset id as `<id>-asset`.
    ...(id !== undefined ? { newId: () => id } : {}),
  });
  const at = `(${opts.x}, ${opts.y})`;
  if (r.refused === 'locked') throw new Error(`savig/core: the shape at ${at} is locked`);
  if (r.target.kind === 'stroke') throw new Error(`savig/core: ${at} is on the line of "${r.target.objectId}"; the bucket fills areas, click inside one`);
  if (r.target.kind === 'open') throw new Error(`savig/core: nothing closed to fill at ${at}`);
  return { project: { ...project, objects: r.objects, assets: r.assets }, kind: r.target.kind, id: r.objectId! };
}
