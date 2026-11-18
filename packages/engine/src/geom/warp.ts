// Free Transform distort and envelope (spec 2026-11-18-skew-distort, slice 3). Both bake into a
// drawing's path nodes: Distort pins the four corners of the drawing's box anywhere (a bilinear
// map), Envelope bends it with a 3×3 handle mesh (a biquadratic patch). Curves are rebuilt piece by
// piece with tangents through the map's Jacobian, so a warped drawing stays a smooth Bézier path.
import { GEOMETRY_PROPERTIES, PRIMITIVE_PROPERTIES } from '../project';
import { pathBoundsRings } from '../path';
import { resolveAnchor, sampleObject } from '../sample';
import { isLockedInTree } from '../groupTransform';
import { vectorOutlinePath } from '../skin';
import { splitCubicRange, type Cubic } from './boolean-curves';
import type { Asset, PathData, PathNode, PathPoint, SceneObject, VectorAsset } from '../types';

export type PointMap = (p: PathPoint) => PathPoint;
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** Distort corners, clockwise from top-left. */
export type Quad = [PathPoint, PathPoint, PathPoint, PathPoint];
/** Envelope mesh: 9 points, row-major (top row left→right, then middle, then bottom). */
export type Mesh = PathPoint[];

export type Warp = { kind: 'distort'; corners: Quad } | { kind: 'envelope'; mesh: Mesh };

const uv = (box: Box, p: PathPoint) => ({
  u: box.width > 0 ? (p.x - box.x) / box.width : 0,
  v: box.height > 0 ? (p.y - box.y) / box.height : 0,
});

/** The four corners of `box` (the identity distort). */
export function boxCorners(box: Box): Quad {
  const { x, y, width: w, height: h } = box;
  return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
}

/** The 3×3 mesh laid evenly on `box` (the identity envelope). */
export function boxMesh(box: Box): Mesh {
  const out: Mesh = [];
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) out.push({ x: box.x + (box.width * i) / 2, y: box.y + (box.height * j) / 2 });
  return out;
}

/** Bilinear map taking `box`'s corners to `corners`. */
export function distortMap(box: Box, corners: Quad): PointMap {
  const [nw, ne, se, sw] = corners;
  return (p) => {
    const { u, v } = uv(box, p);
    const a = (1 - u) * (1 - v);
    const b = u * (1 - v);
    const c = u * v;
    const d = (1 - u) * v;
    return { x: a * nw.x + b * ne.x + c * se.x + d * sw.x, y: a * nw.y + b * ne.y + c * se.y + d * sw.y };
  };
}

const b2 = (t: number): [number, number, number] => [(1 - t) * (1 - t), 2 * t * (1 - t), t * t];

/** Biquadratic patch over `box` with control mesh `mesh` (row-major 3×3). An evenly laid mesh is
 *  the identity. */
export function envelopeMap(box: Box, mesh: Mesh): PointMap {
  return (p) => {
    const { u, v } = uv(box, p);
    const bu = b2(u);
    const bv = b2(v);
    let x = 0;
    let y = 0;
    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 3; i++) {
        const w = bu[i] * bv[j];
        x += w * mesh[j * 3 + i].x;
        y += w * mesh[j * 3 + i].y;
      }
    }
    return { x, y };
  };
}

export function warpMap(box: Box, warp: Warp): PointMap {
  return warp.kind === 'distort' ? distortMap(box, warp.corners) : envelopeMap(box, warp.mesh);
}

const sub = (a: PathPoint, b: PathPoint) => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: PathPoint, b: PathPoint) => ({ x: a.x + b.x, y: a.y + b.y });

/** The map's derivative applied to direction `d` at `p` (central difference). */
function pushDir(map: PointMap, p: PathPoint, d: PathPoint, h: number): PathPoint {
  const len = Math.hypot(d.x, d.y);
  if (len < 1e-12) return { x: 0, y: 0 };
  const ux = (d.x / len) * h;
  const uy = (d.y / len) * h;
  const a = map({ x: p.x + ux, y: p.y + uy });
  const b = map({ x: p.x - ux, y: p.y - uy });
  const k = len / (2 * h);
  return { x: (a.x - b.x) * k, y: (a.y - b.y) * k };
}

