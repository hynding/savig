# Bone Tool — Slice 2 (editor UI)

Spec: `specs/2026-11-13-bone-tool-design.md` §Editor. Builds on slice 1's store verbs.

## Tasks

1. **Tool.** `ToolMode 'bone'` (allowed in symbol edit), command `tool.bone` on key **J**, a
   Toolbar entry with a bone icon.
2. **Overlay (`Stage/BoneOverlay.tsx`).** Editor-only chrome in content space:
   - Tapered wedges with joint circles; the selected bone is accent-coloured. Clicking a wedge
     selects the bone (Shift toggles).
   - With the Bone tool, a full-canvas capture rect: a drag (≥ 4 px) calls `addBone`; a drag
     that starts within 8 px of a tip grows a child bone from that tip.
   - With other tools, tip handles pose: drag = `solveIK`, Alt-drag = `rotateBoneToward`. Moves
     preview by re-rendering the Stage's nodes with `posedObjects(objects, pose)`; release calls
     `poseBoneTip` once (one undo step).
   - Shown while the Bone tool is active or the selection touches an armature.
3. **Selection.** `resolveToEntity` treats a bone parent as a barrier, so child bones and attached
   drawings are their own entities (Stage clicks and Layers toggles).
4. **Commands / Inspector / Layers.**
   - `anim.attachToBone` / `anim.detachFromBone` with `canAttachToBone` / `canDetachFromBone`.
   - Inspector bone section on a bone group: pose readout (keyed or not), Reset pose, length,
     rest angle, Limit joint (±45° default), Joint min / max, Pin bone. Multi-selection with a
     bone shows "Attach to Bone"; a drawing on a bone shows its owner with Detach.
   - Layers "Bone" badge on bone rows.
5. **Tests.**
   - `store.bones.test.ts`: bones as selection barriers.
   - e2e `bones.spec.ts`: draw two bones (the second from the first's tip), attach a rectangle,
     IK-pose by dragging the tip (rect follows, both bones keyed, undo removes it in one step);
     Inspector pin/limit edits and an Alt-drag FK clamped to the +45° limit.
