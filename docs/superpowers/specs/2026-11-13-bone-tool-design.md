# Bone Tool and Inverse Kinematics — Design

**Date:** 2026-11-13
**Status:** approved for slicing. Steve said "continue on all in order" (filters → shape tween → bone
tool / IK). This is the last item.

## Goal

Flash's **Bone tool**. You draw a chain of bones (an armature) through a character's parts, attach
the drawings to the bones, and then pose the character by dragging a limb's end. The rest of the
chain follows through **inverse kinematics**, and poses keyframe onto the timeline like any other
animation.

What a user can do when this ships:

1. **Bone tool (J).** Drag on the Stage from a joint to a tip to create a bone. Dragging from an
   existing bone's tip starts a child bone there. Chains and branches (two arms off a torso) both
   work.
2. Select drawings, then a bone, and run **Attach to Bone**. The drawings move with that bone from
   then on.
3. **Pose.** With the Select tool, drag a bone's tip. IK rotates every bone from that one up to the
   armature root so the tip follows the pointer. Each bone's joint limits (min/max angle) are
   respected. With auto-key on, each moved bone's rotation keyframes at the playhead, so posing at
   frame 1 and again at frame 24 gives an animated pose. Alt-drag rotates only the dragged bone
   (FK).
4. The Inspector edits a bone's length, joint limits and "pinned" flag. A pinned bone does not
   rotate during IK.
5. Agents get the same through core, DSL (`bones`), MCP and describe (slice 3).

## Approach decision

| Option | Verdict |
|---|---|
| **A. A bone is a group container.** It has a `bone` spec, its anchor is the joint, and its rotation track is the pose. A child bone nests inside its parent. IK is an *authoring-time* solver that writes rotations. | ✅ Chosen. Animatable group transforms already compose onto children in every renderer (45d: Stage, runtime, SMIL, raster). A posed armature therefore renders, exports and plays with **no new render code**, and has preview == export parity. Bones are invisible in export because groups have no DOM node, which is exactly Flash's behaviour. Timeline lanes, easing, copy/paste of keys and undo all come for free. |
| B. Separate armature data plus a render-time skinning pass. | Rejected. Every renderer and exporter would need a new transform source. It would also duplicate the group chain and break the one-walker rule. |
| C. Mesh skinning (deforming shapes by weighted bones). | Out of scope for v1. It needs per-node weights and a deform pass. It is listed under Deferred. Flash's own bone tool on shapes (shape armatures) is the rough equivalent. |

The trade-off of A is that IK is not live at playback. The pose *is* the rotation keys, and
between keys bones interpolate per-joint angles. That is exactly how Flash's armature layers
tween, so it is the expected behaviour.

## Model

```ts
interface SceneObject {
  // …
  /** Bone (spec 2026-11-13-bone-tool): only on an `isGroup` container, which it turns into a bone.
   *  The joint is the group's anchor (anchorX/anchorY, in the parent's space). The rest direction
   *  and length give the tip. Children of the group (drawings and child bones) move with it.
   *  Absent = ordinary group (parity). */
  bone?: BoneSpec;
}

interface BoneSpec {
  /** Rest length (> 0) in the parent's units. */
  length: number;
  /** Rest direction in degrees (0 = +x, clockwise-positive like rotation). The tip at rotation 0
   *  is anchor + length·(cos, sin). */
  angle: number;
  /** Joint limits on the bone's rotation (degrees), applied by IK and the pose drag. Absent =
   *  free. */
  min?: number;
  max?: number;
  /** IK never rotates a pinned bone (the chain stops there). */
  pinned?: boolean;
}
```

- **Armature:** a bone whose parent is not a bone is a **root bone**. Its descendants form the
  armature. A root bone's own x/y (translation) moves the whole armature. IK never translates it.
- **Rest pose:** rotation 0 on every bone. A child bone's joint is created at its parent's tip
  (rest-pose coordinates). It may be moved later, which gives an offset joint.
- **No format bump.** An older build renders the same groups and ignores `bone`. The sanitizer
  drops a malformed spec (non-finite or non-positive length, non-finite angles, `min` > `max`) or
  one on a non-group.

## Engine (`bones.ts`)

- `isBone(obj)`, `boneChain(objects, boneId)` (the bone, then its bone ancestors up to the root or
  the first pinned bone), `armatureRoot` and `armatureBones`.
- `boneLocalTip(bone)` gives the rest tip in the parent's space. `boneJointWorld` and
  `boneTipWorld(project/objects, boneId, time, overrides?)` map those through the world chain,
  using `worldChain` with optional per-bone rotation overrides.
