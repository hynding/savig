// Paint bucket (spec 2026-11-15-paint-bucket-eraser). Pure: given the active scene's objects, a
// click point (scene space) and a colour, decide what Flash's bucket would do and build the edit.
//
// The rule, in draw order from the top:
//  1. Clicking ON a line (a stroke) does nothing — the bucket fills areas, not lines.
//  2. Let T be the topmost object whose FILL contains the point (the "background" under the
//     click, if any). The ink that can enclose an area is every object drawn ABOVE T.
//  3. The area is the piece of (everything − that ink) holding the point, clipped to T's fill
//     when there is a T. It must be closed: without T it may not reach past the ink's bounds.
//  4. If that area is all of T's fill (nothing above T cuts it), T itself is recoloured.
//     Otherwise a new filled shape for the area is added just above T (or at the bottom when
//     there is no T), in T's own group, so the line art above stays on top.
import type { Easing, PathData, PathPoint, Project, SceneObject, VectorAsset } from '../types';
import { pc, ringArea, vectorEffectivePath, vectorLocalOutline, objectPointToWorld } from './boolean';
import { outlineStroke } from './strokeOutline';
import { flattenPath } from './arcLength';
import { sampleObject, resolveAnchor } from '../sample';
import { pathBounds } from '../path';
import { flattenInstances } from '../symbol';
import { invMapPoint, isLockedInTree } from '../groupTransform';
import { upsertColorKeyframe } from '../keyframes';
import { createSceneObject, createVectorAsset, DEFAULT_TRANSFORM } from '../project';

type Pair = [number, number];
type PcRing = Pair[];
type PcPolygon = PcRing[];
type PcMultiPolygon = PcPolygon[];

/** World-space ink of one vector leaf: its painted fill area and its stroke outline (even-odd). */
export interface ObjectInk {
  fill: PcMultiPolygon;
  stroke: PcMultiPolygon;
}

const EMPTY: PcMultiPolygon = [];

function closeRing(r: Pair[]): PcRing {
  if (r.length === 0) return r;
  const [fx, fy] = r[0];
  const [lx, ly] = r[r.length - 1];
  return fx === lx && fy === ly ? r : [...r, [fx, fy]];
}

/** Even-odd combine of independent rings into a MultiPolygon. */
export function inkEvenOdd(rings: PcRing[]): PcMultiPolygon {
  const usable = rings.filter((r) => r.length >= 4);
  if (usable.length === 0) return EMPTY;
  return pc.xor([usable[0]], ...usable.slice(1).map((r) => [r] as PcPolygon));
}

export function inkFlatRing(path: PathData): PathPoint[] {
  const pts = flattenPath(path).pts.map((p) => ({ x: p.x, y: p.y }));
  if (pts.length > 1) {
    const f = pts[0];
    const l = pts[pts.length - 1];
    if (Math.abs(f.x - l.x) < 1e-9 && Math.abs(f.y - l.y) < 1e-9) pts.pop();
  }
  return pts;
}

