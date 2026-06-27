import * as polygonClippingNs from 'polygon-clipping';
import type { Project, SceneObject, VectorAsset, PathData, PathPoint, PathNode } from '../types';
import { sampleObject, resolveAnchor } from '../sample';
import { parentGroupOf, mapPoint } from '../groupTransform';
import { samplePath, pathBounds } from '../path';
import { flattenPath } from './arcLength';
import type { Cubic } from './boolean-curves';

// Local structural aliases for polygon-clipping geometry — runtime-compatible with the
// lib's own Pair/Ring/Polygon/MultiPolygon. A Pair is [x,y]; a Ring is closed
// (first==last); a Polygon is [outer, ...holes]; ops return MultiPolygon = Polygon[].
type Pair = [number, number];
type PcRing = Pair[];
type PcPolygon = PcRing[];
type PcMultiPolygon = PcPolygon[];
type ClipFn = (geom: PcPolygon | PcMultiPolygon, ...geoms: (PcPolygon | PcMultiPolygon)[]) => PcMultiPolygon;

// polygon-clipping ships an ESM build that DEFAULT-exports its ops object and a CJS build
// (module.exports = ops). Vite (browser) resolves the ESM default → it lands under
// `.default`; vitest resolves the CJS → ops sit on the namespace directly. Resolve both.
const pc = ((polygonClippingNs as { default?: Record<string, ClipFn> }).default ??
  (polygonClippingNs as unknown as Record<string, ClipFn>)) as Record<
  'union' | 'intersection' | 'xor' | 'difference',
  ClipFn
>;

export type BoolOp = 'union' | 'subtract' | 'intersect' | 'exclude';

const ELLIPSE_STEPS = 64;
const EMPTY_PATH: PathData = { nodes: [], closed: false };