function segmentCubic(a: PathNode, b: PathNode): { c: Cubic; straight: boolean } {
  const straight = !a.out && !b.in;
  const p0 = a.anchor;
  const p3 = b.anchor;
  const c1 = a.out ? add(p0, a.out) : { x: p0.x + (p3.x - p0.x) / 3, y: p0.y + (p3.y - p0.y) / 3 };
  const c2 = b.in ? add(p3, b.in) : { x: p0.x + ((p3.x - p0.x) * 2) / 3, y: p0.y + ((p3.y - p0.y) * 2) / 3 };
  return { c: { p0, c1, c2, p3 }, straight };
}

function collinear(p0: PathPoint, c1: PathPoint, c2: PathPoint, p3: PathPoint): boolean {
  const dx = p3.x - p0.x;
  const dy = p3.y - p0.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return true;
  const off = (q: PathPoint) => Math.abs((q.x - p0.x) * dy - (q.y - p0.y) * dx) / len;
  return off(c1) < 1e-6 * Math.max(1, len) && off(c2) < 1e-6 * Math.max(1, len);
}

/** Warp a path through `map`. Each segment is cut into `pieces(segment)` cubic pieces whose ends
 *  are mapped exactly and whose handles follow the map's derivative; a piece that stays straight is
 *  written as a line. `scale` sets the finite-difference step (≈ the drawing's size). */
export function warpPath(path: PathData, map: PointMap, pieces: (straight: boolean, c: Cubic) => number, scale = 1): PathData {
  const n = path.nodes.length;
  if (n === 0) return { nodes: [], closed: path.closed };
  const h = Math.max(1e-6, scale * 1e-4);
  const out: PathNode[] = [{ anchor: map(path.nodes[0].anchor) }];
  const segCount = path.closed && n > 1 ? n : n - 1;
  for (let s = 0; s < segCount; s++) {
    const a = path.nodes[s];
    const b = path.nodes[(s + 1) % n];
    const { c, straight } = segmentCubic(a, b);
    const k = Math.max(1, Math.round(pieces(straight, c)));
    for (let i = 0; i < k; i++) {
      const piece = k === 1 ? c : splitCubicRange(c, i / k, (i + 1) / k);
      const P0 = out[out.length - 1].anchor;
      const closing = path.closed && s === segCount - 1 && i === k - 1;
      const P3 = closing ? out[0].anchor : map(piece.p3);
      const C1 = add(P0, pushDir(map, piece.p0, sub(piece.c1, piece.p0), h));
      const C2 = add(P3, pushDir(map, piece.p3, sub(piece.c2, piece.p3), h));
      const line = straight && collinear(P0, C1, C2, P3);
      const prev = out[out.length - 1];
      if (!line) prev.out = sub(C1, P0);
      if (closing) {
        if (!line) out[0].in = sub(C2, P3);
      } else {
        out.push(line ? { anchor: P3 } : { anchor: P3, in: sub(C2, P3) });
      }
    }
  }
  return { nodes: out, closed: path.closed };
}

/** How finely to rebuild a segment: a distort keeps axis-aligned lines exact (bilinear is linear
 *  along them); everything else is cut so the rebuilt curve hugs the true warp. */
export function warpPieces(warp: Warp): (straight: boolean, c: Cubic) => number {
  return (straight, c) => {
    if (warp.kind === 'distort' && straight) {
      const axis = Math.abs(c.p3.x - c.p0.x) < 1e-9 || Math.abs(c.p3.y - c.p0.y) < 1e-9;
      return axis ? 1 : 2;
    }
    return warp.kind === 'distort' ? 2 : 6;
  };
}

const SHAPE_TRACK_KEYS = [...GEOMETRY_PROPERTIES, ...PRIMITIVE_PROPERTIES] as const;

/** Rounded-rect outline (cubic quarter arcs), corner radius clamped to half the shorter side. */
function roundedRectPath(w: number, h: number, r0: number): PathData {
  const r = Math.max(0, Math.min(r0, w / 2, h / 2));
  if (r <= 0) return vectorOutlinePath('rect', { width: w, height: h });
  const k = 0.5522847498307936 * r;
  return {
    closed: true,
    nodes: [
      { anchor: { x: r, y: 0 }, in: { x: -k, y: 0 } },
      { anchor: { x: w - r, y: 0 }, out: { x: k, y: 0 } },
      { anchor: { x: w, y: r }, in: { x: 0, y: -k } },
      { anchor: { x: w, y: h - r }, out: { x: 0, y: k } },
      { anchor: { x: w - r, y: h }, in: { x: k, y: 0 } },
      { anchor: { x: r, y: h }, out: { x: -k, y: 0 } },
      { anchor: { x: 0, y: h - r }, in: { x: 0, y: k } },
      { anchor: { x: 0, y: r }, out: { x: 0, y: -k } },
    ],
  };
}

