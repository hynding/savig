// Bone skinning (spec 2026-11-14-bone-skinning-design.md): a chain of bones bends ONE path
// smoothly (Flash's shape armature). Linear blend skinning over affine matrices:
//   p' = T(t)⁻¹ · Σᵢ wᵢ · M_i(t) · K_i · p
// with M_i = bone i's local→P matrix (P = the skinned object's parent space), T = the object's own
// local→P transform and K_i = M_i(bind)⁻¹ · T(bind). Pure; the single deformation every renderer
// reads through the per-frame path seam.

import type { BonePose } from './bones';
import { isBone } from './bones';
import { mapPoint } from './groupTransform';
import { pathBounds } from './path';
import { resolveAnchor, sampleObject } from './sample';
import type { Asset, Mat2D, PathData, PathNode, PathPoint, SceneObject, SkinSpec } from './types';
import { isLockedInTree } from './groupTransform';

// --- affine helpers ---

const IDENTITY: Mat2D = [1, 0, 0, 1, 0, 0];

/** The affine matrix of a point map (exact for any affine `f`). */
function matOf(f: (x: number, y: number) => PathPoint): Mat2D {
  const o = f(0, 0);
  const px = f(1, 0);
  const py = f(0, 1);
  return [px.x - o.x, px.y - o.y, py.x - o.x, py.y - o.y, o.x, o.y];
}

