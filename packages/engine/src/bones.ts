// Bones and inverse kinematics (spec 2026-11-13-bone-tool-design.md). A bone is an `isGroup`
// container carrying `bone`: its anchor is the joint, `bone.angle`/`bone.length` give the rest
// tip, and its rotation track is the pose. Child bones and attached drawings are its children, so
// every renderer already poses them through the animatable group chain (45d) — this module only
// adds the geometry and an authoring-time IK solver that WRITES rotations.

import { mapPoint } from './groupTransform';
import { sampleObject } from './sample';
import type { BoneSpec, PathPoint, SceneObject } from './types';

export type BoneObject = SceneObject & { bone: BoneSpec };

/** True for a bone (a group container carrying a `bone` spec). */
export function isBone(obj: SceneObject | undefined): obj is BoneObject {
  return !!obj?.isGroup && !!obj.bone;
}

const byIdOf = (objects: SceneObject[]) => new Map(objects.map((o) => [o.id, o] as const));

/** The rest tip of `bone` in its LOCAL (children's) space: joint + length·(cos, sin)(angle). */
export function boneLocalTip(bone: BoneObject): PathPoint {
  const rad = (bone.bone.angle * Math.PI) / 180;
  return { x: bone.anchorX + bone.bone.length * Math.cos(rad), y: bone.anchorY + bone.bone.length * Math.sin(rad) };
}

/** The bone's parent bone, if its parent is a bone. */
export function parentBone(objects: SceneObject[] | Map<string, SceneObject>, bone: SceneObject): BoneObject | undefined {
  const byId = objects instanceof Map ? objects : byIdOf(objects);
  const p = bone.parentId ? byId.get(bone.parentId) : undefined;
  return isBone(p) ? p : undefined;
}

/** The root bone of `boneId`'s armature (itself when it has no bone parent). Cycle-guarded. */
export function armatureRoot(objects: SceneObject[], boneId: string): BoneObject | undefined {
  const byId = byIdOf(objects);
  const start = byId.get(boneId);
  if (!isBone(start)) return undefined;
  let cur: BoneObject = start;
  const seen = new Set<string>();
  for (let p = parentBone(byId, cur); p && !seen.has(p.id); p = parentBone(byId, p)) {
    seen.add(p.id);
    cur = p;
  }
  return cur;
}

/** Every bone in `rootId`'s armature (root first, depth-first by zOrder). */
export function armatureBones(objects: SceneObject[], rootId: string): BoneObject[] {
  const out: BoneObject[] = [];
  const seen = new Set<string>();
  const walk = (id: string) => {
    const b = objects.find((o) => o.id === id);
    if (!isBone(b) || seen.has(id)) return;
    seen.add(id);
    out.push(b);
    objects
      .filter((o) => o.parentId === id && isBone(o))
      .sort((a, c) => a.zOrder - c.zOrder)
      .forEach((c) => walk(c.id));
  };
  walk(rootId);
  return out;
}

/** The IK chain for dragging `boneId`'s tip: the bone, then its bone ancestors, stopping BEFORE
 *  the first pinned bone (a pinned bone never rotates; nothing above it does either). Empty when
 *  the bone itself is pinned. */
export function boneChain(objects: SceneObject[], boneId: string): BoneObject[] {
  const byId = byIdOf(objects);
  const out: BoneObject[] = [];
  const seen = new Set<string>();
  for (let b: BoneObject | undefined = isBone(byId.get(boneId)) ? (byId.get(boneId) as BoneObject) : undefined; b && !seen.has(b.id); b = parentBone(byId, b)) {
    seen.add(b.id);
    if (b.bone.pinned) break;
    out.push(b);
  }
  return out;
}

/** Rotation overrides (degrees) by bone id, applied on top of the sampled pose. */
export type BonePose = Map<string, number>;

/** Map `p`, given in group `groupId`'s LOCAL space, to world (the scene's root space) through
 *  the group and every ancestor group, with `pose` overriding bone rotations. */