/** The drawing's current outline(s) in its own coordinates, as paths (rect / ellipse / polygon /
 *  star turned into paths), plus its box. */
export function warpSource(obj: SceneObject, asset: VectorAsset, time: number): { path: PathData; rings: PathData[]; box: Box } {
  const state = sampleObject(obj, time, asset.primitive);
  let path: PathData;
  if (asset.shapeType === 'path') path = state.path ?? asset.path ?? { nodes: [], closed: false };
  else if (asset.shapeType === 'rect') {
    const g = state.geometry ?? obj.shapeBase ?? {};
    path = roundedRectPath(g.width ?? 0, g.height ?? 0, g.cornerRadius ?? 0);
  } else path = vectorOutlinePath('ellipse', state.geometry ?? obj.shapeBase ?? {});
  const rings = asset.shapeType === 'path' ? asset.compoundRings ?? [] : [];
  return { path, rings, box: pathBoundsRings(path, rings) };
}

export type WarpRefusal = 'not-a-drawing' | 'locked' | 'morphing' | 'animated-shape' | 'live-boolean' | 'skinned' | 'empty';

/** Bake `warp` (in the drawing's own coordinates) into object `objectId`'s outline at `time`.
 *  Rect / ellipse / polygon / star become paths; the pivot is pinned absolute so nothing jumps; a
 *  shared asset is copied first. Refuses drawings whose outline is animated (shape keys, size or
 *  primitive tracks), live booleans and skinned drawings. */
export function applyWarp(
  objects: SceneObject[],
  assets: Asset[],
  objectId: string,
  warp: Warp,
  time: number,
): { objects: SceneObject[]; assets: Asset[] } | { refused: WarpRefusal } {
  const byId = new Map(objects.map((o) => [o.id, o] as const));
  const obj = byId.get(objectId);
  const asset = obj ? assets.find((a) => a.id === obj.assetId) : undefined;
  if (!obj || obj.isGroup || asset?.kind !== 'vector') return { refused: 'not-a-drawing' };
  if (isLockedInTree(obj, byId)) return { refused: 'locked' };
  if (obj.boolean) return { refused: 'live-boolean' };
  if (obj.skin) return { refused: 'skinned' };
  if (obj.shapeTrack?.length) return { refused: 'morphing' };
  if (SHAPE_TRACK_KEYS.some((k) => obj.tracks[k]?.length)) return { refused: 'animated-shape' };
  const src = warpSource(obj, asset, time);
  if (src.path.nodes.length < 2) return { refused: 'empty' };
  const state = sampleObject(obj, time, asset.primitive);
  const pathBox = asset.shapeType === 'path' ? pathBoundsRings(src.path, src.rings) : undefined;
  const { anchorX, anchorY } = resolveAnchor(obj, state, asset.shapeType, pathBox);
  const map = warpMap(src.box, warp);
  const pieces = warpPieces(warp);
  const scale = Math.max(src.box.width, src.box.height, 1);
  const path = warpPath(src.path, map, pieces, scale);
  const rings = src.rings.map((r) => warpPath(r, map, pieces, scale));
  const shared = objects.some((o) => o.id !== obj.id && o.assetId === asset.id);
  const assetId = shared ? `${asset.id}-${obj.id}` : asset.id;
  const { primitive: _p, compoundRings: _r, ...rest } = asset;
  void _p;
  void _r;
  const nextAsset: VectorAsset = { ...rest, id: assetId, shapeType: 'path', path, ...(rings.length ? { compoundRings: rings } : {}) };
  const tracks = { ...obj.tracks };
  for (const k of SHAPE_TRACK_KEYS) delete tracks[k];
  const next: SceneObject = { ...obj, assetId, tracks, anchorMode: 'absolute', anchorX, anchorY };
  delete next.shapeBase;
  return {
    objects: objects.map((o) => (o.id === obj.id ? next : o)),
    assets: shared ? [...assets, nextAsset] : assets.map((a) => (a.id === asset.id ? nextAsset : a)),
  };
}