/** The world-space ink of a vector leaf at `time` (`project.objects` = its scene list). */
export function objectWorldInk(project: Project, obj: SceneObject, time: number): ObjectInk {
  const asset = project.assets.find((a) => a.id === obj.assetId);
  if (!asset || asset.kind !== 'vector') return { fill: EMPTY, stroke: EMPTY };
  const state = sampleObject(obj, time, asset.primitive);
  const local = vectorLocalOutline(obj, asset, time);
  const box = asset.shapeType === 'path' ? pathBounds(vectorEffectivePath(obj, asset, time)) : undefined;
  const { anchorX, anchorY } = resolveAnchor(obj, state, asset.shapeType, box);
  const world = (pts: PathPoint[]): PcRing =>
    closeRing(pts.map((p) => {
      const w = objectPointToWorld(project, obj, anchorX, anchorY, p, time);
      return [w.x, w.y] as Pair;
    }));
  const fillPaint = state.fill ?? asset.style.fill;
  const hasFill = !!(state.fillGradient ?? asset.style.fillGradient) || (!!fillPaint && fillPaint !== 'none');
  const strokePaint = state.stroke ?? asset.style.stroke;
  const hasStroke =
    (!!(state.strokeGradient ?? asset.style.strokeGradient) || (!!strokePaint && strokePaint !== 'none')) && asset.style.strokeWidth > 0;
  let fill = EMPTY;
  if (hasFill && local) {
    const rings = [local];
    if (asset.shapeType === 'path' && !(obj.shapeTrack && obj.shapeTrack.length) && asset.compoundRings) {
      for (const r of asset.compoundRings) rings.push(inkFlatRing(r));
    }
    fill = inkEvenOdd(rings.filter((r) => r.length >= 3).map(world));
  }
  let stroke = EMPTY;
  if (hasStroke) {
    const centre: PathData =
      asset.shapeType === 'path'
        ? vectorEffectivePath(obj, asset, time)
        : { closed: true, nodes: (local ?? []).map((p) => ({ anchor: p })) };
    const rings = outlineStroke(centre, asset.style.strokeWidth, asset.style.strokeLinecap ?? 'butt', asset.style.strokeLinejoin ?? 'miter');
    stroke = inkEvenOdd(rings.map((r) => world(inkFlatRing({ ...r, closed: true }))));
  }
  return { fill, stroke };
}