- `solveIK(objects, tipBoneId, target, time, opts)` returns `Map<boneId, rotationDeg>`.
  - It uses **CCD** (cyclic coordinate descent): up to 20 iterations, stopping within 0.1 px.
    From the tip bone up to the chain root, each bone rotates so that its joint-to-tip ray points
    at the target. The rotation is clamped to [min, max], and pinned bones are skipped.
  - Mirrored ancestors (negative scale) flip the rotation sign.
  - It is deterministic, and rotations are unwrapped to stay near the current value, so
    keyframes don't spin the long way round.
  - An unreachable target leaves the chain pointing straight at it.
- `rotateBoneToward(objects, boneId, target, time)` is the FK drag on a single bone.

## Editor (slice 2)

- **Bone tool** (`ToolMode 'bone'`, key **J**; B is taken by the Brush). A drag creates a bone group:
  - The joint is the drag start and the length/angle come from the drag. Its parent is the bone
    whose tip is within 8 px of the drag start (snap the joint onto that tip), otherwise none.
  - The new bone is selected. It is one undo step.
  - A drag under 4 px is ignored.
- **Bone overlay** (editor-only, never exported). Each bone is drawn as Flash's tapered
  joint-to-tip wedge with a joint circle. The selected bone is highlighted. The overlay shows
  only while the Bone tool is active or a bone (or something inside one, or the group holding an
  armature) is selected. (A View toggle "Show bones" is deferred.)
- **Pose drag:** with the Select tool, pointer-down on a bone's tip handle and drag.
  - The preview applies `solveIK` rotations live through the Stage's surgical group preview.
  - Release commits every changed bone's rotation through the existing object transform path:
    auto-key on keyframes, off writes base. It is one undo step.
  - Alt-drag is FK, rotating only that bone.
- **Attach to Bone** (command plus Inspector button): reparents the selected non-bone objects into
  the selected bone, baking their world transform with `unbakeGroupFromChild`. **Detach from
  Bone** moves them back up to the armature's parent.
- **Inspector bone section:** length, rest angle, min/max limits, pinned, and "Reset pose"
  (rotation 0, clearing that bone's rotation keys).
- Layers shows a "Bone" badge on bone groups. The Timeline already shows their rotation lanes.
- **Selection:** a bone is a selection barrier, like a frame layer. `resolveToEntity` stops
  climbing at a bone parent, so clicking a child bone selects that bone and clicking an attached
  drawing selects the drawing, never the whole armature.

## Agent parity (slice 3)

- **Core:**
  - `addBone(project, { id, parentId?, x, y, length, angle, min?, max?, pinned? })`: the joint
    snaps to the parent tip when `x`/`y` are omitted and a parent is given.
  - `attachToBone(project, boneId, objectIds)`: keeps each drawing in place (baked at t=0).
  - `poseIK(project, boneId, { x, y }, { time, easing? })`, which keyframes EVERY bone of the chain
    at `time` (unchanged ones too, so the pose holds between surrounding keys).
  - `setBoneRotation(project, boneId, deg, { time?, easing? })` (FK, clamped to limits; base
    without `time`).
- **DSL:** a `bones` object type is a nested tree:
  `{ type: 'bone', id, x, y, length, angle, …, animate: { rotation }, children: [bones | shapes] }`.
  Child drawings are written in rest-pose coordinates: compile builds the tree at rest, attaches,
  then applies `base`/`animate`. Decompile writes the same tree (attached drawings only inside it).
- **describe:** each bone line reads `bone len=… angle=…° joint=(x,y) [limits a°..b°] [pinned] → children`.
- **MCP:** `add_bone`, `attach_to_bone`, `pose_ik` and `set_bone_rotation`.
- **Template:** "Waving arm", a three-bone arm with a hand that waves via two IK poses.

## Testing

- **Engine:**
  - chain walking (branch, pinned stop)
  - tip world positions under rotated or scaled ancestors
  - CCD reaching a reachable target within tolerance
  - limits respected
  - unreachable target straight-line
  - unwrap
  - determinism
- **Store:** create bone, child-snap, attach/detach bake (world position unchanged), pose commit
  keyframes vs base, FK, undo.
- **Render:** a posed armature's drawings move in the runtime and SMIL exactly like an animated
  group (parity).
- **e2e:** draw two bones with the Bone tool, draw a rect and attach it, drag the tip with auto-key
  at two times, and check that the rect moved and both bones have rotation keys.

## Slices

1. Model, engine (`bones.ts` with IK), sanitizer, and the store verbs `addBone`, `attachToBone`,
   `detachFromBone`, `poseBoneTip(boneId, target, { fk })` and `setBoneSpec`. Unit tests.
2. Editor UI: Bone tool, overlay, pose drag, Inspector, commands, Layers badge, e2e.
3. Agent parity.

## Deferred

- Shape (mesh) skinning, where bones bend one shape.
- Bone translation joints (Flash's "x/y translation" joint option).
- Spring/physics.
- Live IK at runtime (IK constraints solved during playback).
- Bones inside symbols are allowed (it's all groups), but in v1 the Bone tool works only in the
  active scene.
