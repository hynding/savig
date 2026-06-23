# Savig M4 Slice 45f — Drag-reparent in the Layers tree

**Date:** 2026-06-22
**Status:** Approved (autonomous slice cycle — completes grouping membership editing)
**Depends on:** 45a–45e (group containers, Layers tree, nested groups).

## 1. Goal

Restructure group membership by dragging in the Layers panel: drop an object onto a group
row to add it to that group; drop it onto a top-level row to remove it to root — preserving
its on-screen (world) position. Today (45c) Layers drag is reorder-only and restricted to
top-level rows; you can only change membership by ungroup + regroup.

## 2. Core — reparent = bake-out + unbake-in (reuse the bake machinery)

Removing an object from a group is exactly `bakeGroupIntoChild` (bake the group's transform
into the child, world position preserved — already exists). Adding it is the INVERSE:
`unbakeGroupFromChild` maps the child's anchor through `G⁻¹` (a new pure helper). A move
across nesting levels = bake out the WHOLE old ancestor chain to world space, then unbake
into the WHOLE new chain — applying the one-level helpers iteratively:

```
reparentObject(id, newParentId | null):
  resolve the child's absolute anchor (ax, ay)   // resolveObjectAnchor, like ungroup
  cur = the object
  for each OLD ancestor group (immediate → outermost): cur = bakeGroupIntoChild(g, cur, ax, ay)   // → world space
  for each NEW ancestor group (outermost → immediate): cur = unbakeGroupFromChild(g, cur, ax, ay) // → new local space
  commit(replace the object with cur)             // parentId ends == newParentId
```

`unbakeGroupFromChild` round-trips with `bakeGroupIntoChild` (`unbake(bake(x)) == x`) — exact
for translate/uniform-scale/rotate (same shear caveat as bake). The bake samples the group at
t=0 (so an ANIMATED group's t≠0 transform isn't accounted — documented v1 limit, same as
ungroup).

## 3. Reparent rules / guards (store)

- **No cycle:** reject if `newParentId` is the object itself or any DESCENDANT of the object
  (walk up `newParentId`'s chain; if the object is found, no-op). Also reject if `newParentId`
  is not an `isGroup`.
- **No-op:** if `newParentId` equals the object's current `parentId`, do nothing (a same-group
  reorder stays the existing `moveObjectToTarget` path).
- **Locked:** a locked object can't be dragged (the Layers row gate), so reparent isn't reached.

## 4. Layers DnD (UI)

- Re-enable dragging for ALL rows (45c restricted to depth 0). A row is a drop target.
- On drop of `dragged` onto `target`:
  - `target.isGroup` → `reparentObject(dragged, target.id)` (into the group).
  - else (a leaf row) → if same parent as `dragged`, `moveObjectToTarget` (reorder, existing);
    else `reparentObject(dragged, target.parentId ?? null)` (join the target's parent / root).
- The drop highlight (`dropTargetId`) is reused. The dragged object lands at the end of the new
  parent's child order (precise drop-index reorder is deferred).

## 5. Scope (YAGNI)

**In:** drag-reparent an object into/out of/between groups (any nesting depth, via the chain
bake/unbake), preserving world position; the `unbakeGroupFromChild` helper; cycle/no-op
guards; the Layers DnD.

**Out (deferred):** precise drop-INDEX (reorder position) while reparenting (the moved object
appends to the new parent); reparenting a GROUP into a deep position is supported but a
multi-level chain with non-uniform-scaled rotated ancestors is approximate (shear, same as
bake); a drop "between rows" insertion indicator.

**Editor + one engine helper:** no data-model/persistence change (`parentId` already supports
this).

## 6. Testing

- **Engine (`groupTransform.test.ts`):** `unbakeGroupFromChild` round-trips
  `bakeGroupIntoChild` for translate, uniform-scale, and rotate groups (`unbake(bake(child))`
  ≈ child); a child unbaked into a translated group then composed (`groupTransformPrefix`)
  renders at its original world position.
- **Store (`store.test.ts`):** `reparentObject(topLevelObj, group)` sets `parentId=group` and
  adjusts base so the object's WORLD position (via `groupTransformPrefix`) is unchanged;
  `reparentObject(child, null)` removes to root preserving world position; a cycle
  (`reparentObject(group, descendant)`) is a no-op; same-parent is a no-op; a NESTED reparent
  (object from one group to a sibling group) preserves world position.
- **Layers (`LayersPanel.test.tsx`):** dropping a top-level object's row onto a group row
  reparents it (it appears nested under the group); dropping a child row onto a top-level
  non-group row removes it to root.
- **e2e (`drag-reparent.spec.ts`):** draw 3 rects; group 2 (A,B); drag C's Layers row onto the
  group row → C nests under the group and (moving the group) C moves with it; drag A's row out
  onto a top-level row → A leaves the group (clicking A selects only A).

## 7. Risks

- **World-position preservation:** the bake/unbake round-trip must be exact for the common
  cases — a round-trip engine test + a store test asserting the composed world position pin it.
- **Cycle:** reparenting a group into its own descendant must be rejected (guard + test).
- **DnD ambiguity (reorder vs reparent):** scoped — drop onto a group = reparent; drop onto a
  same-parent leaf = reorder; drop onto a different-parent leaf = reparent to that parent.