/** m·n (apply n first). */
export function matMul(m: Mat2D, n: Mat2D): Mat2D {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/** Inverse, or null when singular. */
export function matInv(m: Mat2D): Mat2D | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const a = m[3] / det;
  const b = -m[1] / det;
  const c = -m[2] / det;
  const d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

export function matApply(m: Mat2D, p: PathPoint): PathPoint {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

// --- scene matrices ---

/** Group `groupId`'s LOCAL (children's) space → space `stopId` (exclusive; undefined = scene
 *  root), through every group in between, with `pose` overriding bone rotations. */
function groupToSpace(byId: Map<string, SceneObject>, groupId: string, stopId: string | undefined, time: number, pose?: BonePose): Mat2D {
  let m = IDENTITY;
  const seen = new Set<string>();
  for (let g = byId.get(groupId); g?.isGroup && g.id !== stopId && !seen.has(g.id); g = g.parentId ? byId.get(g.parentId) : undefined) {
    seen.add(g.id);
    const s = sampleObject(g, time);
    const r = pose?.get(g.id);
    const t = r === undefined ? s : { ...s, rotation: r };
    m = matMul(matOf((x, y) => mapPoint(t, g.anchorX, g.anchorY, x, y)), m);
  }
  return m;
}

/** The drawing's own local → parent transform at `time` (its anchor resolved against `path`). */
function objectMatrix(obj: SceneObject, path: PathData, time: number): Mat2D {
  const state = sampleObject(obj, time);
  const { anchorX, anchorY } = resolveAnchor(obj, state, 'path', pathBounds(path));
  return matOf((x, y) => mapPoint(state, anchorX, anchorY, x, y));
}

// --- densify ---

const abs = (anchor: PathPoint, h: PathPoint | undefined): PathPoint => (h ? { x: anchor.x + h.x, y: anchor.y + h.y } : anchor);
const rel = (anchor: PathPoint, p: PathPoint): PathPoint => ({ x: p.x - anchor.x, y: p.y - anchor.y });
const lerp = (a: PathPoint, b: PathPoint, t: number): PathPoint => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Split a cubic at t: [left c1, left c2, mid, right c1, right c2]. */
function splitCubic(p0: PathPoint, c1: PathPoint, c2: PathPoint, p3: PathPoint, t: number): [PathPoint, PathPoint, PathPoint, PathPoint, PathPoint] {
  const a = lerp(p0, c1, t);
  const b = lerp(c1, c2, t);
  const c = lerp(c2, p3, t);
  const d = lerp(a, b, t);
  const e = lerp(b, c, t);
  return [a, d, lerp(d, e, t), e, c];
}

/** The same outline with every segment subdivided so none is longer than `maxLen` (measured on
 *  its control polygon), so a skin has enough nodes to bend smoothly. Lines stay lines. */
export function densifyPath(path: PathData, maxLen = 24): PathData {
  const n = path.nodes.length;
  if (n < 2 || !(maxLen > 0)) return path;
  const out: PathNode[] = path.nodes.map((nd) => ({ anchor: { ...nd.anchor }, ...(nd.in ? { in: { ...nd.in } } : {}), ...(nd.out ? { out: { ...nd.out } } : {}) }));
  const result: PathNode[] = [];
  const segCount = path.closed ? n : n - 1;
  // Pieces per original node i (inserted after it), computed against the ORIGINAL nodes.
  for (let i = 0; i < n; i++) {
    result.push(out[i]);
    if (i >= segCount) continue;
    const a = path.nodes[i];
    const b = path.nodes[(i + 1) % n];
    const curved = !!(a.out || b.in);
    // Handles are offsets from their anchor (see path.ts); work in absolute points here.
    const c1 = abs(a.anchor, a.out);
    const c2 = abs(b.anchor, b.in);
    const len = curved
      ? Math.hypot(c1.x - a.anchor.x, c1.y - a.anchor.y) + Math.hypot(c2.x - c1.x, c2.y - c1.y) + Math.hypot(b.anchor.x - c2.x, b.anchor.y - c2.y)
      : Math.hypot(b.anchor.x - a.anchor.x, b.anchor.y - a.anchor.y);
    const pieces = Math.max(1, Math.ceil(len / maxLen));
    if (pieces === 1) continue;
    if (!curved) {
      for (let k = 1; k < pieces; k++) result.push({ anchor: lerp(a.anchor, b.anchor, k / pieces) });
      continue;
    }
    // Peel pieces off the front: split the remaining curve at 1/(remaining pieces).
    let p0 = a.anchor;
    let q1 = c1;
    let q2 = c2;
    const p3 = b.anchor;
    let prev = out[i];
    for (let k = 0; k < pieces - 1; k++) {
      const [l1, l2, mid, r1, r2] = splitCubic(p0, q1, q2, p3, 1 / (pieces - k));
      prev.out = rel(prev.anchor, l1);
      const node: PathNode = { anchor: mid, in: rel(mid, l2) };
      result.push(node);
      prev = node;
      p0 = mid;
      q1 = r1;
      q2 = r2;
    }
    prev.out = rel(prev.anchor, q1);
    out[(i + 1) % n].in = rel(p3, q2);
  }
  return { nodes: result, closed: path.closed };
}

// --- weights ---

function distToSegment(p: PathPoint, a: PathPoint, b: PathPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Per point, inverse-fourth-power distance to each bone segment; the two strongest kept, normalized. */
export function autoSkinWeights(points: PathPoint[], segments: Array<{ joint: PathPoint; tip: PathPoint }>): number[][] {
  return points.map((p) => {
    const raw = segments.map((s) => 1 / (distToSegment(p, s.joint, s.tip) ** 2 + 1) ** 2);
    const keep = new Set(raw.map((w, i) => [w, i] as const).sort((x, y) => y[0] - x[0] || x[1] - y[1]).slice(0, 2).map(([, i]) => i));
    const kept = raw.map((w, i) => (keep.has(i) ? w : 0));
    const sum = kept.reduce((s, w) => s + w, 0);
    return kept.map((w) => w / sum);
  });
}

// --- bind / deform ---

/** Bind `obj` (a path drawing with outline `path`) to `boneIds` at `time`: densify the outline and
 *  compute the bind matrices and automatic weights. Returns the (densified) path to store on the
 *  drawing's asset and the skin, or an error message. */
export function computeSkin(
  objects: SceneObject[],
  obj: SceneObject,
  path: PathData,
  boneIds: string[],
  time: number,
): { path: PathData; skin: SkinSpec } | { error: string } {
  const byId = new Map(objects.map((o) => [o.id, o] as const));
  const ids = [...new Set(boneIds)];
  if (ids.length === 0) return { error: 'Pick at least one bone.' };
  for (const id of ids) {
    if (!isBone(byId.get(id))) return { error: `"${id}" is not a bone.` };
  }
  if (isInsideAny(byId, obj, ids)) return { error: 'A drawing inside a bone cannot be skinned to it — detach it first.' };
  if (path.nodes.length < 2) return { error: 'The drawing needs at least two points.' };
  const dense = densifyPath(path);
  const T = objectMatrix(obj, dense, time);
  const stop = obj.parentId;
  const binds: Mat2D[] = [];
  const segments: Array<{ joint: PathPoint; tip: PathPoint }> = [];
  for (const id of ids) {
    const b = byId.get(id)!;
    const M = groupToSpace(byId, id, stop, time);
    const inv = matInv(M);
    if (!inv) return { error: `Bone "${b.name}" is scaled to zero.` };
    binds.push(matMul(inv, T));
    const spec = b.bone!;
    const rad = (spec.angle * Math.PI) / 180;
    segments.push({
      joint: matApply(M, { x: b.anchorX, y: b.anchorY }),
      tip: matApply(M, { x: b.anchorX + spec.length * Math.cos(rad), y: b.anchorY + spec.length * Math.sin(rad) }),
    });
  }
  const weights = autoSkinWeights(dense.nodes.map((n) => matApply(T, n.anchor)), segments);
  return { path: dense, skin: { bones: ids, binds, weights } };
}

function isInsideAny(byId: Map<string, SceneObject>, obj: SceneObject, ids: string[]): boolean {
  const set = new Set(ids);
  const seen = new Set<string>();
  for (let p = obj.parentId ? byId.get(obj.parentId) : undefined; p && !seen.has(p.id); p = p.parentId ? byId.get(p.parentId) : undefined) {
    seen.add(p.id);
    if (set.has(p.id)) return true;
  }
  return false;
}

/** `path` (the drawing's sampled outline) bent by its skin at `time` (optionally under a bone
 *  `pose`). Falls back to `path` unchanged when there is no usable skin: node count ≠ weights, a
 *  missing bone, or a singular transform. */
export function skinnedPath(objects: SceneObject[], obj: SceneObject, path: PathData, time: number, pose?: BonePose): PathData {
  const skin = obj.skin;
  if (!skin || skin.weights.length !== path.nodes.length || skin.bones.length === 0) return path;
  const byId = new Map(objects.map((o) => [o.id, o] as const));
  if (!skin.bones.every((id) => isBone(byId.get(id)))) return path;
  const tInv = matInv(objectMatrix(obj, path, time));
  if (!tInv) return path;
  const perBone = skin.bones.map((id, i) => matMul(tInv, matMul(groupToSpace(byId, id, obj.parentId, time, pose), skin.binds[i])));
  const nodes = path.nodes.map((nd, n) => {
    const w = skin.weights[n];
    let m: Mat2D = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < perBone.length; i++) {
      const wi = w[i] ?? 0;
      if (wi === 0) continue;
      m = m.map((v, k) => v + wi * perBone[i][k]) as Mat2D;
    }
    // Handles are offsets from the anchor, so they take only the linear part.
    const lin = (h: PathPoint): PathPoint => ({ x: m[0] * h.x + m[2] * h.y, y: m[1] * h.x + m[3] * h.y });
    return {
      anchor: matApply(m, nd.anchor),
      ...(nd.in ? { in: lin(nd.in) } : {}),
      ...(nd.out ? { out: lin(nd.out) } : {}),
    };
  });
  return { nodes, closed: path.closed };
}

/** A rect / ellipse drawing's outline as a path in the SAME local coordinates it renders in (rect
 *  (0,0)–(w,h); ellipse centred on (rx, ry), four cubic quarter-arcs, handles relative to their
 *  anchors as everywhere), so converting it to a path
 *  doesn't move it — its bounds (and so a fractional pivot) are unchanged. */
export function vectorOutlinePath(shapeType: 'rect' | 'ellipse', geometry: { width?: number; height?: number; radiusX?: number; radiusY?: number }): PathData {
  if (shapeType === 'rect') {
    const w = geometry.width ?? 0;
    const h = geometry.height ?? 0;
    return { closed: true, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: w, y: 0 } }, { anchor: { x: w, y: h } }, { anchor: { x: 0, y: h } }] };
  }
  const rx = geometry.radiusX ?? 0;
  const ry = geometry.radiusY ?? 0;
  const k = 0.5522847498307936; // 4/3·(√2 − 1): cubic quarter-circle handle ratio
  const cx = rx;
  const cy = ry;
  return {
    closed: true,
    nodes: [
      { anchor: { x: cx + rx, y: cy }, in: { x: 0, y: -k * ry }, out: { x: 0, y: k * ry } },
      { anchor: { x: cx, y: cy + ry }, in: { x: k * rx, y: 0 }, out: { x: -k * rx, y: 0 } },
      { anchor: { x: cx - rx, y: cy }, in: { x: 0, y: k * ry }, out: { x: 0, y: -k * ry } },
      { anchor: { x: cx, y: cy - ry }, in: { x: -k * rx, y: 0 }, out: { x: k * rx, y: 0 } },
    ],
  };
}

