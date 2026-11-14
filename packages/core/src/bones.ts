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
} from '@savig/engine';
import type { BoneSpec, Easing, PathPoint, Project, SceneObject } from '@savig/engine';
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
  const spec: BoneSpec = {
    length: opts.length,
    angle: opts.angle ?? 0,
    ...(opts.min !== undefined ? { min: opts.min } : {}),
    ...(opts.max !== undefined ? { max: opts.max } : {}),
    ...(opts.pinned ? { pinned: true } : {}),
  };
  const count = project.objects.filter((o) => isBone(o)).length + 1;
  const bone: SceneObject = {
    ...createGroupObject({ id, name: opts.name ?? `Bone ${count}`, anchorX: joint.x, anchorY: joint.y, zOrder: nextZ(project.objects) }),
    ...(parent ? { parentId: parent.id } : {}),
    bone: spec,
  };
  return { project: { ...project, objects: [...project.objects, bone] }, id };
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
    const value = pose.get(b.id) ?? sampleObject(b, opts.time).rotation;
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
