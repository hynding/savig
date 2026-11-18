// Distort and envelope (spec 2026-11-18-skew-distort, slice 3), agent surface. Root scene, fail loud.
import { applyWarp, boxCorners, boxMesh, warpSource } from '@savig/engine';
import type { PathPoint, Project, Warp } from '@savig/engine';

export interface WarpInput {
  kind: 'distort' | 'envelope';
  /** Absolute handle positions in the drawing's own coordinates: 4 corners (top-left clockwise)
   *  for distort, 9 mesh points (row-major) for envelope. */
  points?: PathPoint[];
  /** Or moves from the rest handles (same order/count as `points`); missing entries stay. */
  offsets?: ({ dx?: number; dy?: number } | null | undefined)[];
  time?: number;
}

const REFUSALS: Record<string, string> = {
  'not-a-drawing': 'is not a shape or path',
  locked: 'is locked',
  morphing: 'has shape keys (distort a frame-by-frame drawing instead)',
  'animated-shape': 'has an animated size',
  'live-boolean': 'is a live boolean result',
  skinned: 'is bound to bones',
  empty: 'has no outline',
};

/** Distort (corner pins) or envelope (3×3 mesh) a drawing, baked into its path. Rect / ellipse /
 *  polygon / star become paths. */
export function warpShape(project: Project, id: string, input: WarpInput): Project {
  const obj = project.objects.find((o) => o.id === id);
  if (!obj) throw new Error(`savig/core: no object "${id}"`);
  const asset = project.assets.find((a) => a.id === obj.assetId);
  if (asset?.kind !== 'vector') throw new Error(`savig/core: "${id}" ${REFUSALS['not-a-drawing']}`);
  const time = input.time ?? 0;
  const { box } = warpSource(obj, asset, time);
  const rest = input.kind === 'distort' ? boxCorners(box) : boxMesh(box);
  let pts: PathPoint[];
  if (input.points) {
    if (input.points.length !== rest.length) throw new Error(`savig/core: ${input.kind} takes ${rest.length} points (got ${input.points.length})`);
    pts = input.points;
  } else if (input.offsets) {
    if (input.offsets.length > rest.length) throw new Error(`savig/core: ${input.kind} takes at most ${rest.length} offsets`);
    pts = rest.map((p, i) => ({ x: p.x + (input.offsets![i]?.dx ?? 0), y: p.y + (input.offsets![i]?.dy ?? 0) }));
  } else throw new Error('savig/core: warpShape needs points or offsets');
  if (pts.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error('savig/core: warp points must be finite numbers');
  const warp: Warp = input.kind === 'distort' ? { kind: 'distort', corners: [pts[0], pts[1], pts[2], pts[3]] } : { kind: 'envelope', mesh: pts };
  const r = applyWarp(project.objects, project.assets, id, warp, time);
  if ('refused' in r) throw new Error(`savig/core: "${id}" ${REFUSALS[r.refused]}`);
  return { ...project, objects: r.objects, assets: r.assets };
}
