# Savig M4 — Author Inside a Symbol, Phase 1: In-Symbol Delete + Cross-Scene Asset Prune

**Date:** 2026-06-26
**Milestone:** M4 (grouping, layers & nested symbols)
**Status:** design — the first "author inside a symbol" follow-up to 47-edit (symbol edit mode).
The nested-symbols headline arc (47a–47d) is complete; 47-edit deliberately routed only the
*transform* actions to the active scene, leaving structural authoring (delete/draw/group/clipboard)
to no-op safely. This slice routes **delete**.

---

## 1. Motivation

In symbol edit mode you can move, scale, rotate, and animate a symbol's internal parts, but you
**cannot delete one** — `deleteSelectedObject` reads the root `project.objects`, where an internal
id does not exist, so it no-ops. This slice makes delete work inside a symbol.

Doing it correctly forces a second, overdue fix. The engine's `removeObject` prunes a deleted
object's asset based on usage in `project.objects` **only** (the root scene). Now that symbols hold
their own `objects[]`, an asset shared between the root and a symbol scene is **wrongly pruned** when
its last *root* reference is deleted — silently breaking the symbol. Delete must prune assets by
usage **across all scenes**.

A third correct-behaviour call follows from the 47d library: deleting a symbol instance's last copy
currently prunes the `SymbolAsset` (so it vanishes from the library). Library symbols are reusable
definitions and should persist at zero instances (as in Flash). Delete must **never prune symbol
(or audio) assets**.

## 2. The cross-scene, symbol-preserving prune

The single new engine primitive is a reference collector:

```ts
// engine/removeObject.ts (or a small new module)
/** Every assetId referenced by an object across the WHOLE project — the root scene AND every
 *  SymbolAsset's objects[]. The basis for a cross-scene "is this asset still used?" check. */
export function collectReferencedAssetIds(project: Project): Set<string>;
```

The prune rule (applied to the *deleted objects' assets only*, in the store):

- An asset is a **prune candidate** iff it is the `assetId` of a deleted object.
- A candidate is **kept** when it is a `symbol` or `audio` asset (library defs / audio are never
  pruned by an object delete), OR when it is still referenced anywhere in the post-delete project
  (`collectReferencedAssetIds`).
- Only an **unreferenced `vector`/`svg`** candidate is pruned (matching today's "1:1 vector asset
  pruned; shared svg kept" intent, but now scene-aware).

This replaces `removeObject`'s root-only `objects.some(o => o.assetId === id)` check.

## 3. Scene-aware `deleteSelectedObject`

Rewrite the store action to target the **active scene** (root or a symbol in edit mode) via the
47-edit helpers, keeping the existing group-cascade:

1. `objects = selectActiveObjects(state)` (root `project.objects`, or the edited symbol's `objects`).
2. `ids` = the selected, non-locked ids present in `objects`.
3. **Cascade**: grow `toDelete` to include every descendant (`parentId` chain) within `objects`
   (recursively, as today), so deleting a group removes its whole subtree.
4. `nextObjects = objects.filter(o => !toDelete.has(o.id))`.
5. Build `nextProject`: the active scene's objects replaced by `nextObjects` — root
   (`{ ...project, objects: nextObjects }`) or the symbol asset
   (`assets.map(a => a.id === activeAssetId && a.kind === 'symbol' ? { ...a, objects: nextObjects } : a)`).
   (This mirrors `commitActiveScene`, but we also prune assets, so we build the project directly.)
6. **Prune** the deleted objects' candidate assets per §2 against `nextProject`.
7. Commit `nextProject`; clear selection. No-op (no commit) when nothing was removed.

Result: delete works identically at the root and inside a symbol; group-cascade is preserved;
assets are pruned correctly across scenes; library symbols persist.

## 4. Behaviour changes (all corrections, none regressions)

- **Edit-mode delete now works** (was a silent no-op).
- **Cross-scene shared assets are no longer wrongly pruned** — deleting a root object whose
  vector/svg asset is still used inside a symbol keeps the asset.
- **Library symbols persist at 0 instances** — deleting a symbol's last instance no longer drops the
  `SymbolAsset` from the library.
- Pure-root delete of a 1:1 vector or an unshared svg still prunes its asset (unchanged).

No existing test asserts the old (now-incorrect) cross-scene or symbol-prune behaviour, so these are
safe; new tests pin each.

## 5. UI

None. Delete is already reachable in edit mode via the **Delete key** (`useKeyboard` →
`deleteSelectedObject`) and the **Inspector "Delete" button** (the instance/object panel, which in
edit mode shows the selected internal object). Both now operate on the active scene through the
rewritten action.

## 6. Parity, undo, scope of the rewrite

- **No engine-render change** (`flattenInstances`/`computeFrame`/`renderDocument` untouched) →
  preview==export parity intact. `collectReferencedAssetIds` is a pure read helper.
- **Undo/persistence** unchanged: delete commits one whole-project snapshot.
- `removeObject` (root-only) becomes unused by the store but remains an exported, tested engine
  utility; its import is dropped from the store. (A later cleanup may remove it; out of scope here.)

## 7. Scope (this slice) vs deferred

**In:** `collectReferencedAssetIds`; the scene-aware, cross-scene-pruning, symbol-preserving
`deleteSelectedObject`; tests (engine + store) + an e2e (delete an internal part in edit mode → the
symbol updates everywhere; a shared asset survives; a symbol survives 0 instances).

**Deferred (later "author inside a symbol" slices):** in-symbol **draw** (rect/ellipse/polygon/star/
line/pen/brush — route the create actions + un-gate the tools), **node-edit**, **group/boolean**
inside, **clipboard** (copy/cut/paste) inside. Note: `cut()` calls `deleteSelectedObject`, so cutting
inside a symbol will now *delete* the internal object but the *copy* half still no-ops (clipboard
routing is a deferred slice) — a documented partial behaviour until clipboard lands.

## 8. Risks / tradeoffs

- **Behaviour change to root delete** (symbol-preserve + cross-scene prune). Mitigated: no test
  asserts the old behaviour; new tests pin the corrected behaviour; the changes are strictly safer
  (fewer wrongful prunes).
- **`cut` partial behaviour** inside a symbol (delete works, copy no-ops) — documented; full
  clipboard routing is a later slice.
- **Prune candidate set** is limited to the *deleted objects'* assets (not a global unreferenced
  sweep), keeping blast radius minimal and matching `removeObject`'s per-object intent.

## 9. Testing strategy

- `engine/removeObject.test.ts` (or new): `collectReferencedAssetIds` — collects from root + symbol
  scenes; an asset used only inside a symbol is included; a wholly-unused asset is absent.
- `store.test.ts`:
  - delete an internal object inside a symbol → the `SymbolAsset.objects` shrinks; both instances
    reflect it; undo restores.
  - delete a root object whose vector asset is ALSO used inside a symbol → the asset is **kept**.
  - delete the last instance of a symbol → the `SymbolAsset` is **kept** (library persists).
  - existing root delete (1:1 vector pruned; shared svg kept; group-cascade; bulk; locked-skip;
    no-op) stays green.
- e2e: in edit mode, select an internal part of a symbol with two instances, press Delete → both
  instances lose that part; the symbol still lists in the library.
