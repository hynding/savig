// Eraser (spec 2026-11-15-paint-bucket-eraser, slice 2). Pure: given the active scene's objects,
// a drag polyline (scene space) and an eraser size, cut the swept area out of every vector shape
// it touches.
//
// Per shape (vector leaves as drawn at `time`, same candidates as the paint bucket):
//  - A shape with a visible fill loses the swept area from its fill; its stroke, if any, then
//    traces the new edges (like Illustrator's eraser).
//  - A stroke-only shape (a line) is first turned into its filled outline (stroke paint becomes
//    the fill), then cut, so erasing across a line splits it.
//  - Rects and ellipses become paths. The pivot stays where it was (anchor pinned absolute).
//  - A shape erased away completely is deleted.
//  - Locked shapes, morphing shapes (shape keys) and shapes with animated geometry are left
//    alone and reported in `skipped`.
import type { PathData, PathPoint, Project, SceneObject, VectorAsset, VectorStyle } from '../types';
import { pc, vectorEffectivePath, vectorLocalOutline } from './boolean';
import { outlineStroke } from './strokeOutline';
import { inkEvenOdd, inkFlatRing, multiPolygonArea, objectWorldInk } from './paintBucket';
import { sampleObject, resolveAnchor } from '../sample';
import { pathBounds } from '../path';
import { flattenInstances } from '../symbol';
import { invMapPoint, isLockedInTree } from '../groupTransform';
import { GEOMETRY_PROPERTIES, PRIMITIVE_PROPERTIES } from '../project';

type Pair = [number, number];
type PcRing = Pair[];
type PcMultiPolygon = PcRing[][];

export type EraseSkipReason = 'locked' | 'morphing' | 'animated-shape';

export interface EraseEdit {
  objects: SceneObject[];
  assets: Project['assets'];
  /** Shapes that were cut (and still exist). */
  erased: string[];
  /** Shapes erased away completely (removed from `objects`; their assets are left for the caller
   *  to prune, since another scene may still use them). */
  deleted: string[];
  skipped: { id: string; reason: EraseSkipReason }[];
}

const SHAPE_TRACK_KEYS = [...GEOMETRY_PROPERTIES, ...PRIMITIVE_PROPERTIES] as const;

/** The area a round eraser of diameter `size` sweeps along `points` (scene space). */
export function eraserArea(points: PathPoint[], size: number): PcMultiPolygon {
  if (!(size > 0) || points.length === 0) return [];
  const r = size / 2;
  if (points.length === 1 || points.every((p) => Math.hypot(p.x - points[0].x, p.y - points[0].y) < 1e-9)) {
    const ring: PcRing = [];
    for (let i = 0; i < 32; i++) {
      const t = (i / 32) * 2 * Math.PI;
      ring.push([points[0].x + r * Math.cos(t), points[0].y + r * Math.sin(t)]);
    }
    ring.push(ring[0]);
    return [[ring]];
  }
  const rings = outlineStroke({ closed: false, nodes: points.map((anchor) => ({ anchor })) }, size, 'round', 'round');
  return inkEvenOdd(rings.map((d) => close(inkFlatRing({ ...d, closed: true }).map((p) => [p.x, p.y] as Pair))));
}

function close(r: PcRing): PcRing {
  if (r.length === 0) return r;
  const [fx, fy] = r[0];
  const [lx, ly] = r[r.length - 1];
  return fx === lx && fy === ly ? r : [...r, [fx, fy]];
}

function ringsToPaths(mp: PcMultiPolygon): PathData[] {
  const rings: { area: number; data: PathData }[] = [];
  for (const poly of mp) {
    for (const r of poly) {
      const nodes = r.slice(0, -1).map(([x, y]) => ({ anchor: { x, y } }));
      if (nodes.length < 3) continue;
      rings.push({ area: Math.abs(multiPolygonArea([[r]])), data: { closed: true, nodes } });
    }
  }
  rings.sort((a, b) => b.area - a.area);
  return rings.map((x) => x.data);
}

// Destructured on a parameter so the dropped names satisfy eslint's argsIgnorePattern.
function withoutPrimitiveAndRings({ primitive: _primitive, compoundRings: _compoundRings, ...rest }: VectorAsset): VectorAsset {
  return rest;
}

function visible(paint: string | undefined, gradient: unknown): boolean {
  return !!gradient || (!!paint && paint !== 'none');
}

/** Map a scene-space point into `obj`'s own path coordinates at `time`. */
function sceneToLocal(project: Project, obj: SceneObject, ax: number, ay: number, p: PathPoint, time: number): PathPoint {
  const byId = new Map(project.objects.map((o) => [o.id, o] as const));
  const chain: SceneObject[] = [];
  for (let g = obj.parentId ? byId.get(obj.parentId) : undefined; g?.isGroup && !chain.includes(g); g = g.parentId ? byId.get(g.parentId) : undefined) chain.push(g);
  chain.reverse(); // outermost first
  let q = p;
  for (const g of chain) q = invMapPoint(sampleObject(g, time), g.anchorX, g.anchorY, q.x, q.y);
  return invMapPoint(sampleObject(obj, time), ax, ay, q.x, q.y);
}

