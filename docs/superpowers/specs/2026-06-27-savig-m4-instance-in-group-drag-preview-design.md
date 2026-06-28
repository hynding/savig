# Instance-in-Group Drag Preview — Design

**Date:** 2026-06-27
**Status:** Approved (pending spec review)
**Area:** Savig M4 — grouping / instance polish

## Problem

Dragging a GROUP (move / scale / rotate via its bbox handles) live-previews its children
by mutating their DOM nodes. `previewGroupChildren` (Stage.tsx) does this with a
**transform-string prefix**: for each direct child it sets
`transform = ${groupPrefix} ${childTransform}` — but only for children that **have a DOM
node**. A symbol **instance** child has no node of its own (it renders as flattened
`instanceId/…` leaves), and a **nested group** child has no node either, so both are
silently skipped (`if (!node) continue`). Result: dragging a group that contains an
instance (or a nested group) leaves those parts **frozen** until pointer-up commit, while
leaf children follow correctly. The commit itself is correct (it updates the group's own
transform and children inherit via the parent chain); only the live preview is wrong.

## Goal

A group drag previews its ENTIRE subtree — leaf children, instance children, and nested
groups — matching the committed result, across all three group drags (move, scale,
rotate).

### Non-goals (v1)

- No change to the commit path (`setObjectsTransforms`) — it is already correct.
- No preview-performance optimization beyond what the instance preview already accepts.

## Architecture

`previewInstanceChildren` already solves the no-DOM-node case via a **recompute-frame**
model: build a project where the container carries its in-progress transform as a static
base, run the shared `computeFrame`, and apply only that container's own leaves. The fix
converges the group preview onto the same model — which, because `computeFrame` is
parent-chain-aware, handles leaves, instances, AND nested groups uniformly and matches the
commit by construction.

### Shared core: `previewSubtree`

Extract the common skeleton of the instance/group previews into one Stage-local helper:

```
previewSubtree(proj, containerId, base: Transform2D, time, ownRenderId: (id: string) => boolean):
  const container   = proj.objects.find(o => o.id === containerId)
  const previewObj  = { ...container, base, tracks: {} }   // tracks stripped → samples to `base`
  const previewProj = { ...proj, objects: proj.objects.map(o => o.id === containerId ? previewObj : o) }
  const frame = computeFrame(previewProj, time).filter(it => ownRenderId(it.objectId))
  applyFrameToNodes(nodes, frame)
```

`computeFrame(project, time): FrameItem[]` and
`applyFrameToNodes(nodes: Map<string, Element>, items: FrameItem[])` are the existing
shared runtime functions (`src/runtime/frame.ts`); `FrameItem.objectId` is the renderId
(a plain object id for a leaf, or composite `instanceId/internalPath` for an instance leaf).

### The two wrappers

- **`previewInstanceChildren(proj, instance, time, base)`** →
  `previewSubtree(proj, instance.id, base, time, id => id.startsWith(`${instance.id}/`))`.
  Behavior unchanged (an instance renders only as `instanceId/…` leaves).

- **`previewGroupChildren(proj, group, time, base)`** (signature changes from
  `(proj, groupId, time, prefixString)`) →
  ```
  const descendants = groupDescendantIds(proj.objects, group.id)
  previewSubtree(proj, group.id, base, time, id => descendants.has(id.split('/')[0]))
  ```

### Subtree filter (the correctness crux)

A `computeFrame` item's `objectId` split at the first `/` always yields the
`proj.objects`-level object that produced it: a leaf child → its own id; an instance child
→ the instance id; a nested group's leaf → that leaf's id. Each of those is in the dragged
group's subtree exactly when it's a descendant. So the filter
`descendants.has(id.split('/')[0])` selects precisely the group's own leaves — which also
makes a **mixed multi-select drag safe**: only the group's leaves are applied, never a
sibling's in-progress preview (the same guarantee the instance filter gives via
`startsWith`).

