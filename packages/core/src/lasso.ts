// Lasso cut (spec 2026-11-18-lasso), agent surface. Root scene, fail loud.
import { applyLassoCut, newId } from '@savig/engine';
import type { PathPoint, Project } from '@savig/engine';

const REFUSALS: Record<string, string> = {
  'not-a-drawing': 'is not a shape or path',
  locked: 'is locked',
  'live-boolean': 'is a live boolean result',
  morphing: 'has shape keys',
  'animated-shape': 'has an animated size',
  missed: 'is not under the loop',
  whole: 'is entirely inside the loop (nothing to cut)',
};

/** Cut the part of drawing `id` inside the closed loop `points` (scene coordinates, at least 3)
 *  into a drawing of its own, drawn right above it with the same paint, transform and animation.
 *  Rects and ellipses become paths; a stroke-only drawing is cut through its stroke outline.
 *  Returns the new drawing's id. */
export function cutRegion(project: Project, id: string, points: PathPoint[], opts: { time?: number; newId?: string } = {}): { project: Project; id: string } {
  if (!Array.isArray(points) || points.length < 3 || points.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) {
    throw new Error('savig/core: cutRegion needs at least 3 points with finite x and y');
  }
  if (!project.objects.some((o) => o.id === id)) throw new Error(`savig/core: no object "${id}"`);
  if (opts.newId && project.objects.some((o) => o.id === opts.newId)) throw new Error(`savig/core: id "${opts.newId}" is taken`);
  const r = applyLassoCut(project, id, points, opts.time ?? 0, { newId });
  if ('refused' in r) throw new Error(`savig/core: "${id}" ${REFUSALS[r.refused]}`);
  let out: Project = { ...project, objects: r.objects, assets: r.assets };
  let pieceId = r.insideId;
  if (opts.newId) {
    out = { ...out, objects: out.objects.map((o) => (o.id === r.insideId ? { ...o, id: opts.newId! } : o)) };
    pieceId = opts.newId;
  }
  return { project: out, id: pieceId };
}