export function applyEraser(
  project: Project,
  points: PathPoint[],
  size: number,
  time: number,
  opts: { newId?: () => string } = {},
): EraseEdit {
  const result: EraseEdit = { objects: project.objects, assets: project.assets, erased: [], deleted: [], skipped: [] };
  const sweep = eraserArea(points, size);
  if (sweep.length === 0) return result;
  const assets = new Map(project.assets.map((a) => [a.id, a] as const));
  const byId = new Map(project.objects.map((o) => [o.id, o] as const));
  const leaves = flattenInstances(project, time).filter(
    (l) =>
      !l.renderId.includes('/') && !l.renderId.includes('@') && !l.maskOf && l.exposed !== false &&
      !l.object.boolean && assets.get(l.object.assetId)?.kind === 'vector',
  );

  const replaced = new Map<string, SceneObject>();
  const removed = new Set<string>();
  const newAssets: VectorAsset[] = [];
  const changedAssets = new Map<string, VectorAsset>();

  for (const { object: obj } of leaves) {
    const asset = assets.get(obj.assetId) as VectorAsset;
    const ink = objectWorldInk(project, obj, time);
    const state = sampleObject(obj, time, asset.primitive);
    const hasFill = visible(state.fill ?? asset.style.fill, state.fillGradient ?? asset.style.fillGradient);
    const target = hasFill ? ink.fill : ink.stroke;
    if (target.length === 0 || pc.intersection(target, sweep).length === 0) continue;

    if (isLockedInTree(obj, byId)) {
      result.skipped.push({ id: obj.id, reason: 'locked' });
      continue;
    }
    if (obj.shapeTrack?.length) {
      result.skipped.push({ id: obj.id, reason: 'morphing' });
      continue;
    }
    if (SHAPE_TRACK_KEYS.some((k) => obj.tracks[k]?.length)) {
      result.skipped.push({ id: obj.id, reason: 'animated-shape' });
      continue;
    }

    // The shape's area in its own coordinates, and the sweep mapped into them.
    const box = asset.shapeType === 'path' ? pathBounds(vectorEffectivePath(obj, asset, time)) : undefined;
    const { anchorX, anchorY } = resolveAnchor(obj, state, asset.shapeType, box);
    const local = vectorLocalOutline(obj, asset, time);
    let area: PcMultiPolygon;
    if (hasFill) {
      if (!local) continue;
      const rings = [local];
      if (asset.shapeType === 'path' && asset.compoundRings) for (const r of asset.compoundRings) rings.push(inkFlatRing(r));
      area = inkEvenOdd(rings.filter((r) => r.length >= 3).map((r) => close(r.map((p) => [p.x, p.y] as Pair))));
    } else {
      const centre: PathData =
        asset.shapeType === 'path' ? vectorEffectivePath(obj, asset, time) : { closed: true, nodes: (local ?? []).map((p) => ({ anchor: p })) };
      const rings = outlineStroke(centre, asset.style.strokeWidth, asset.style.strokeLinecap ?? 'butt', asset.style.strokeLinejoin ?? 'miter');
      area = inkEvenOdd(rings.map((d) => close(inkFlatRing({ ...d, closed: true }).map((p) => [p.x, p.y] as Pair))));
    }
    const localSweep: PcMultiPolygon = sweep.map((poly) =>
      poly.map((r) => r.map(([x, y]) => {
        const q = sceneToLocal(project, obj, anchorX, anchorY, { x, y }, time);
        return [q.x, q.y] as Pair;
      })),
    );
    const left = pc.difference(area, localSweep);
    const before = multiPolygonArea(area);
    const after = multiPolygonArea(left);
    if (before > 0 && before - after <= before * 1e-6) continue; // touched only by rounding

    if (after <= 1e-9 || left.length === 0) {
      removed.add(obj.id);
      result.deleted.push(obj.id);
      continue;
    }
    const paths = ringsToPaths(left);
    const style: VectorStyle = hasFill
      ? { ...asset.style }
      : (() => {
          const fill = state.stroke ?? asset.style.stroke;
          const fillGradient = state.strokeGradient ?? asset.style.strokeGradient;
          return { fill, ...(fillGradient ? { fillGradient } : {}), stroke: 'none', strokeWidth: 0 };
        })();
    const shared = project.objects.some((o) => o.id !== obj.id && o.assetId === asset.id);
    const assetId = shared ? (opts.newId ? `${opts.newId()}-asset` : `${asset.id}-${obj.id}`) : asset.id;
    const nextAsset: VectorAsset = {
      ...withoutPrimitiveAndRings(asset),
      id: assetId,
      shapeType: 'path',
      path: paths[0],
      style,
      ...(paths.length > 1 ? { compoundRings: paths.slice(1) } : {}),
    };
    if (shared) newAssets.push(nextAsset);
    else changedAssets.set(asset.id, nextAsset);

    const tracks = { ...obj.tracks };
    for (const k of SHAPE_TRACK_KEYS) delete tracks[k];
    const next: SceneObject = { ...obj, assetId, tracks, anchorMode: 'absolute', anchorX, anchorY };
    delete next.shapeBase;
    delete next.trim; // a fresh path re-parameterizes the 0..1 arc
    delete next.dashOffsetTrack;
    if (!hasFill) {
      // The stroke became the fill: paint animation addressed the old pairing.
      delete next.colorTracks;
      delete next.gradientTracks;
    }
    replaced.set(obj.id, next);
    result.erased.push(obj.id);
  }

  if (replaced.size === 0 && removed.size === 0) return result;
  result.objects = project.objects
    .filter((o) => !removed.has(o.id))
    .map((o) => {
      const r = replaced.get(o.id) ?? o;
      if (r.maskedBy === undefined || !removed.has(r.maskedBy)) return r;
      const unlinked = { ...r };
      delete unlinked.maskedBy;
      return unlinked;
    });
  result.assets = [...project.assets.map((a) => changedAssets.get(a.id) ?? a), ...newAssets];
  return result;
}