function inRing(r: PcRing, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i];
    const [xj, yj] = r[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inPolygon(poly: PcPolygon, x: number, y: number): boolean {
  if (poly.length === 0 || !inRing(poly[0], x, y)) return false;
  return !poly.slice(1).some((h) => inRing(h, x, y));
}

/** Point-in-area for a MultiPolygon (polygon-clipping output: outer rings + holes). */
export function pointInMultiPolygon(mp: PcMultiPolygon, x: number, y: number): boolean {
  return mp.some((poly) => inPolygon(poly, x, y));
}

export function multiPolygonArea(mp: PcMultiPolygon): number {
  let a = 0;
  for (const poly of mp) {
    poly.forEach((r, i) => {
      const area = Math.abs(ringArea(r.map(([x, y]) => ({ x, y }))));
      a += i === 0 ? area : -area;
    });
  }
  return a;
}

function bounds(mps: PcMultiPolygon[], p: { x: number; y: number }) {
  let minX = p.x, minY = p.y, maxX = p.x, maxY = p.y;
  for (const mp of mps) for (const poly of mp) for (const r of poly) for (const [x, y] of r) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/** What the bucket would do at `point`. `fill.rings` are scene-space, outer ring first. */
export type BucketTarget =
  | { kind: 'fill'; rings: PathData[]; aboveId: string | null }
  | { kind: 'recolor'; objectId: string }
  | { kind: 'stroke'; objectId: string }
  | { kind: 'open' };

/** Decide the bucket's action at `point` in `project.objects` (the active scene list). Only plain
 *  vector drawings take part (not text, images, imported SVG, symbol instances or live booleans). */
export function paintBucketTarget(project: Project, point: { x: number; y: number }, time: number): BucketTarget {
  const assets = new Map(project.assets.map((a) => [a.id, a] as const));
  const leaves = flattenInstances(project, time).filter(
    (l) =>
      !l.renderId.includes('/') && !l.renderId.includes('@') && !l.maskOf && l.exposed !== false &&
      !l.object.boolean && assets.get(l.object.assetId)?.kind === 'vector',
  );
  const inks = leaves.map((l) => ({ obj: l.object, ...objectWorldInk(project, l.object, time) }));
  const { x, y } = point;
  let t = -1;
  for (let i = inks.length - 1; i >= 0; i--) {
    if (pointInMultiPolygon(inks[i].stroke, x, y)) return { kind: 'stroke', objectId: inks[i].obj.id };
    if (pointInMultiPolygon(inks[i].fill, x, y)) {
      t = i;
      break;
    }
  }
  const T = t >= 0 ? inks[t] : null;
  const above = inks.slice(t + 1).flatMap((k) => [k.fill, k.stroke]).filter((m) => m.length > 0);
  if (above.length === 0) return T ? { kind: 'recolor', objectId: T.obj.id } : { kind: 'open' };

  const b = bounds(T ? [...above, T.fill] : above, point);
  const m = Math.max(10, (b.maxX - b.minX + b.maxY - b.minY) * 0.05);
  const box: PcRing = [
    [b.minX - m, b.minY - m], [b.maxX + m, b.minY - m], [b.maxX + m, b.maxY + m], [b.minX - m, b.maxY + m], [b.minX - m, b.minY - m],
  ];
  const ink = above.length === 1 ? above[0] : pc.union(above[0], ...above.slice(1));
  let free = pc.difference([box], ink);
  if (T) free = pc.intersection(free, T.fill);
  const area = free.find((poly) => inPolygon(poly, x, y));
  if (!area) return T ? { kind: 'recolor', objectId: T.obj.id } : { kind: 'open' };
  if (!T) {
    const eps = 1e-6;
    const touches = area[0].some(([px, py]) => Math.abs(px - (b.minX - m)) < eps || Math.abs(px - (b.maxX + m)) < eps || Math.abs(py - (b.minY - m)) < eps || Math.abs(py - (b.maxY + m)) < eps);
    if (touches) return { kind: 'open' };
  } else {
    const whole = multiPolygonArea(T.fill);
    if (whole > 0 && Math.abs(multiPolygonArea([area]) - whole) <= whole * 0.005) return { kind: 'recolor', objectId: T.obj.id };
  }
  const rings: PathData[] = area.map((r) => ({
    closed: true,
    nodes: r.slice(0, -1).map(([px, py]) => ({ anchor: { x: px, y: py } })),
  }));
  return { kind: 'fill', rings, aboveId: T ? T.obj.id : null };
}

export interface PaintBucketEdit {
  objects: SceneObject[];
  assets: Project['assets'];
  target: BucketTarget;
  /** Id of the object that was recoloured or created. */
  objectId?: string;
  /** Why nothing changed ('locked' = the object to recolour is locked). */
  refused?: 'locked';
}

/** Apply the bucket at `point` to `project.objects` (the active scene list). `keyAt` (seconds)
 *  writes a recolour as a fill colour KEYFRAME at that time (auto-key, or when the fill is
 *  already animated) instead of changing the static colour. `newId` names created objects. */
export function applyPaintBucket(
  project: Project,
  point: { x: number; y: number },
  time: number,
  color: string,
  opts: { keyAt?: number; easing?: Easing; newId?: () => string } = {},
): PaintBucketEdit {
  const target = paintBucketTarget(project, point, time);
  const unchanged = { objects: project.objects, assets: project.assets, target };
  const byId = new Map(project.objects.map((o) => [o.id, o] as const));
  if (target.kind === 'recolor') {
    const obj = byId.get(target.objectId)!;
    if (isLockedInTree(obj, byId)) return { ...unchanged, refused: 'locked' };
    const found = project.assets.find((a) => a.id === obj.assetId) as VectorAsset;
    // An asset another object also draws with is forked, so the bucket recolours only the
    // shape that was clicked.
    const shared = project.objects.some((o) => o.id !== obj.id && o.assetId === found.id);
    const asset: VectorAsset = shared ? { ...found, id: opts.newId ? `${opts.newId()}-asset` : `${found.id}-${obj.id}` } : found;
    const withAsset = (style: VectorAsset['style']) =>
      shared ? [...project.assets, { ...asset, style }] : project.assets.map((a) => (a.id === asset.id ? { ...asset, style } : a));
    const animated = !!obj.colorTracks?.fill?.length;
    if (opts.keyAt !== undefined || animated) {
      const at = opts.keyAt ?? time;
      const fillTrack = upsertColorKeyframe(obj.colorTracks?.fill ?? [], { time: at, value: color, easing: opts.easing ?? 'linear' });
      const gradientTracks = { ...obj.gradientTracks };
      delete gradientTracks.fill;
      const next: SceneObject = { ...obj, assetId: asset.id, colorTracks: { ...obj.colorTracks, fill: fillTrack }, gradientTracks: Object.keys(gradientTracks).length ? gradientTracks : undefined };
      if (!next.gradientTracks) delete next.gradientTracks;
      const style = { ...asset.style };
      delete style.fillGradient;
      return {
        target,
        objectId: obj.id,
        objects: project.objects.map((o) => (o.id === obj.id ? next : o)),
        assets: withAsset(style),
      };
    }
    const style = { ...asset.style, fill: color };
    delete style.fillGradient;
    let next = shared ? { ...obj, assetId: asset.id } : obj;
    if (obj.gradientTracks?.fill) {
      const gradientTracks = { ...obj.gradientTracks };
      delete gradientTracks.fill;
      next = { ...next, gradientTracks };
      if (Object.keys(gradientTracks).length === 0) delete next.gradientTracks;
    }
    return {
      target,
      objectId: obj.id,
      objects: next === obj ? project.objects : project.objects.map((o) => (o.id === obj.id ? next : o)),
      assets: withAsset(style),
    };
  }
  if (target.kind !== 'fill') return unchanged;

  // New fill: a sibling of T (same group / frame key), mapped into that group's local space.
  const T = target.aboveId ? byId.get(target.aboveId)! : null;
  const chain: SceneObject[] = [];
  for (let g = T?.parentId ? byId.get(T.parentId) : undefined; g?.isGroup && !chain.includes(g); g = g.parentId ? byId.get(g.parentId) : undefined) chain.push(g);
  chain.reverse(); // outermost first
  const toLocal = (p: PathPoint): PathPoint => {
    let q = p;
    for (const g of chain) q = invMapPoint(sampleObject(g, time), g.anchorX, g.anchorY, q.x, q.y);
    return q;
  };
  const localRings = target.rings.map((r) => ({ closed: true, nodes: r.nodes.map((n) => ({ anchor: toLocal(n.anchor) })) }));
  let minX = Infinity, minY = Infinity;
  for (const r of localRings) for (const n of r.nodes) { minX = Math.min(minX, n.anchor.x); minY = Math.min(minY, n.anchor.y); }
  const shifted = localRings.map((r) => ({ closed: true, nodes: r.nodes.map((n) => ({ anchor: { x: n.anchor.x - minX, y: n.anchor.y - minY } })) }));
  const asset = createVectorAsset('path', {
    ...(opts.newId ? { id: `${opts.newId()}-asset` } : {}),
    name: 'Fill',
    path: shifted[0],
    ...(shifted.length > 1 ? { compoundRings: shifted.slice(1) } : {}),
    style: { fill: color, stroke: 'none', strokeWidth: 0 },
  });
  const siblings = project.objects.filter((o) => (o.parentId ?? null) === (T?.parentId ?? null));
  const z = T ? T.zOrder + 1 : Math.min(0, ...siblings.map((o) => o.zOrder));
  const obj: SceneObject = {
    ...createSceneObject(asset.id, {
      ...(opts.newId ? { id: opts.newId() } : {}),
      name: `Fill ${project.objects.length + 1}`,
      zOrder: z,
      anchorMode: 'fraction',
      anchorX: 0.5,
      anchorY: 0.5,
      base: { ...DEFAULT_TRANSFORM, x: minX, y: minY },
    }),
    ...(T?.parentId ? { parentId: T.parentId } : {}),
    ...(T?.frameKeyId ? { frameKeyId: T.frameKeyId } : {}),
  };
  // Make room: siblings at or above the new slot move up one.
  const objects = project.objects.map((o) =>
    (o.parentId ?? null) === (T?.parentId ?? null) && o.zOrder >= z ? { ...o, zOrder: o.zOrder + 1 } : o,
  );
  return { target, objectId: obj.id, objects: [...objects, obj], assets: [...project.assets, asset] };
}
