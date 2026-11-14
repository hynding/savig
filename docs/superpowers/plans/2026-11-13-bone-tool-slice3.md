# Bone Tool — Slice 3 (agent parity)

Spec: `specs/2026-11-13-bone-tool-design.md` §Agent parity.

## Tasks

1. **Core (`core/src/bones.ts`).** Pure, id-addressed, fail-loud builders:
   - `addBone(project, { id?, name?, parentId?, x?, y?, length, angle?, min?, max?, pinned? })`.
     A child without x/y starts at its parent's tip; a root needs x/y.
   - `attachToBone(project, boneId, objectIds)`: the store's reparent recipe (bake out of the old
     group chain, into the bone's), so drawings don't move. Refuses bones, frame layers and the
     bone's own ancestors.
   - `poseIK(project, boneId, target, { time, easing? })`: `solveIK`, then a rotation key on every
     bone of the chain at `time`. Refuses a pinned tip bone.
   - `setBoneRotation(project, boneId, deg, { time?, easing? })`: FK, clamped to limits.
2. **DSL.** `ShortBone` tree (`type: 'bone'`, joint, length/angle/limits/pinned, `base`,
   `animate`, `children` of bones and shapes). Compile builds at rest, attaches each child drawing,
   then applies poses. Decompile emits root bones as trees and skips anything under a bone at the
   top level; `compileShort(decompileProject(p))` reproduces the objects.
3. **describe.** Kind `bone`; `bone len=… angle=…° joint=(x,y) [limits] [pinned] → children`.
4. **MCP.** `add_bone`, `attach_to_bone`, `pose_ik`, `set_bone_rotation`; `load_dsl` documents
   the bone tree.
5. **Template.** `waving-arm`: three bones with attached sleeve, forearm and palm, posed with IK
   at five times so the hand waves.
6. **Tests.** `core/src/bones.test.ts` (builders, DSL round-trip, describe) and MCP tool tests;
   the template rides the generic templates suite (valid, animated, renderable, reproducible).