function toWorld(byId: Map<string, SceneObject>, groupId: string, p: PathPoint, time: number, pose?: BonePose): PathPoint {
  let q = p;
  const seen = new Set<string>();
  for (let g = byId.get(groupId); g?.isGroup && !seen.has(g.id); g = g.parentId ? byId.get(g.parentId) : undefined) {
    seen.add(g.id);
    const s = sampleObject(g, time);
    const r = pose?.get(g.id);
    q = mapPoint(r === undefined ? s : { ...s, rotation: r }, g.anchorX, g.anchorY, q.x, q.y);
  }
  return q;
}

/** World position of `boneId`'s joint at `time` (optionally under `pose`). */
export function boneJointWorld(objects: SceneObject[], boneId: string, time: number, pose?: BonePose): PathPoint {
  const byId = byIdOf(objects);
  const b = byId.get(boneId)!;
  return toWorld(byId, boneId, { x: b.anchorX, y: b.anchorY }, time, pose);
}

/** World position of `boneId`'s tip at `time` (optionally under `pose`). */
export function boneTipWorld(objects: SceneObject[], boneId: string, time: number, pose?: BonePose): PathPoint {
  const byId = byIdOf(objects);
  const b = byId.get(boneId) as BoneObject;
  return toWorld(byId, boneId, boneLocalTip(b), time, pose);
}

/** +1, or -1 when the ancestors above `bone` mirror space (odd number of negative scales), which
 *  flips the world direction of a rotation increment. */
function handedness(byId: Map<string, SceneObject>, bone: SceneObject, time: number): number {
  let sign = 1;
  const seen = new Set<string>();
  for (let g = bone.parentId ? byId.get(bone.parentId) : undefined; g?.isGroup && !seen.has(g.id); g = g.parentId ? byId.get(g.parentId) : undefined) {
    seen.add(g.id);
    const s = sampleObject(g, time);
    if (s.scaleX * s.scaleY < 0) sign = -sign;
  }
  return sign;
}

const deg = (r: number) => (r * 180) / Math.PI;
/** Wrap to (-180, 180]. */
const wrap = (a: number) => {
  const w = ((((a + 180) % 360) + 360) % 360) - 180;
  return w === -180 ? 180 : w;
};
const clampTo = (b: BoneObject, r: number) => Math.min(b.bone.max ?? Infinity, Math.max(b.bone.min ?? -Infinity, r));

/** One CCD step for `bone`: the rotation that swings `effector` (world) toward `target` about the
 *  bone's joint, clamped to its limits. */
function stepToward(
  byId: Map<string, SceneObject>,
  objects: SceneObject[],
  bone: BoneObject,
  effector: PathPoint,
  target: PathPoint,
  time: number,
  pose: BonePose,
): number {
  const j = boneJointWorld(objects, bone.id, time, pose);
  const current = pose.get(bone.id) ?? sampleObject(bone, time).rotation;
  if (Math.hypot(effector.x - j.x, effector.y - j.y) < 1e-9 || Math.hypot(target.x - j.x, target.y - j.y) < 1e-9) return current;
  const delta = wrap(deg(Math.atan2(target.y - j.y, target.x - j.x) - Math.atan2(effector.y - j.y, effector.x - j.x)));
  return clampTo(bone, current + handedness(byId, bone, time) * delta);
}

export interface IKOptions {
  /** Max CCD sweeps (default 20). */
  iterations?: number;
  /** Stop once the tip is this close to the target (world units, default 0.1). */
  tolerance?: number;
}

/** Inverse kinematics (CCD): rotations for `boneChain(tipBoneId)` that bring the tip of
 *  `tipBoneId` to `target` (world space) at `time`. Joint limits are respected and pinned bones
 *  (and everything above them) are left alone. An unreachable target leaves the chain pointing
 *  at it. Deterministic. Returns only the bones whose rotation changed. */
