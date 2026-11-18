// Lasso (spec 2026-11-18-lasso). Pure. A lasso is a closed loop drawn in scene space (freehand
// drag or polygon clicks). It either selects what it touches, or, on one drawing, cuts the looped
// part out into a drawing of its own (Flash's lasso on a shape).
import type { PathData, PathPoint, Project, SceneObject, VectorAsset, VectorStyle } from '../types';
import { pc, vectorEffectivePath, vectorLocalOutline } from './boolean';
import { strokeInkRings } from './strokeOutline';
import { inkEvenOdd, inkFlatRing, multiPolygonArea } from './paintBucket';
import { close, ringsToPaths, sceneToLocal, visible, withoutPrimitiveAndRings } from './shapeCut';
import { sampleObject, resolveAnchor } from '../sample';
import { pathBounds } from '../path';
import { isLockedInTree } from '../groupTransform';
import { GEOMETRY_PROPERTIES, PRIMITIVE_PROPERTIES, newId as defaultNewId } from '../project';

type Pair = [number, number];
type PcRing = Pair[];
type PcMultiPolygon = PcRing[][];

const SHAPE_TRACK_KEYS = [...GEOMETRY_PROPERTIES, ...PRIMITIVE_PROPERTIES] as const;

/** Points closer than this are merged before the loop is built. */
const MIN_STEP = 0.5;

/** The loop's area (scene space). A self-crossing loop counts by the nonzero rule. [] when the
 *  loop has fewer than three distinct points or no area. */
export function lassoArea(points: PathPoint[]): PcMultiPolygon {
  const pts: PathPoint[] = [];
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= MIN_STEP) pts.push(p);
  }
  if (pts.length < 3) return [];
  const ring = close(pts.map((p) => [p.x, p.y] as Pair));
  const area = pc.union([ring]) as PcMultiPolygon;
  return multiPolygonArea(area) > 1e-6 ? area : [];
}

/** Whether the loop touches an axis-aligned box (scene space). */
export function lassoTouchesBox(area: PcMultiPolygon, box: { minX: number; minY: number; maxX: number; maxY: number }): boolean {
  if (area.length === 0) return false;
  const { minX, minY, maxX, maxY } = box;
  // A zero-width or zero-height box (a straight line) is padded so it still has an area.
  const e = 1e-3;
  const rect: PcRing = [
    [minX - e, minY - e],
    [maxX + e, minY - e],
    [maxX + e, maxY + e],
    [minX - e, maxY + e],
    [minX - e, minY - e],
  ];
  return pc.intersection(area, [[rect]]).length > 0;
}

export type LassoRefusal = 'not-a-drawing' | 'locked' | 'live-boolean' | 'morphing' | 'animated-shape' | 'missed' | 'whole';

export interface LassoCut {
  objects: SceneObject[];
  assets: Project['assets'];
  /** The new drawing holding the looped part. */
  insideId: string;
}

/** Cut the part of drawing `objectId` inside the loop into a drawing of its own, placed right
 *  above it in the same group / frame key, with the same paint, transform and animation. The
 *  original keeps the rest. Rects and ellipses become paths; both pivots stay where the
 *  original's was. A stroke-only drawing is cut through its stroke outline (the stroke paint
 *  becomes the fill), like the eraser. Refused when the loop misses the drawing ('missed') or
 *  holds all of it ('whole', the caller just selects it). */
