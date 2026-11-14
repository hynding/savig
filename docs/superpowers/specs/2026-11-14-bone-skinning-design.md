# Bone skinning (shape armatures) — design

Status: approved direction (Steve, 2026-11-14: "work on each in order"). Follows the bone tool
(`2026-11-13-bone-tool-design.md`), whose Deferred list named "shape (mesh) skinning".

## Goal

Flash's *shape armature*: a chain of bones bends ONE drawing smoothly — a tail, a tentacle, a
rope, a soft arm — instead of moving rigid drawings that crack at the joints. Posing (IK drag,
FK, rotation keys) is exactly the bone tool's; only how the drawing follows changes.

## Model

`SceneObject.skin?: SkinSpec` on a **path** vector object:

```ts
interface SkinSpec {
  bones: string[];        // bone ids (same scope as the skinned object)
  binds: Mat2D[];         // per bone: path-local → bone-local at bind time  (K_i)
  weights: number[][];    // per path node, one weight per bone, each row sums to 1
}
type Mat2D = [a, b, c, d, e, f]; // x' = a·x + c·y + e, y' = b·x + d·y + f
```

- The skinned object is NOT inside a bone; it is a sibling of the armature (it lives in some
  space P — its parent group or the scene root — and the bones' transforms are measured from
  each bone up to, not including, P).
- Linear blend skinning. With `M_i(t)` = bone i's local→P matrix and `T(t)` = the object's own
  local→P transform, a path point `p` (anchor and both handles of each node, all with the node's
  weights) renders at
  `p' = T(t)⁻¹ · Σᵢ wᵢ · M_i(t) · K_i · p`.
  At bind time `K_i = M_i(bind)⁻¹ · T(bind)`, so nothing moves until a bone does. The object's
  own transform is cancelled: a skinned drawing belongs to its armature (Flash behaves the same).
- Weights are computed automatically at bind time: per node, inverse-fourth-power distance to each
  bone's segment (in P), the two strongest kept, normalized. Deterministic.
- The bind densifies the path first (cubic subdivision; segments ≤ 24 px) so a 4-corner rect
  still bends smoothly. The shape is unchanged; only node count grows.
- A morphing path (`shapeTrack`) may be skinned only while its node count matches `weights`;
  a mismatch (or a missing bone) renders the undeformed path — never a crash.
- Format v11 (stamp-only bump: older builds refuse a skinned file rather than draw it rigid).
  `sanitizeSkins.ts` drops a malformed spec (non-path object, bad matrices, ragged weights).

## Rendering

`skinnedPath(objects, obj, path, time, pose?)` (engine `skin.ts`) is the single deformation. It
plugs into the existing per-frame path seam, like a live boolean:

- runtime `computeFrame` emits the deformed `pathD` (Stage, HTML runtime, raster, SMIL sampling
  all read it); the Stage pose-drag preview deforms live through `posedObjects`.
- `renderDocument` writes frame 0's deformed path as the initial markup.
- SMIL export samples `d` per frame (same command skeleton every frame, so it interpolates).

v1 scope: skins in the active scene graph (root or a scene); inside a symbol a skin renders
undeformed. Hit-testing and selection bounds use the undeformed path.

## Editor (slice 2)

- **Bind to Bones** (command + Inspector button): selection = one path/rect/ellipse plus one or
  more bones (or a bone whose armature is used whole). Rects/ellipses are converted to paths.
  One undo step. **Unbind** removes the skin (drawing keeps its rest shape).
- Inspector "Skin" row on a skinned drawing: bone count, Unbind, Rebind (recompute weights at
  the current pose).
- Layers shows a "Skin" badge.

## Agents (slice 3)

- core `bindSkin(project, objectId, boneIds)` / `unbindSkin`.
- DSL: a path/rect/ellipse may carry `skin: ["boneId", …]`; compile binds after the armature is
  built (rest pose), decompile writes the bone list (weights are re-derived — rebinding at rest is
  deterministic).
- describe: `skin → bone1, bone2`. MCP `bind_skin` / `unbind_skin`. Template "Swaying tail".

## Also in slice 1

IK full-reach fix: at (or beyond) full reach the chain straightens first, then CCD refines (CCD
alone crawled and stopped a few px short of a straight arm).

## Testing

- Engine: matrices, densify keeps the shape, auto-weights (nearest bone dominates, rows sum to
  1), rest pose = identity deformation, a 90° bend moves far nodes 90° and blends at the joint,
  mismatch/missing bone falls back.
- Render parity: runtime `computeFrame` and `renderDocument` frame 0 agree; SMIL animates `d`.
- Store/e2e (slice 2), core/DSL/MCP (slice 3).

## Slices

1. Model, engine `skin.ts`, sanitizer + format v11, render seam (runtime, static export, SMIL via
   sampling, Stage preview), IK full-reach fix.
2. Editor UI.
3. Agent parity + template.

## Deferred

Weight painting; dual-quaternion skinning; skinning text/symbols/groups; skins inside symbols;
deformed hit-testing.
