# Savig M4 Slice 45 — Group containers (grouping phase 2, foundation)

**Date:** 2026-06-22
**Status:** Approved (autonomous slice cycle — M4 STRUCTURAL HEADLINER; scope chosen by the user: "foundation, static group transform")
**Depends on:** Slices 36–44 (multi-object toolkit), esp. 40/41 (group-bbox handles), 42 (grouping phase 1, which this replaces)

## 1. Goal

Turn a group from a flat selection-tag (`groupId`, slice 42) into a real **container
object** with its OWN transform: select a group → one bounding box + handles → move /
scale / rotate the whole group as a unit, stored on the group (not baked into members).
The group transform is **static** (not keyframe-animatable yet — that is slice 45b). This
is the foundation for nested symbols and the Layers tree.

## 2. Core design — flatten at compute time (no DOM nesting)

A group is a `SceneObject` with `isGroup: true`, no asset (`assetId: ''`), its own `base`
Transform2D + absolute `anchorX/anchorY` (the group pivot = the children's bbox centre at
creation), and NO tracks (static). Its children reference it via the existing `parentId`.

Composition does NOT nest `<g>` elements. Instead the SHARED frame logic prepends the
parent group's transform string to each child's transform — SVG composes
`transform="<groupStr> <childStr>"` exactly, no matrix math:

- `computeFrame` (src/runtime/frame.ts — shared by the editor `applyFrame` AND the export
  runtime): SKIP group objects (no `FrameItem`, no DOM node); for a child with a parent
  group, set `transform = groupPrefix + ' ' + buildTransform(childState…)`.
