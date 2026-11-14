/** Headless bone / IK builders (spec 2026-11-13-bone-tool §Agent parity, slice 3): the agent path
 *  to Flash-style armatures. Same contract as build.ts: pure, id-addressed, root-scene only (MCP
 *  wraps them in `withScene`), fail loud on bad references.
 *
 *  A bone is a group container carrying `bone`: its anchor is the joint, `bone.angle` /
 *  `bone.length` give the rest tip, and its rotation track is the pose. Joint coordinates are in
 *  the parent bone's space, which for an armature in its rest pose (every rotation 0) is simply
 *  artboard space — so an agent lays an arm out in plain artboard coordinates, attaches the
 *  drawings, and only then poses it. */
import {
  bakeGroupIntoChild,
  bindSkinOp,
  boneChain,
  boneLocalTip,
  createGroupObject,
  isBone,
  newId,
  pathBounds,
  resolveAnchor,
  sampleObject,
  solveIK,
  unbakeGroupFromChild,
  withoutFrameKey,
  springOffset,
  bakeProjectSprings,
} from '@savig/engine';
import type { BoneSpec, BoneSpring, Easing, PathPoint, Project, SceneObject } from '@savig/engine';
import { setBaseTransform, setKeyframe } from './build';

function requireObject(project: Project, id: string): SceneObject {
  const o = project.objects.find((x) => x.id === id);
  if (!o) throw new Error(`savig/core: no object with id "${id}"`);
  return o;
}

function requireBone(project: Project, id: string): SceneObject & { bone: BoneSpec } {
  const o = requireObject(project, id);
  if (!isBone(o)) throw new Error(`savig/core: "${id}" is not a bone`);
  return o;
}