export function solveIK(
  objects: SceneObject[],
  tipBoneId: string,
  target: PathPoint,
  time: number,
  opts: IKOptions = {},
): BonePose {
  const chain = boneChain(objects, tipBoneId);
  const out: BonePose = new Map();
  if (chain.length === 0) return out;
  const byId = byIdOf(objects);
  const pose: BonePose = new Map(chain.map((b) => [b.id, sampleObject(b, time).rotation] as const));
  const iterations = opts.iterations ?? 20;
  const tol = opts.tolerance ?? 0.1;
  // At (or beyond) full reach CCD crawls toward the straight pose and stops short, so straighten
  // first: root-first, point each bone's own tip at the target. CCD then refines from there.
  const root = chain[chain.length - 1];
  const reach = chain.reduce((sum, b) => {
    const j = boneJointWorld(objects, b.id, time, pose);
    const t = boneTipWorld(objects, b.id, time, pose);
    return sum + Math.hypot(t.x - j.x, t.y - j.y);
  }, 0);
  const rj = boneJointWorld(objects, root.id, time, pose);
  if (Math.hypot(target.x - rj.x, target.y - rj.y) >= reach - tol) {
    for (const b of [...chain].reverse()) pose.set(b.id, stepToward(byId, objects, b, boneTipWorld(objects, b.id, time, pose), target, time, pose));
  }
  for (let it = 0; it < iterations; it++) {
    for (const b of chain) {
      const tip = boneTipWorld(objects, tipBoneId, time, pose);
      pose.set(b.id, stepToward(byId, objects, b, tip, target, time, pose));
    }
    const tip = boneTipWorld(objects, tipBoneId, time, pose);
    if (Math.hypot(tip.x - target.x, tip.y - target.y) <= tol) break;
  }
  for (const b of chain) {
    const before = sampleObject(b, time).rotation;
    const after = pose.get(b.id)!;
    if (Math.abs(after - before) > 1e-9) out.set(b.id, after);
  }
  return out;
}

/** Forward kinematics: the rotation of `boneId` alone that points its tip at `target` (world),
 *  clamped to its limits. Pinned bones keep their rotation. */
export function rotateBoneToward(objects: SceneObject[], boneId: string, target: PathPoint, time: number): number {
  const byId = byIdOf(objects);
  const b = byId.get(boneId) as BoneObject;
  const current = sampleObject(b, time).rotation;
  if (!isBone(b) || b.bone.pinned) return current;
  return stepToward(byId, objects, b, boneTipWorld(objects, boneId, time), target, time, new Map());
}

/** Inverse of `toWorld`: a world point expressed in group `groupId`'s LOCAL (children's) space at
 *  `time` (identity when `groupId` is undefined — the scene root). Where a new child bone's joint
 *  and tip land inside a posed parent. */
export function worldToGroupLocal(objects: SceneObject[], groupId: string | undefined, p: PathPoint, time: number): PathPoint {
  const byId = byIdOf(objects);
  const chain: SceneObject[] = [];
  const seen = new Set<string>();
  for (let g = groupId ? byId.get(groupId) : undefined; g?.isGroup && !seen.has(g.id); g = g.parentId ? byId.get(g.parentId) : undefined) {
    seen.add(g.id);
    chain.push(g);
  }
  let q = p;
  for (const g of chain.reverse()) {
    const t = sampleObject(g, time);
    const rad = (t.rotation * Math.PI) / 180;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const dx = q.x - t.x - g.anchorX;
    const dy = q.y - t.y - g.anchorY;
    q = { x: g.anchorX + (c * dx + s * dy) / t.scaleX, y: g.anchorY + (-s * dx + c * dy) / t.scaleY };
  }
  return q;
}

/** The bone spec + joint for a bone dragged from `joint` to `tip` (world) under `parentId` (a bone
 *  or any group; undefined = scene root), measured in the parent's local space at `time`. */
export function boneFromDrag(
  objects: SceneObject[],
  parentId: string | undefined,
  joint: PathPoint,
  tip: PathPoint,
  time: number,
): { anchorX: number; anchorY: number; length: number; angle: number } {
  const j = worldToGroupLocal(objects, parentId, joint, time);
  const t = worldToGroupLocal(objects, parentId, tip, time);
  return {
    anchorX: j.x,
    anchorY: j.y,
    length: Math.hypot(t.x - j.x, t.y - j.y),
    angle: (Math.atan2(t.y - j.y, t.x - j.x) * 180) / Math.PI,
  };
}