### Pure engine helper: `groupDescendantIds`

Add to `src/engine/groupTransform.ts` (where `parentGroupOf` lives), so the membership
logic is unit-testable without the DOM:

```ts
/** Every object whose parentId chain reaches `groupId` (leaves, instances, nested groups
 *  and their descendants). Excludes the group itself. Cycle-guarded. */
export function groupDescendantIds(objects: SceneObject[], groupId: string): Set<string> {
  const out = new Set<string>();
  const childrenOf = (pid: string) => objects.filter((o) => o.parentId === pid);
  const walk = (pid: string) => {
    for (const c of childrenOf(pid)) {
      if (out.has(c.id)) continue; // cycle guard
      out.add(c.id);
      walk(c.id);
    }
  };
  walk(groupId);
  return out;
}
```

### Call sites

The three group-drag handlers each already build the instance `base` right beside the
group call; the group call now takes that same `Transform2D` base instead of the `xf`
string (the group and instance branches become symmetric):

- **Scale** (Stage.tsx ~973): `previewGroupChildren(proj, obj, time, { x: nx, y: ny, scaleX: it.osx*sx, scaleY: it.osy*sy, rotation: sampled.rotation, opacity: sampled.opacity })`
- **Rotate** (Stage.tsx ~1011): `previewGroupChildren(proj, obj, time, { x: nx, y: ny, scaleX: sampled.scaleX, scaleY: sampled.scaleY, rotation: it.orot + theta, opacity: sampled.opacity })`
- **Move** (Stage.tsx ~1430): `previewGroupChildren(proj, obj, time, { x: nx, y: ny, scaleX: sampled.scaleX, scaleY: sampled.scaleY, rotation: sampled.rotation, opacity: sampled.opacity })`

(Each mirrors the `previewInstanceChildren` call immediately below it.)

## Edge cases

- **Leaf-only group:** recompute-frame applies the same leaf positions the string-prefix
  did — parity (tested).
- **Nested group / instance-in-group:** resolved by `computeFrame`'s parent-chain walk
  (the fix + free nesting).
- **Empty group:** filtered frame is empty → no-op.
- **Mixed multi-select (group + other objects):** the subtree filter applies only the
  group's own leaves; siblings' previews are untouched.
- **Locked/hidden descendants:** `computeFrame` already omits render-hidden leaves, so the
  preview matches the rendered output.

## Files touched

- `src/engine/groupTransform.ts` — new `groupDescendantIds(objects, groupId)`.
- `src/engine/groupTransform.test.ts` (exists) — unit tests for `groupDescendantIds`.
- `src/ui/components/Stage/Stage.tsx` — new `previewSubtree`; rewrite `previewGroupChildren`
  to recompute-frame; refactor `previewInstanceChildren` onto `previewSubtree`; update the
  three call sites to pass a `Transform2D` base.
- `src/ui/components/Stage/Stage.test.tsx` — RTL: group-with-instance preview, leaf-only
  parity, nested-group preview.

## Testing

- **Unit (`groupDescendantIds`):** a group with a leaf child, an instance child, and a
  nested group (with its own leaf) → the set contains all four descendant ids and not the
  group itself; a cyclic `parentId` chain terminates.
- **RTL (Stage, mirroring the existing `previewInstanceChildren` test ~Stage.test.tsx:1392):**
  - Dragging a group that contains an instance repaints the instance's leaf node to the
    dragged position mid-drag (the regression — fails before, passes after).
  - A leaf-only group still previews its leaf mid-drag (parity).
  - A nested group inside the dragged group previews its leaf (free nesting).

## Open risks (accepted for v1)

- Per-move frame recompute for a group is heavier than string concatenation — the
  already-accepted cost of the instance preview; no optimization in v1.
- `groupDescendantIds` is O(objects × depth) via repeated `filter`; fine at editor scene
  scale (a future index is YAGNI).