function nextZ(objects: SceneObject[]): number {
  return objects.reduce((m, o) => Math.max(m, o.zOrder), -1) + 1;
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export interface BoneOpts {
  id?: string;
  name?: string;
  /** Parent bone (a child bone hangs off it and rotates with it). Omitted = a new armature root. */
  parentId?: string;
  /** Joint position in the parent's space (artboard space at rest). Omitted with a parent = the
   *  parent's tip; required for a root bone. */
  x?: number;
  y?: number;
  /** Rest length (> 0) and direction (degrees, 0 = pointing right, 90 = down). */
  length: number;
  angle?: number;
  /** Joint limits (degrees of rotation away from rest); `min` ≤ `max`. */
  min?: number;
  max?: number;
  /** A pinned bone never rotates under IK (nor does anything above it). */
  pinned?: boolean;
  /** Spring (spec 2026-11-14-bone-springs): follow-through on this bone. */
  spring?: SpringOpts;
}

/** Flash-style spring settings, 0–100 each: `strength` (0 = off) sets how stiffly the bone
 *  returns to its keyed angle, `damping` (default 30) how quickly the swing dies out. */
export interface SpringOpts {
  strength: number;
  damping?: number;
}

/** Default spring damping (matches the editor's inspector). */
const DEFAULT_DAMPING = 30;

function springSpec(s: SpringOpts): BoneSpring | undefined {
  if (!s || typeof s !== 'object') throw new Error('savig/core: spring must be { strength, damping? }');
  const { strength, damping = DEFAULT_DAMPING } = s;
  if (!finite(strength) || strength < 0 || strength > 100) throw new Error('savig/core: spring strength must be a number from 0 to 100');
  if (!finite(damping) || damping < 0 || damping > 100) throw new Error('savig/core: spring damping must be a number from 0 to 100');
  return strength > 0 ? { strength, damping } : undefined;
}

/** Add a bone. A child bone's joint snaps to its parent's tip unless `x`/`y` are given. */
export function addBone(project: Project, opts: BoneOpts): { project: Project; id: string } {
  const parent = opts.parentId !== undefined ? requireBone(project, opts.parentId) : undefined;
  if (!finite(opts.length) || opts.length <= 0) throw new Error('savig/core: a bone needs a positive length');
  if (opts.angle !== undefined && !finite(opts.angle)) throw new Error('savig/core: bone angle must be a finite number');
  if ((opts.min !== undefined && !finite(opts.min)) || (opts.max !== undefined && !finite(opts.max))) {
    throw new Error('savig/core: bone limits must be finite numbers');
  }
  if (opts.min !== undefined && opts.max !== undefined && opts.min > opts.max) throw new Error('savig/core: bone min must not exceed max');
  const hasXY = opts.x !== undefined || opts.y !== undefined;
  if (hasXY && !(finite(opts.x) && finite(opts.y))) throw new Error('savig/core: bone x and y must both be finite numbers');
  if (!hasXY && !parent) throw new Error('savig/core: a root bone needs x and y');
  const joint: PathPoint = hasXY ? { x: opts.x!, y: opts.y! } : boneLocalTip(parent!);
  const id = opts.id ?? newId();
  if (project.objects.some((o) => o.id === id)) throw new Error(`savig/core: id "${id}" is already in use`);
  const spring = opts.spring !== undefined ? springSpec(opts.spring) : undefined;
  const spec: BoneSpec = {
    length: opts.length,
    angle: opts.angle ?? 0,
    ...(opts.min !== undefined ? { min: opts.min } : {}),
    ...(opts.max !== undefined ? { max: opts.max } : {}),
    ...(opts.pinned ? { pinned: true } : {}),
    ...(spring ? { spring } : {}),
  };
  const count = project.objects.filter((o) => isBone(o)).length + 1;
  const bone: SceneObject = {
    ...createGroupObject({ id, name: opts.name ?? `Bone ${count}`, anchorX: joint.x, anchorY: joint.y, zOrder: nextZ(project.objects) }),
    ...(parent ? { parentId: parent.id } : {}),
    bone: spec,
  };
  const next = { ...project, objects: [...project.objects, bone] };
  return { project: spring ? bakeProjectSprings(next) : next, id };
}

/** Give bone `boneId` a spring (`null`, or strength 0, removes it) and re-bake the follow-through.
 *  Springs are simulated against the keyed motion, so after later edits to a sprung armature
 *  (new poses, timing) call `bakeProjectSprings` — the MCP tools do this after every edit. */
export function setBoneSpring(project: Project, boneId: string, spring: SpringOpts | null): Project {
  const b = requireBone(project, boneId);
  const next = spring === null ? undefined : springSpec(spring);
  const bone: BoneSpec = { ...b.bone };
  if (next) bone.spring = next;
  else delete bone.spring;
  const objects = project.objects.map((o) => (o.id === boneId ? { ...o, bone } : o));
  return bakeProjectSprings({ ...project, objects });
}

/** Is `id` (or one of its ancestors) `ancestorId`? Cycle-guarded. */
function isWithin(byId: Map<string, SceneObject>, id: string, ancestorId: string): boolean {
  const seen = new Set<string>();
  for (let cur = byId.get(id); cur && !seen.has(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
    if (cur.id === ancestorId) return true;
    seen.add(cur.id);
  }
  return false;
}

/** The object's absolute pivot (vector fraction anchors resolved against its t=0 geometry). */
function absoluteAnchor(project: Project, o: SceneObject): PathPoint {
  const asset = project.assets.find((a) => a.id === o.assetId);
  if (asset?.kind !== 'vector') return { x: o.anchorX, y: o.anchorY };
  const state = sampleObject(o, 0, asset.primitive);
  const path = asset.shapeType === 'path' ? state.path ?? asset.path : undefined;
  const r = resolveAnchor(o, state, asset.shapeType, path ? pathBounds(path) : undefined);
  return { x: r.anchorX, y: r.anchorY };
}

/** Attach drawings to a bone: each moves into the bone (so it follows the bone's pose) without
 *  moving on screen — its transform is re-expressed in the bone's space at t=0. Bones, the bone's
 *  own ancestors and frame layers can't be attached. */
export function attachToBone(project: Project, boneId: string, objectIds: string[]): Project {
  requireBone(project, boneId);
  if (objectIds.length === 0) throw new Error('savig/core: attachToBone needs at least one object');
  const byId = new Map(project.objects.map((o) => [o.id, o] as const));
  const group = (id: string | undefined) => (id ? byId.get(id) : undefined);
  const moved = new Map<string, SceneObject>();
  for (const id of objectIds) {
    const o = requireObject(project, id);
    if (isBone(o)) throw new Error(`savig/core: "${id}" is a bone — use addBone with parentId to chain bones`);
    if (o.frames) throw new Error(`savig/core: "${id}" is a frame layer and cannot be attached to a bone`);
    if (isWithin(byId, boneId, id)) throw new Error(`savig/core: "${id}" contains the bone "${boneId}"`);
    const a = absoluteAnchor(project, o);
    let cur = o;
    for (let g = group(o.parentId); g?.isGroup; g = group(g.parentId)) cur = bakeGroupIntoChild(g, cur, a.x, a.y);
    const chain: SceneObject[] = [];
    for (let g = group(boneId); g?.isGroup; g = group(g.parentId)) chain.push(g);
    for (const g of chain.reverse()) cur = unbakeGroupFromChild(g, cur, a.x, a.y);
    moved.set(id, withoutFrameKey({ ...cur, parentId: boneId }));
  }
  return { ...project, objects: project.objects.map((o) => moved.get(o.id) ?? o) };
}

/** Inverse kinematics: rotate `boneId`'s chain (it and its bone ancestors up to a pinned bone) so
 *  its tip reaches `target` (artboard space) at `time`, and keyframe EVERY bone of the chain there
 *  — so the pose holds at that time even when other keys surround it. An unreachable target leaves
 *  the chain pointing at it; joint limits are respected. */
export function poseIK(project: Project, boneId: string, target: PathPoint, opts: { time: number; easing?: Easing }): Project {
  requireBone(project, boneId);
  if (!finite(target?.x) || !finite(target?.y)) throw new Error('savig/core: poseIK needs a finite target { x, y }');
  if (!finite(opts?.time) || opts.time < 0) throw new Error('savig/core: poseIK needs a time ≥ 0');
  const chain = boneChain(project.objects, boneId);
  if (chain.length === 0) throw new Error(`savig/core: "${boneId}" is pinned and cannot be posed`);
  const pose = solveIK(project.objects, boneId, target, opts.time);
  for (const b of chain) {
    // Keyed angle: drop a sprung bone's simulated follow-through (spec 2026-11-14-bone-springs).
    const value = (pose.get(b.id) ?? sampleObject(b, opts.time).rotation) - springOffset(b, opts.time);
    project = setKeyframe(project, { objectId: b.id, property: 'rotation', time: opts.time, value, easing: opts.easing });
  }
  return project;
}

/** Forward kinematics: set one bone's rotation (degrees away from rest, clamped to its limits) —
 *  as a keyframe at `time`, or the static base when `time` is omitted. */
export function setBoneRotation(project: Project, boneId: string, rotation: number, opts: { time?: number; easing?: Easing } = {}): Project {
  const b = requireBone(project, boneId);
  if (!finite(rotation)) throw new Error('savig/core: bone rotation must be a finite number');
  const value = Math.min(b.bone.max ?? Infinity, Math.max(b.bone.min ?? -Infinity, rotation));
  if (opts.time === undefined) return setBaseTransform(project, boneId, { rotation: value });
  if (!finite(opts.time) || opts.time < 0) throw new Error('savig/core: time must be ≥ 0');
  return setKeyframe(project, { objectId: boneId, property: 'rotation', time: opts.time, value, easing: opts.easing });
}

/** Bone skinning (spec 2026-11-14-bone-skinning): bend drawing `objectId` (a rect, ellipse or
 *  path — rects/ellipses become paths in place) with `boneIds`. The drawing is captured against
 *  the armature as it stands at `time` (default 0), or at REST (every bone rotation 0) with
 *  `atRest` — what the DSL uses, so the bones' animation can be written before or after. */
export function bindSkin(project: Project, objectId: string, boneIds: string[], opts: { time?: number; atRest?: boolean } = {}): Project {
  requireObject(project, objectId);
  if (boneIds.length === 0) throw new Error('savig/core: bindSkin needs at least one bone');
  for (const id of boneIds) requireBone(project, id);
  const time = opts.time ?? 0;
  if (!finite(time) || time < 0) throw new Error('savig/core: time must be ≥ 0');
  const view = opts.atRest
    ? project.objects.map((o) => {
        if (!isBone(o)) return o;
        const tracks = { ...o.tracks };
        delete tracks.rotation;
        return { ...o, base: { ...o.base, rotation: 0 }, tracks };
      })
    : project.objects;
  const r = bindSkinOp(view, project.assets, objectId, boneIds, time);
  if ('error' in r) throw new Error(`savig/core: ${r.error}`);
  const bound = r.objects.find((o) => o.id === objectId)!;
  return { ...project, assets: r.assets, objects: project.objects.map((o) => (o.id === objectId ? bound : o)) };
}

/** Remove a drawing's skin (it keeps its rest outline). */
export function unbindSkin(project: Project, objectId: string): Project {
  const o = requireObject(project, objectId);
  if (!o.skin) throw new Error(`savig/core: "${objectId}" is not skinned`);
  const out = { ...o };
  delete out.skin;
  return { ...project, objects: project.objects.map((x) => (x.id === objectId ? out : x)) };
}