export function applyLassoCut(
  project: Project,
  objectId: string,
  points: PathPoint[],
  time: number,
  opts: { newId?: () => string } = {},
): LassoCut | { refused: LassoRefusal } {
  const byId = new Map(project.objects.map((o) => [o.id, o] as const));
  const obj = byId.get(objectId);
  const asset = obj ? project.assets.find((a) => a.id === obj.assetId) : undefined;
  if (!obj || obj.isGroup || asset?.kind !== 'vector') return { refused: 'not-a-drawing' };
  if (isLockedInTree(obj, byId)) return { refused: 'locked' };
  if (obj.boolean) return { refused: 'live-boolean' };
  if (obj.shapeTrack?.length) return { refused: 'morphing' };
  if (SHAPE_TRACK_KEYS.some((k) => obj.tracks[k]?.length)) return { refused: 'animated-shape' };
  const loop = lassoArea(points);
  if (loop.length === 0) return { refused: 'missed' };

  const state = sampleObject(obj, time, asset.primitive);
  const hasFill = visible(state.fill ?? asset.style.fill, state.fillGradient ?? asset.style.fillGradient);
  const box = asset.shapeType === 'path' ? pathBounds(vectorEffectivePath(obj, asset, time)) : undefined;
  const { anchorX, anchorY } = resolveAnchor(obj, state, asset.shapeType, box);
  const local = vectorLocalOutline(obj, asset, time);
  let area: PcMultiPolygon;
  if (hasFill) {
    if (!local) return { refused: 'missed' };
    const rings = [local];
    if (asset.shapeType === 'path' && asset.compoundRings) for (const r of asset.compoundRings) rings.push(inkFlatRing(r));
    area = inkEvenOdd(rings.filter((r) => r.length >= 3).map((r) => close(r.map((p) => [p.x, p.y] as Pair))));
  } else {
    const centre: PathData =
      asset.shapeType === 'path' ? vectorEffectivePath(obj, asset, time) : { closed: true, nodes: (local ?? []).map((p) => ({ anchor: p })) };
    area = inkEvenOdd(strokeInkRings(centre, asset.style).map((d) => close(inkFlatRing({ ...d, closed: true }).map((p) => [p.x, p.y] as Pair))));
  }
  if (area.length === 0) return { refused: 'missed' };
  const localLoop: PcMultiPolygon = loop.map((poly) =>
    poly.map((r) => r.map(([x, y]) => {
      const q = sceneToLocal(project, obj, anchorX, anchorY, { x, y }, time);
      return [q.x, q.y] as Pair;
    })),
  );
  const total = multiPolygonArea(area);
  const inside = pc.intersection(area, localLoop) as PcMultiPolygon;
  const outside = pc.difference(area, localLoop) as PcMultiPolygon;
  const eps = Math.max(total * 1e-6, 1e-9);
  if (inside.length === 0 || multiPolygonArea(inside) <= eps) return { refused: 'missed' };
  if (outside.length === 0 || multiPolygonArea(outside) <= eps) return { refused: 'whole' };

  const style: VectorStyle = hasFill
    ? structuredClone(asset.style)
    : (() => {
        const fill = state.stroke ?? asset.style.stroke;
        const fillGradient = state.strokeGradient ?? asset.style.strokeGradient;
        return { fill, ...(fillGradient ? { fillGradient: structuredClone(fillGradient) } : {}), stroke: 'none', strokeWidth: 0 };
      })();
  const newId = opts.newId ?? defaultNewId;
  const pieceAsset = (id: string, mp: PcMultiPolygon): VectorAsset => {
    const paths = ringsToPaths(mp);
    return {
      ...withoutPrimitiveAndRings(asset),
      id,
      shapeType: 'path',
      path: paths[0],
      style: structuredClone(style),
      ...(paths.length > 1 ? { compoundRings: paths.slice(1) } : {}),
    };
  };
  const reshape = (o: SceneObject, assetId: string): SceneObject => {
    const tracks = { ...o.tracks };
    for (const k of SHAPE_TRACK_KEYS) delete tracks[k];
    const next: SceneObject = { ...o, assetId, tracks, anchorMode: 'absolute', anchorX, anchorY };
    delete next.shapeBase;
    delete next.trim; // a fresh outline re-parameterizes the 0..1 arc
    delete next.dashOffsetTrack;
    if (!hasFill) {
      delete next.colorTracks; // the stroke became the fill
      delete next.gradientTracks;
    }
    return next;
  };

  const shared = project.objects.some((o) => o.id !== obj.id && o.assetId === asset.id);
  const outsideAsset = pieceAsset(shared ? `${newId()}-asset` : asset.id, outside);
  const insideAsset = pieceAsset(`${newId()}-asset`, inside);
  const kept = reshape(obj, outsideAsset.id);
  const insideId = newId();
  const piece: SceneObject = { ...reshape(structuredClone(obj), insideAsset.id), id: insideId, name: `${obj.name} piece`, zOrder: obj.zOrder + 0.5 };
  delete piece.behaviors; // interactivity stays on the original

  // Draw the piece right above the original: renumber zOrder densely in drawing order.
  const ordered = [...project.objects.map((o) => (o.id === obj.id ? kept : o)), piece].sort((a, b) => a.zOrder - b.zOrder);
  const z = new Map(ordered.map((o, i) => [o.id, i] as const));
  const objects = [...project.objects.map((o) => (o.id === obj.id ? kept : o)), piece].map((o) => (o.zOrder === z.get(o.id) ? o : { ...o, zOrder: z.get(o.id)! }));
  const assets = [
    ...project.assets.map((a) => (!shared && a.id === asset.id ? outsideAsset : a)),
    ...(shared ? [outsideAsset] : []),
    insideAsset,
  ];
  return { objects, assets, insideId };
}
