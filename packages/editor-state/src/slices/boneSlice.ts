// Bone / IK authoring verbs (spec 2026-11-13-bone-tool-design.md, slice 1). A bone is a group
// container carrying `bone` (joint = anchor, pose = rotation). Each verb works on the active scene
// (root, a Scene, or an edited symbol), commits one undoable step, and explains a refusal with a
// toast. Poses write rotation keyframes at the playhead when auto-key is on (or a rotation track
// already exists), else the static base — so posing at two times animates the armature.
import {
  armatureRoot,
  bakeGroupIntoChild,
  boneFromDrag,
  createGroupObject,
  createKeyframe,
  isBone,
  isLockedInTree,
  newId,
  rotateBoneToward,
  sampleObject,
  snapToFrame,
  solveIK,
  unbakeGroupFromChild,
  upsertKeyframe,
  withoutFrameKey,
} from '@savig/engine';
import type { BoneSpec, SceneObject } from '@savig/engine';
import { resolveObjectAnchor } from '@savig/interaction';
import { selectActiveObjects, selectActiveScope } from '../selectors';
import { nextZOrder, withSceneObjects, type EditorState, type SliceCreator } from '../store-internals';

type BoneKeys = 'addBone' | 'attachToBone' | 'detachFromBone' | 'poseBoneTip' | 'setBoneSpec' | 'resetBonePose';

/** Is `id` (or an ancestor) `ancestorId`? Cycle-guarded. */
function isWithin(objects: SceneObject[], id: string, ancestorId: string): boolean {
  const seen = new Set<string>();
  for (let cur = objects.find((o) => o.id === id); cur && !seen.has(cur.id); cur = cur.parentId ? objects.find((o) => o.id === cur!.parentId) : undefined) {
    if (cur.id === ancestorId) return true;
    seen.add(cur.id);
  }
  return false;
}

/** `obj` moved under `newParentId` (undefined = scene root) keeping its rendered position: bake
 *  out of its old group chain, then into the new one (the reparentObject recipe, as a pure fn). */
function reparented(s: EditorState, objects: SceneObject[], obj: SceneObject, newParentId: string | undefined): SceneObject {
  const project = s.history.present;
  const parentGroup = (o: SceneObject) => (o.parentId ? objects.find((x) => x.id === o.parentId && x.isGroup) : undefined);
  const asset = project.assets.find((a) => a.id === obj.assetId);
  const r = resolveObjectAnchor(obj, asset, sampleObject(obj, snapToFrame(s.time, project.meta.fps), asset?.kind === 'vector' ? asset.primitive : undefined));
  const ax = r ? r.anchorX : obj.anchorX;
  const ay = r ? r.anchorY : obj.anchorY;
  let cur = obj;
  for (let g = parentGroup(obj); g; g = parentGroup(g)) cur = bakeGroupIntoChild(g, cur, ax, ay);
  const chain: SceneObject[] = [];
  for (let g = newParentId ? objects.find((x) => x.id === newParentId && x.isGroup) : undefined; g; g = parentGroup(g)) chain.push(g);
  for (const g of chain.reverse()) cur = unbakeGroupFromChild(g, cur, ax, ay);
  const out = withoutFrameKey({ ...cur, parentId: newParentId });
  if (!newParentId) delete out.parentId;
  return out;
}

/** The rotation write for a pose: keyframe at `time` when auto-key is on or the bone already has
 *  a rotation track (a base write would be invisible under a track), else the static base. */
function withRotation(bone: SceneObject, rotation: number, time: number, autoKey: boolean): SceneObject {
  const track = bone.tracks.rotation;
  if (!autoKey && !(track && track.length > 0)) return { ...bone, base: { ...bone.base, rotation } };
  return { ...bone, tracks: { ...bone.tracks, rotation: upsertKeyframe(track ?? [], createKeyframe(time, rotation)) } };
}