const GEOMETRY_TRACKS = ['width', 'height', 'radiusX', 'radiusY'] as const;

/** The whole "bind a drawing to bones" edit, shared by the editor and the headless core: a rect /
 *  ellipse becomes a path (same place), the outline is densified and the skin captured at `time`.
 *  Re-binding a skinned drawing re-captures it. Returns the next objects/assets, or why not. */
export function bindSkinOp(
  objects: SceneObject[],
  assets: Asset[],
  objectId: string,
  boneIds: string[],
  time: number,
): { objects: SceneObject[]; assets: Asset[] } | { error: string } {
  const byId = new Map(objects.map((o) => [o.id, o] as const));
  const obj = byId.get(objectId);
  const asset = obj ? assets.find((a) => a.id === obj.assetId) : undefined;
  if (!obj || obj.isGroup || asset?.kind !== 'vector') return { error: 'Pick one shape or path to bind to the bones.' };
  if (isLockedInTree(obj, byId)) return { error: `"${obj.name}" is locked.` };
  if (obj.boolean || asset.compoundRings?.length || asset.primitive) return { error: 'Live booleans, compound shapes and polygons/stars can’t be skinned yet.' };
  if (obj.shapeTrack?.length) return { error: 'Remove the shape animation before binding to bones.' };
  if (GEOMETRY_TRACKS.some((k) => obj.tracks[k]?.length)) return { error: 'Remove the size animation before binding to bones.' };
  const g = sampleObject(obj, time).geometry ?? obj.shapeBase ?? {};
  const path = asset.shapeType === 'path' ? asset.path ?? { nodes: [], closed: false } : vectorOutlinePath(asset.shapeType, g);
  const r = computeSkin(objects, obj, path, boneIds, time);
  if ('error' in r) return r;
  const nextObj: SceneObject = { ...obj, skin: r.skin, tracks: { ...obj.tracks } };
  delete nextObj.shapeBase;
  for (const k of GEOMETRY_TRACKS) delete nextObj.tracks[k];
  return {
    objects: objects.map((o) => (o.id === objectId ? nextObj : o)),
    assets: assets.map((a) => (a.id === asset.id ? { ...asset, shapeType: 'path' as const, path: r.path } : a)),
  };
}
