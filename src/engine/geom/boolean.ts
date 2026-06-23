import * as polygonClipping from 'polygon-clipping';
import type { Project, SceneObject, VectorAsset, PathData, PathPoint } from '../types';
import { sampleObject, resolveAnchor } from '../sample';
import { parentGroupOf, mapPoint } from '../groupTransform';
import { samplePath, pathBounds } from '../path';
import { flattenPath } from './arcLength';

// Local structural aliases for polygon-clipping geometry — runtime-compatible with the
// lib's own Pair/Ring/Polygon/MultiPolygon. A Pair is [x,y]; a Ring is closed
// (first==last); a Polygon is [outer, ...holes]; ops return MultiPolygon = Polygon[].
type Pair = [number, number];
type PcRing = Pair[];
type PcPolygon = PcRing[];
type PcMultiPolygon = PcPolygon[];

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
  let cur = parentGroupOf(project, obj);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    q = mapPoint(sampleObject(cur, time), cur.anchorX, cur.anchorY, q.x, q.y);
    cur = parentGroupOf(project, cur);
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

function ringToPathData(ring: PcRing): PathData {
  // polygon-clipping rings are closed (first==last); drop the dup, emit corner nodes.
  const closed =
    ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
  const pts = closed ? ring.slice(0, -1) : ring;
  return { closed: true, nodes: pts.map(([x, y]) => ({ anchor: { x, y } })) };
}

export function booleanOp(project: Project, objs: SceneObject[], op: BoolOp, time: number): PathData[] {
  const geoms: PcPolygon[] = objs
    .slice()
    .sort((a, b) => a.zOrder - b.zOrder) // bottom-most first
    .map((o) => objectToWorldPolygon(project, o, time))
    .filter((g) => g.length > 0);
  if (geoms.length < 2) return [];

  const head = geoms[0];
  const rest = geoms.slice(1);
  let result: PcMultiPolygon;
  if (op === 'union') result = polygonClipping.union(head, ...rest);
  else if (op === 'intersect') result = polygonClipping.intersection(head, ...rest);
  else if (op === 'exclude') result = polygonClipping.xor(head, ...rest);
  else result = polygonClipping.difference(head, ...rest); // subtract upper from bottom-most

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