- `renderDocument` (the export's static initial snapshot): same — skip groups; prepend the
  group prefix to each child.
- A shared helper `groupTransformPrefix(project, obj, time)` returns the parent group's
  `buildTransform` string (or `''`). One level only (a child's parent is never itself a
  group child in v1).

Because the group is static, the prefix is time-independent; the runtime never animates a
group (groups have no node and no tracks → unchanged runtime). The group is a purely
logical container — there is no group DOM element. (45b makes it animatable: `computeFrame`
already takes `time`, so the prefix becomes time-dependent and the group gains a node.)

## 3. Selection & handles

- The group has no DOM node, so you SELECT a group by clicking one of its members: a member
  click selects the GROUP object (the parent), not the member. (Editing an individual
  member = ungroup first; double-click-to-enter is deferred.)
- A selected group shows the group-bbox handles (REUSED from slices 40/41): an 8-handle
  scale box + a rotate handle, positioned on the group's bbox = the union of its children's
  AABBs transformed by the group transform. Dragging them writes the GROUP's **base**
  transform (static — NOT keyframes), via a new `setGroupTransform` store action. Dragging
  the bbox body moves the group (writes base x/y).
- Because move/scale/rotate all act on the group's own transform, there is NO regression
  vs slice 42 (which scaled/rotated members via the multi-transform).

## 4. Group / Ungroup

- **Group** (`groupSelected`): create a group object with an IDENTITY base transform and
  `anchorX/Y` = the selected objects' bbox centre; set each selected object's `parentId` to
  the group id; the group takes the max zOrder of the selection. Children keep their
  transforms (identity group ⇒ no visual change). Select the new group. ONE commit.
- **Ungroup** (`ungroupSelected`): for each child, BAKE the group's transform into the
  child's base so its world position is preserved, clear `parentId`, then remove the group
  object. Select the freed children. ONE commit.
  - Baking `G ∘ C`: exact for translate / uniform-scale / rotate (the common cases). A
    non-uniformly-scaled rotated group would need shear (not representable as a Transform2D)
    — documented v1 limitation (same family as slice-40's non-uniform-scale-of-rotated
    caveat). An identity/never-transformed group bakes to a no-op.

## 5. Replaces slice-42 `groupId`

`groupId` is removed. `groupSelected`/`ungroupSelected` are reworked to create/dissolve
containers. Selection-expansion becomes parent-based: a member click selects its group;
marquee/Layers selecting a member selects the group. `groupMatesOf`/`expandToGroups` →
parent-based equivalents (`groupChildrenOf(project, groupId)`; a member resolves to its
group). The Inspector Group/Ungroup buttons stay.

## 6. Scope (YAGNI)

**In:** group container object (`isGroup` + `parentId`); flatten-compose render/export/
runtime via the shared frame logic; Group/Ungroup; static group transform editing
(move/scale/rotate) via reused bbox handles → `setGroupTransform`; member-click selects the
group; persistence; replace `groupId`.

**Out (deferred → 45b/45c):** keyframe-ANIMATABLE group transform (needs the group to gain
a DOM node + runtime to animate it); a group row in the Layers tree + expand/collapse +
drag-reparent; double-click-to-enter-and-edit-a-member; NESTED groups (group inside group);
exact ungroup-bake of a sheared (non-uniform-scaled rotated) group.

## 7. Implementation surface

- `src/engine/types.ts`: `isGroup?: boolean` on SceneObject (drop `groupId`).
- `src/engine/project.ts`: `createGroupObject(...)` factory.
- `src/engine/groupTransform.ts` (new, pure): `groupTransformPrefix(project, obj, time)`;
  `bakeGroupIntoChild(groupState, groupAnchor, child)` for ungroup.
- `src/runtime/frame.ts` `computeFrame`: skip groups; prepend the parent prefix.
- `src/services/export/renderDocument.ts`: skip groups; prepend the parent prefix.
- `src/ui/store/store.ts`: rework `groupSelected`/`ungroupSelected`; `setGroupTransform`;
  parent-based selection helpers; member-click → select group.
- `src/ui/components/Stage/Stage.tsx`: render flat (children only; groups have no node);
  selected-group bbox + reused handles writing `setGroupTransform`; `onObjectPointerDown`
  selects the group.
- `src/ui/components/LayersPanel/LayersPanel.tsx`: a member row selects its group (groups
  themselves are not yet listed — deferred 45c).
- `src/services/persistence`: `isGroup`/`parentId` round-trip (additive, no migration).

## 8. Testing

- **Engine (`groupTransform.test.ts`):** `groupTransformPrefix` returns the group's
  buildTransform for a child, `''` for an ungrouped object; `bakeGroupIntoChild` composes a
  translate+rotate group exactly (world position preserved).
- **`frame.test.ts` / parity:** a child under a translated group gets a composed transform;
  the group itself produces NO FrameItem; editor `computeFrame` == the export
  `renderDocument` transform for the child (preview==export parity holds).
- **Store (`store.test.ts`):** `groupSelected` creates a group object (identity, anchor =
  bbox centre), sets children `parentId`, selects the group, one commit; `ungroupSelected`
  bakes a translated group into children (world x/y preserved), removes the group;
  `setGroupTransform` writes the group base (not tracks); member-click selects the group.
- **Stage (`Stage.test.tsx`):** clicking a member selects its group; a selected group shows
  the bbox handles; dragging a scale handle scales the group (children visually scale via
  the composed transform).
- **Persistence (`savig.test.ts`):** a group + children round-trips `isGroup`/`parentId`.
- **e2e (`group-container.spec.ts`):** draw 2 rects, group them, scale the group via a
  corner handle → both children scale together; ungroup → children keep their scaled world
  positions and are independently selectable.

## 9. Risks

- **Selection-model shift:** member-click now selects the group (not the member). Many
  call sites read `selectedObjectId`; verify single-object editors degrade gracefully when
  a GROUP (no asset) is the primary selection (the Inspector must not crash on a group).
- **`sampleProject`/`computeFrame` on a group:** a group has `assetId: ''`; the frame/
  render loops must skip it BEFORE any `assetsById.get` / shape resolution (else a missing-
  asset throw). Covered by the skip-groups change + tests.
- **Preview==export parity:** the prefix must be applied identically in `computeFrame` and
  `renderDocument`; the parity test guards this.
