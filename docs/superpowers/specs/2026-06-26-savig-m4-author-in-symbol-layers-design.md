# Savig M4 — Author Inside a Symbol, Phase 5: In-Symbol Layers Mutators

**Date:** 2026-06-26
**Milestone:** M4 (grouping, layers & nested symbols)
**Status:** design — the fifth "author inside a symbol" follow-up to 47-edit. Phases 1 (delete),
2 (draw), 3 (node-edit), 4 (paint) are merged. This routes the Layers-panel mutators (visibility,
lock, rename, reorder, drag-reorder, drag-reparent) to the active scene.

---

## 1. Motivation

The Layers panel already **shows** the active scene in edit mode (47-edit scoped its reads), but its
row controls — the eye/lock toggles, inline rename, and drag-reorder/reparent — resolve the object
from the root `project.objects`, so inside a symbol they find nothing and no-op. This slice makes
those Layers actions edit a symbol's internal hierarchy.

## 2. The seam, again

All six actions reuse phase-3's `replaceObjectInScene(project, activeAssetId, next)` (single-object
writes) or 47-edit's `commitActiveScene(nextObjects)` (whole-array writes). Each change is the same
two-part transform used by phases 3–4:

- **Resolve / read** the scene via `selectActiveObjects(s)` instead of `project.objects`.
- **Write** the object via `replaceObjectInScene(project, selectActiveAssetId(s), next)`, or the
  reordered/reparented array via `commitActiveScene(nextObjects)`.

| Action | Change |
|--------|--------|
| `toggleObjectVisibility(id)` | resolve via `selectActiveObjects`; write `replaceObjectInScene(project, selectActiveAssetId(s), { ...obj, hidden })` |
| `toggleObjectLock(id)` | same (the post-lock selection-drop is unchanged) |
| `renameObject(id, name)` | resolve via `selectActiveObjects`; write `replaceObjectInScene(…)` |
| `reorderSelected(op)` | `reorderObjects(selectActiveObjects(s), id, op)` → `commitActiveScene(objects)` |
| `moveObjectToTarget(draggedId, targetId)` | `moveObjectToTargetPure(selectActiveObjects(s), …)` → `commitActiveScene(objects)` |
| `reparentObject(id, newParentId)` | change the function's local `const objs = project.objects` → `selectActiveObjects(s)` (all reads/walks/bake math use `objs`); final write `replaceObjectInScene(project, selectActiveAssetId(s), cur)` |

`reparentObject` reads the scene through a single local `objs`, so re-pointing it at the active scene
routes its entire cycle-guard + bake-out/unbake-in math (world-position preserving, like slice 45f);
the bake helpers read global assets, which are unchanged. `reorderObjects`/`moveObjectToTargetPure`
are pure functions over an `objects[]` array, so passing the active scene's array is sufficient.

## 3. Edit-propagation, parity, undo

- **Edit-propagation** is automatic: a visibility/lock/rename/reorder/reparent edit changes the
  symbol's `objects[]`, which every instance reads via `flattenInstances`.
- **Parity (preview == export)** is untouched: no engine-render change. (`hidden` already drives
  `isRenderHidden` in `flattenInstances`, so hiding an internal part hides it in every instance and
  the export.)
- **Undo/persistence** unchanged: each edit is one whole-project commit.
- **No UI change:** the Layers panel already renders the active scene's rows (47-edit) and calls
  these actions; they simply start working inside a symbol.

## 4. Scope (this slice) vs deferred

**In:** route `toggleObjectVisibility`, `toggleObjectLock`, `renameObject`, `reorderSelected`,
`moveObjectToTarget`, `reparentObject` to the active scene; tests (store + e2e).

**Deferred (remaining author-in-symbol phases):** clipboard (copy/paste; `cut` already deletes),
group/boolean inside, motion paths inside, advanced morph fine-tuning (per-node easing /
correspondence).

## 5. Risks / tradeoffs

- **`reparentObject` reach:** in-symbol grouping isn't routed yet, but a symbol can already CONTAIN a
  group (created via `createSymbol` of a grouped selection), so dropping a row into that group inside
  a symbol is reachable; the routed bake math handles it (tested).
- **Root behaviour byte-unchanged:** at the root `selectActiveObjects(s)` === `project.objects`,
  `replaceObjectInScene(p, null, x)` === `replaceObject(p, x)`, and `commitActiveScene(objs)` ===
  `commit({ ...project, objects: objs })`.
- **toggleObjectLock selection-drop** still operates on `selectedObjectIds` (scene-local ids) —
  unchanged and correct.

## 6. Testing strategy

- `store.test.ts` (objects inside a symbol, in edit mode):
  - `toggleObjectVisibility(internalId)` → the symbol object's `hidden` toggles (not root).
  - `toggleObjectLock(internalId)` → the symbol object's `locked` toggles; the id drops from selection.
  - `renameObject(internalId, 'X')` → the symbol object's `name` updates.
  - `reorderSelected('front')` on an internal object → the symbol's `objects[]` zOrder reordered.
  - `reparentObject(internalChildId, internalGroupId)` (a symbol containing a group + a sibling) →
    the symbol child's `parentId` set; both instances reflect the structure.
  - all instances reflect each change; undo restores; at the root every action is unchanged.
- e2e: create a symbol (two parts) with two instances, enter it, toggle one internal part's
  visibility off via the Layers panel → that part disappears from every instance; exit.
