# Bone Skinning — Slice 2 (editor)

Spec: `specs/2026-11-14-bone-skinning-design.md` §Editor.

## Tasks

1. **Fix from slice 1:** path handles are offsets from their anchor (path.ts). `densifyPath`
   now splits in absolute space and writes relative handles back; `skinnedPath` applies only the
   linear part of the blended matrix to handles. Tests cover a curved skin.
2. **Engine:** `vectorOutlinePath(rect | ellipse, geometry)` — the outline as a path in the same
   local coordinates (bounds, and so a fractional pivot, unchanged).
3. **Store (`boneSlice`):** `bindSkin(objectId, boneIds)` converts a rect/ellipse to a path,
   densifies, computes the skin at the playhead's pose and commits once (refuses groups, locked,
   live booleans, compound/primitive shapes, morphing or size-animated drawings, non-bones, a
   drawing inside a bone). Re-binding re-captures at the current pose. `unbindSkin`.
4. **Commands:** `anim.bindSkin` (one selected bone = its whole armature) and `anim.unbindSkin`;
   predicates `canBindSkin` / `canUnbindSkin`.
5. **Inspector / Layers:** multi-selection "Bind to Bones"; a skinned drawing shows
   "Skin · N bones" with Rebind and Unbind; Layers "Skin" badge.
6. **Tests:** store bind/unbind/undo, predicates + intent, e2e `skin.spec.ts` (bind, tip drag
   bends the bar, undo pose then bind).