export const createBoneSlice: SliceCreator<BoneKeys> = (_set, get) => ({
  addBone(joint, tip, parentId) {
    const s = get();
    const objects = selectActiveObjects(s);
    const parent = parentId ? objects.find((o) => o.id === parentId) : undefined;
    if (parentId && !isBone(parent)) {
      s.pushToast('error', 'A child bone must start on a bone.');
      return null;
    }
    if (parent && isLockedInTree(parent, new Map(objects.map((o) => [o.id, o] as const)))) {
      s.pushToast('error', `"${parent.name}" is locked.`);
      return null;
    }
    const time = snapToFrame(s.time, s.history.present.meta.fps);
    const g = boneFromDrag(objects, parentId, joint, tip, time);
    if (g.length < 1) return null;
    const id = newId();
    const count = objects.filter((o) => isBone(o)).length + 1;
    const bone: SceneObject = {
      ...createGroupObject({ id, name: `Bone ${count}`, anchorX: g.anchorX, anchorY: g.anchorY, zOrder: nextZOrder(objects) }),
      ...(parentId ? { parentId } : {}),
      bone: { length: g.length, angle: g.angle },
    };
    get().commit(withSceneObjects(s.history.present, selectActiveScope(s), [...objects, bone]));
    get().selectObject(id);
    return id;
  },

  attachToBone(boneId, objectIds) {
    const s = get();
    const objects = selectActiveObjects(s);
    const byId = new Map(objects.map((o) => [o.id, o] as const));
    const bone = byId.get(boneId);
    if (!isBone(bone)) {
      s.pushToast('error', 'Pick a bone to attach to.');
      return;
    }
    const movers = objectIds
      .map((id) => byId.get(id))
      .filter((o): o is SceneObject => !!o && !isBone(o) && o.id !== boneId && !isWithin(objects, boneId, o.id) && !isLockedInTree(o, byId));
    if (movers.length === 0) {
      s.pushToast('error', 'Select the drawings to attach (not bones, not locked).');
      return;
    }
    const moved = new Map(movers.map((o) => [o.id, reparented(s, objects, o, boneId)] as const));
    get().commit(withSceneObjects(s.history.present, selectActiveScope(s), objects.map((o) => moved.get(o.id) ?? o)));
    get().selectObjects(movers.map((o) => o.id));
  },

  detachFromBone(objectIds) {
    const s = get();
    const objects = selectActiveObjects(s);
    const byId = new Map(objects.map((o) => [o.id, o] as const));
    const moved = new Map<string, SceneObject>();
    for (const id of objectIds) {
      const o = byId.get(id);
      const owner = o?.parentId ? byId.get(o.parentId) : undefined;
      if (!o || isBone(o) || !isBone(owner) || isLockedInTree(o, byId)) continue;
      const root = armatureRoot(objects, owner.id)!;
      const out = reparented(s, objects, o, root.parentId);
      // Back into a frame layer: file it under the armature's own key so it shows with it.
      moved.set(o.id, root.frameKeyId && root.parentId && byId.get(root.parentId)?.frames ? { ...out, frameKeyId: root.frameKeyId } : out);
    }
    if (moved.size === 0) {
      s.pushToast('error', 'Select drawings attached to a bone.');
      return;
    }
    get().commit(withSceneObjects(s.history.present, selectActiveScope(s), objects.map((o) => moved.get(o.id) ?? o)));
  },

  poseBoneTip(boneId, target, opts = {}) {
    const s = get();
    const objects = selectActiveObjects(s);
    const byId = new Map(objects.map((o) => [o.id, o] as const));
    const bone = byId.get(boneId);
    if (!isBone(bone)) return;
    if (isLockedInTree(bone, byId)) {
      s.pushToast('error', `"${bone.name}" is locked.`);
      return;
    }
    const time = snapToFrame(s.time, s.history.present.meta.fps);
    const pose = opts.fk
      ? new Map([[boneId, rotateBoneToward(objects, boneId, target, time)]])
      : solveIK(objects, boneId, target, time);
    const changed = [...pose].filter(([id, r]) => Math.abs(sampleObject(byId.get(id)!, time).rotation - r) > 1e-9);
    if (changed.length === 0) return;
    const next = new Map(changed.map(([id, r]) => [id, withRotation(byId.get(id)!, r, time, s.autoKey)] as const));
    get().commit(withSceneObjects(s.history.present, selectActiveScope(s), objects.map((o) => next.get(o.id) ?? o)));
  },

  setBoneSpec(boneId, partial) {
    const s = get();
    const objects = selectActiveObjects(s);
    const bone = objects.find((o) => o.id === boneId);
    if (!isBone(bone)) return;
    const spec: BoneSpec = { ...bone.bone };
    for (const [k, v] of Object.entries(partial) as [keyof BoneSpec, BoneSpec[keyof BoneSpec] | undefined][]) {
      if (v === undefined || v === false) delete spec[k];
      else (spec as unknown as Record<string, unknown>)[k] = v;
    }
    if (!(spec.length > 0) || !Number.isFinite(spec.angle)) return;
    if (spec.min !== undefined && spec.max !== undefined && spec.min > spec.max) {
      s.pushToast('error', 'The minimum angle must not exceed the maximum.');
      return;
    }
    get().commit(withSceneObjects(s.history.present, selectActiveScope(s), objects.map((o) => (o.id === boneId ? { ...o, bone: spec } : o))));
  },

  resetBonePose(boneId) {
    const s = get();
    const objects = selectActiveObjects(s);
    const bone = objects.find((o) => o.id === boneId);
    if (!isBone(bone)) return;
    const tracks = { ...bone.tracks };
    delete tracks.rotation;
    get().commit(withSceneObjects(s.history.present, selectActiveScope(s), objects.map((o) => (o.id === boneId ? { ...o, base: { ...o.base, rotation: 0 }, tracks } : o))));
  },
});

