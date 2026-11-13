# Bone Tool — Slice 1 (model, IK engine, store verbs)

Spec: `specs/2026-11-13-bone-tool-design.md`.

## Tasks

1. **Model.**
   - `SceneObject.bone?: BoneSpec` (`{ length, angle, min?, max?, pinned? }`), only on a group.
     The joint is the group's anchor and the pose is its rotation.
   - No format bump. Services `sanitizeBones.ts`, chained last in `migrate.ts`, drops a
     malformed spec, inverted or non-finite limits, and a non-boolean `pinned`.
2. **Engine `bones.ts`.**
   - Chain helpers: `isBone`, `parentBone`, `armatureRoot`, `armatureBones`, and `boneChain`
     (which stops before a pinned bone).
   - Geometry: `boneLocalTip`, `boneJointWorld`, `boneTipWorld` (with rotation overrides),
     `worldToGroupLocal` and `boneFromDrag`.
   - IK: `solveIK` (CCD, up to 20 sweeps, 0.1 px tolerance, limits, mirrored ancestors,
     wrapped increments, deterministic, returns only the changed bones).
   - FK: `rotateBoneToward`.
3. **Store (`slices/boneSlice.ts`).**
   - `addBone(joint, tip, parentId?)` creates a group named `Bone N`, measured in the parent's
     space even when the parent is posed.
   - `attachToBone` and `detachFromBone` bake world position (the `reparentObject` recipe).
     Detaching back into a frame layer keeps the armature's key.
   - `poseBoneTip(boneId, target, { fk })` writes rotation keyframes when auto-key is on or a
     track already exists, otherwise the base. It is one commit.
   - `setBoneSpec` and `resetBonePose`.
4. **Tests.**
   - engine `bones.test.ts`
   - services `sanitizeBones.test.ts` and `export/bones.test.ts` (runtime transform and SMIL
     parity)
   - editor-state `store.bones.test.ts`

## Notes

- Attaching bakes through the bone chain at t=0 (the 45d `bakeGroupIntoChild` limit). Attach
  drawings before posing, as you would in Flash.
