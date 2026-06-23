# Savig M4 Slice 45e — Nested groups (group-in-group)

**Date:** 2026-06-22
**Status:** Approved (autonomous slice cycle — grouping polish; removes the one-level limit)
**Depends on:** 45a–45d (group containers, Layers tree, animatable groups).

## 1. Goal

Allow a group to contain another group, so you can organize complex scenes (e.g. group a
character's limb-parts, then group those into a character). Today grouping is ONE level:
`groupSelected` excludes groups, and `groupTransformPrefix` / `isRenderHidden` /
`resolveToEntity` / `groupAABB` only look at the immediate parent.

## 2. Why this is bounded

45a centralized the group composition. One-level grouping is assumed in exactly five shared
helpers; making each walk the parent CHAIN (or recurse) propagates nesting consistently to
preview, export, the visibility cascade, and the bbox handles — no per-render-site changes
(those already call the shared helpers).

## 3. The changes (chain-walking / recursion)

- **`groupTransformPrefix(project, obj, time)`** (engine; shared by `computeFrame` +
  `renderDocument`): walk up the parentId chain collecting each ancestor group's
  `buildTransform(sample(group, time))`; emit them OUTERMOST-first (SVG composes left→right,
  so the outermost ancestor's transform is leftmost). World = `GP ∘ P ∘ child`.
- **`isRenderHidden(obj, objectsById)`** (engine; shared by Stage `ordered` / `renderDocument`
  / marquee): hidden if `obj` OR ANY ancestor group is hidden (walk the chain; cycle-guard).
- **`resolveToEntity(objects, id)`** (store; used by click/marquee selection): resolve to the
  OUTERMOST ancestor group (clicking any descendant selects the top-level group, Figma-style;
  drilling into inner groups is the deferred enter-group work). One-level → unchanged.
- **`groupAABB(group, objects, assets, time)`** (snapping; used by the bbox handles +
  `groupSelected`): a child that `isGroup` contributes its own `groupAABB` (recurse), else
  `objectAABB`.
- **`groupSelected`** (store): drop the `!o.isGroup` exclusion so a selected TOP-LEVEL group
  can be wrapped in a new parent group (the `!o.parentId` exclusion stays — only top-level
  entities are grouped, so no cycle). The bbox-centre uses `groupAABB` for group members.
- **`ungroupSelected`** (store): the freed children REPARENT to the ungrouped group's parent
  (`group.parentId`, the grandparent — or root), not unconditionally to root, so ungrouping an
  inner group keeps the outer one intact. (`bakeGroupIntoChild` already bakes the immediate
  parent's transform into a child — including a child group — preserving world position.)
- **`LayersPanel`**: build the tree by RECURSION (a group's children may be groups), depth
  increments per level; collapse state per group; cycle-guard.

## 4. Scope (YAGNI)

**In:** create/select/transform/animate/ungroup NESTED groups; the Layers tree renders
arbitrary depth; visibility cascade + bbox + composition honor the full chain.

**Out (deferred):** double-click-to-enter an inner group (click always selects the outermost
group); drag-REPARENT; a cycle never arises via the UI (only top-level entities are grouped),
but the chain-walkers carry a defensive cycle-guard regardless.

**Editor + engine helpers only:** no data-model field change (`parentId`/`isGroup` already
support arbitrary depth); no persistence change.

## 5. Testing

- **Engine (`groupTransform.test.ts`):** `groupTransformPrefix` for a child two levels deep
  composes BOTH ancestors outermost-first; `isRenderHidden` true when a GRANDPARENT group is
  hidden.
- **Frame (`frame.test.ts`):** a child in an inner group in an outer group gets both prefixes
  in `computeFrame` (preview==export via the shared helper).
- **Snapping (`snapping.test.ts`):** `groupAABB` of an outer group unions a nested inner
  group's box (recursion).
- **Store (`store.test.ts`):** `groupSelected` of a top-level group + a top-level object
  creates an outer group whose children include the inner group (parentId set);
  `resolveToEntity` of a doubly-nested child returns the OUTERMOST group; `ungroupSelected` of
  the inner group reparents its children to the OUTER group (not root) preserving world pos.
- **Layers (`LayersPanel.test.tsx`):** a nested group renders its grandchildren at depth 2;
  collapsing the inner group hides only the grandchildren.
- **e2e (`nested-groups.spec.ts`):** group 2 rects (inner), then group that group with a 3rd
  rect (outer); the Layers tree shows depth 0/1/2; moving the OUTER group moves all three;
  clicking any member selects the outer group.

## 6. Risks

- **Composition order:** ancestors must be emitted outermost-first; a frame test for a
  two-level child pins it. Both `computeFrame` and `renderDocument` use the same
  `groupTransformPrefix` → parity holds.
- **Infinite recursion:** the UI can't create a cycle (only top-level entities are grouped),
  but `isRenderHidden`/`resolveToEntity`/`groupTransformPrefix`/the Layers walk carry a
  visited-set or depth guard defensively.
- **Ungroup reparenting:** the freed children must inherit `group.parentId` (grandparent), not
  root — covered by a store test.