/** Signed shoelace area of a ring of points. */
export function ringArea(ring: PathPoint[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function assetOf(project: Project, obj: SceneObject): VectorAsset | undefined {
  const a = project.assets.find((x) => x.id === obj.assetId);
  return a && a.kind === 'vector' ? a : undefined;
}

// The path used for a vector path object at `time`: the morphed sample if animated,
// else the sampled/static base.
function effectivePath(obj: SceneObject, asset: VectorAsset, time: number): PathData {
  if (obj.shapeTrack && obj.shapeTrack.length > 0) return samplePath(obj.shapeTrack, time);
  return sampleObject(obj, time).path ?? asset.path ?? EMPTY_PATH;
}

// Local-frame closed outline for a vector object at `time`. One ring (boolean operands
// are single-region shapes in v1). null when the object has no usable geometry.
function localOutline(obj: SceneObject, asset: VectorAsset, time: number): PathPoint[] | null {
  if (asset.shapeType === 'path') {
    const path = effectivePath(obj, asset, time);
    if (path.nodes.length < 2) return null;
    const pts = flattenPath(path).pts.map((p) => ({ x: p.x, y: p.y }));
    // flattenPath of a closed path ends back at the start; drop the dup for a clean ring.
    if (pts.length > 1) {
      const f = pts[0];
      const l = pts[pts.length - 1];
      if (Math.abs(f.x - l.x) < 1e-9 && Math.abs(f.y - l.y) < 1e-9) pts.pop();
    }
    return pts.length >= 3 ? pts : null;
  }
  const g = sampleObject(obj, time).geometry ?? {};
  if (asset.shapeType === 'rect') {
    const w = Math.max(0, g.width ?? 0);
    const h = Math.max(0, g.height ?? 0);
    if (w === 0 || h === 0) return null;
    return [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ];
  }
  // ellipse: center (rx,ry), radii (rx,ry) — matches geometryToSvgAttrs.
  const rx = Math.max(0, g.radiusX ?? 0);
  const ry = Math.max(0, g.radiusY ?? 0);
  if (rx === 0 || ry === 0) return null;
  const out: PathPoint[] = [];
  for (let i = 0; i < ELLIPSE_STEPS; i++) {
    const t = (i / ELLIPSE_STEPS) * 2 * Math.PI;
    out.push({ x: rx + rx * Math.cos(t), y: ry + ry * Math.sin(t) });
  }
  return out;
}

/** Map a local point through the object's transform then up its group-ancestor chain. */
function toWorld(project: Project, obj: SceneObject, ax: number, ay: number, p: PathPoint, time: number): PathPoint {
  let q = mapPoint(sampleObject(obj, time), ax, ay, p.x, p.y);
  let cur = parentGroupOf(project.objects, obj);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    q = mapPoint(sampleObject(cur, time), cur.anchorX, cur.anchorY, q.x, q.y);
    cur = parentGroupOf(project.objects, cur);
  }
  return q;
}

/** A polygon-clipping Polygon (array of [x,y] rings) in world coords for one object. */
export function objectToWorldPolygon(project: Project, obj: SceneObject, time: number): PcPolygon {
  const asset = assetOf(project, obj);
  if (!asset) return [];
  const local = localOutline(obj, asset, time);
  if (!local) return [];
  const state = sampleObject(obj, time);
  const box = asset.shapeType === 'path' ? pathBounds(effectivePath(obj, asset, time)) : undefined;
  const { anchorX, anchorY } = resolveAnchor(obj, state, asset.shapeType, box);
  const ring: Pair[] = local.map((p) => {
    const w = toWorld(project, obj, anchorX, anchorY, p, time);
    return [w.x, w.y];
  });
  // close GeoJSON-style for polygon-clipping
  ring.push([ring[0][0], ring[0][1]]);
  return [ring];
}

export const KAPPA = 0.5522847498;

// Local-frame cubic segments (closed loop) for a leaf vector object at `time`. Uses the
// same straight/cubic rule as pathToD/flattenPoints (cubic iff prev.out || cur.in).
// null when the object has no usable geometry.
function localCubics(obj: SceneObject, asset: VectorAsset, time: number): Cubic[] | null {
  const straight = (a: PathPoint, b: PathPoint): Cubic => ({ p0: a, c1: a, c2: b, p3: b });

  if (asset.shapeType === 'rect') {
    const g = sampleObject(obj, time).geometry ?? {};
    const w = Math.max(0, g.width ?? 0);
    const h = Math.max(0, g.height ?? 0);
    if (w === 0 || h === 0) return null;
    const c = [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ];
    return [straight(c[0], c[1]), straight(c[1], c[2]), straight(c[2], c[3]), straight(c[3], c[0])];
  }

  if (asset.shapeType === 'ellipse') {
    const g = sampleObject(obj, time).geometry ?? {};
    const rx = Math.max(0, g.radiusX ?? 0);
    const ry = Math.max(0, g.radiusY ?? 0);
    if (rx === 0 || ry === 0) return null;
    // center matches localOutline's (rx,ry) convention; 4 kappa quadrants.
    const A0 = { x: rx + rx, y: ry };
    const A1 = { x: rx, y: ry + ry };
    const A2 = { x: 0, y: ry };
    const A3 = { x: rx, y: 0 };
    const kx = KAPPA * rx;
    const ky = KAPPA * ry;
    return [
      { p0: A0, c1: { x: A0.x, y: A0.y + ky }, c2: { x: A1.x + kx, y: A1.y }, p3: A1 },
      { p0: A1, c1: { x: A1.x - kx, y: A1.y }, c2: { x: A2.x, y: A2.y + ky }, p3: A2 },
      { p0: A2, c1: { x: A2.x, y: A2.y - ky }, c2: { x: A3.x - kx, y: A3.y }, p3: A3 },
      { p0: A3, c1: { x: A3.x + kx, y: A3.y }, c2: { x: A0.x, y: A0.y - ky }, p3: A0 },
    ];
  }

  // path: a cubic per consecutive node pair (plus closing).
  const path = effectivePath(obj, asset, time);
  const nodes = path.nodes;
  if (nodes.length < 2) return null;
  const add = (a: PathPoint, off?: PathPoint): PathPoint => (off ? { x: a.x + off.x, y: a.y + off.y } : a);
  const segOf = (prev: PathNode, cur: PathNode): Cubic => {
    if (prev.out || cur.in) {
      return { p0: prev.anchor, c1: add(prev.anchor, prev.out), c2: add(cur.anchor, cur.in), p3: cur.anchor };
    }
    return straight(prev.anchor, cur.anchor);
  };
  const out: Cubic[] = [];
  const push = (s: Cubic) => {
    // skip zero-length straight segments (coincident anchors); keep all curved ones.
    if (Math.hypot(s.p3.x - s.p0.x, s.p3.y - s.p0.y) > 1e-9 || s.c1 !== s.p0 || s.c2 !== s.p3) out.push(s);
  };
  for (let i = 1; i < nodes.length; i++) push(segOf(nodes[i - 1], nodes[i]));
  if (path.closed && nodes.length > 1) push(segOf(nodes[nodes.length - 1], nodes[0]));
  return out.length >= 2 ? out : null;
}

/** World-space cubic segments for a LEAF vector operand (path/rect/ellipse). [] for
 *  groups, non-vector, or degenerate geometry. Zero-length path segments are skipped. */
export function operandCubicsWorld(project: Project, obj: SceneObject, time: number): Cubic[] {
  if (obj.isGroup) return [];
  const asset = assetOf(project, obj);
  if (!asset) return [];
  const local = localCubics(obj, asset, time);
  if (!local) return [];
  const state = sampleObject(obj, time);
  const box = asset.shapeType === 'path' ? pathBounds(effectivePath(obj, asset, time)) : undefined;
  const { anchorX, anchorY } = resolveAnchor(obj, state, asset.shapeType, box);
  const w = (p: PathPoint): PathPoint => toWorld(project, obj, anchorX, anchorY, p, time);
  return local.map((c) => ({ p0: w(c.p0), c1: w(c.c1), c2: w(c.c2), p3: w(c.p3) }));
}

function ringToPathData(ring: PcRing): PathData {
  // polygon-clipping rings are closed (first==last); drop the dup, emit corner nodes.
  const closed =
    ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
  const pts = closed ? ring.slice(0, -1) : ring;
  return { closed: true, nodes: pts.map(([x, y]) => ({ anchor: { x, y } })) };
}

/** Vector-leaf descendants of a group (recursive; skips nested groups by recursing, and any
 *  non-vector leaf). */
function collectVectorLeaves(project: Project, groupId: string, out: SceneObject[], seen: Set<string>): void {
  if (seen.has(groupId)) return; // cycle guard (corrupt parentId chain)
  seen.add(groupId);
  for (const o of project.objects) {
    if (o.parentId !== groupId) continue;
    if (o.isGroup) collectVectorLeaves(project, o.id, out, seen);
    else if (assetOf(project, o)) out.push(o);
  }
}

/** A boolean OPERAND's world geometry: a leaf vector shape's polygon, or — for a GROUP — the UNION
 *  of its leaf vector descendants treated as ONE operand (so intersect/subtract/exclude see the
 *  merged group, not its individual parts). Empty when the operand contributes no geometry. */
export function operandWorldGeom(project: Project, obj: SceneObject, time: number): PcPolygon | PcMultiPolygon {
  if (!obj.isGroup) return objectToWorldPolygon(project, obj, time);
  const leaves: SceneObject[] = [];
  collectVectorLeaves(project, obj.id, leaves, new Set());
  const polys = leaves.map((l) => objectToWorldPolygon(project, l, time)).filter((g) => g.length > 0);
  if (polys.length === 0) return [];
  if (polys.length === 1) return polys[0];
  return pc.union(polys[0], ...polys.slice(1));
}

export function booleanOp(project: Project, objs: SceneObject[], op: BoolOp, time: number): PathData[] {
  const geoms: (PcPolygon | PcMultiPolygon)[] = objs
    .slice()
    .sort((a, b) => a.zOrder - b.zOrder) // bottom-most first
    .map((o) => operandWorldGeom(project, o, time))
    .filter((g) => g.length > 0);
  if (geoms.length < 2) return [];

  const head = geoms[0];
  const rest = geoms.slice(1);
  let result: PcMultiPolygon;
  if (op === 'union') result = pc.union(head, ...rest);
  else if (op === 'intersect') result = pc.intersection(head, ...rest);
  else if (op === 'exclude') result = pc.xor(head, ...rest);
  else result = pc.difference(head, ...rest); // subtract upper from bottom-most

  // Flatten MultiPolygon (Polygon[] -> Ring[]) to a flat ring list; even-odd fill handles holes.
  const rings: PathData[] = [];
  for (const poly of result) {
    for (const ring of poly) {
      const pd = ringToPathData(ring);
      if (pd.nodes.length >= 3) rings.push(pd);
    }
  }
  return rings;
}
