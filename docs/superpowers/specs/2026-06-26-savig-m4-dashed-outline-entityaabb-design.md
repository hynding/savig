# Savig M4 — Per-Object Dashed Selection-Outline Spans Groups & Instances (47b polish)

**Date:** 2026-06-26
**Milestone:** M4 (grouping, layers & nested symbols)
**Status:** design — the follow-up the multi-select-bounds review surfaced.

---

## 1. Motivation

In a multi-selection, Stage draws a thin dashed rectangle per selected object so the whole set is
visible (`data-testid="selection-outline-{id}"`). That rect is computed with `objectAABB`, which
returns `null` for a symbol INSTANCE (asset kind `symbol`) and a GROUP container (no `assetId`) — the
same gap the just-merged `multiSelectionAABB` slice fixed for the OUTER group-bounds box. So today, in
a multi-selection containing a group or an instance, those members get **no individual dashed
outline** (only the outer group-bounds rectangle), making the selection set ambiguous.

This is the explicit pre-existing follow-up logged in that slice's review.

## 2. Approach

Route the per-object dashed outline through the existing `entityAABB` dispatcher (group→`groupAABB`,
instance→`instanceAABB`, plain→`objectAABB`) — exactly as the outer box now does. One-line change in
`Stage.tsx`:

```ts
// before
const a = o && !o.hidden ? objectAABB(o, assetsById.get(o.assetId), time) : null;
// after
const a = o && !o.hidden ? entityAABB(o, project.objects, project.assets, time) : null;
```

`entityAABB` is already imported in Stage.tsx (the single-select bounds and `multiSelectionAABB` use
it). `project` here is the edit-scoped project (`selectEditProject`), so `project.objects` is the
active scene — correct for `groupAABB`'s child-walk both at root and inside a symbol; `project.assets`
is the global asset list. For a plain vector/svg object `entityAABB` falls through to `objectAABB`, so
those outlines are byte-identical to today.

## 3. Scope

**In:** the one-line `objectAABB`→`entityAABB` swap for the per-object dashed outline; a Stage test
asserting a group/instance member of a multi-selection now renders its outline.

**Out / unchanged:**
- The outer `groupBounds` box (already correct via `multiSelectionAABB`), handles, snapping, drag.
- The `!o.hidden` guard, the locked-member drag-offset logic (`off`), and the rect attributes — all
  unchanged.
- Engine/store/render — untouched (editor chrome only).

## 4. Parity & regression-safety

- **Parity:** editor-only selection chrome; never touches `flattenInstances`/`computeFrame`/
  `renderSvgDocument` → preview==export untouched.
- **Regression-safe:** for plain vector/svg members `entityAABB ≡ objectAABB`, so their outlines are
  byte-identical; only group/instance members gain an outline that was previously absent.

## 5. Testing strategy

`Stage.test.tsx` (mirror the existing multi-select-outline test ~line 866 + the instance-handles test
~line 1251): a project with a plain rect AND a symbol instance, both selected. Assert
`selection-outline-{instanceId}` is now in the document (it would be absent under `objectAABB`). A
group member can be covered the same way if a group fixture is convenient; the instance case is the
core regression.
