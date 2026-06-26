# Savig M4 — Author Inside a Symbol, Phase 6: In-Symbol Clipboard (copy/paste)

**Date:** 2026-06-26
**Milestone:** M4 (grouping, layers & nested symbols)
**Status:** design — the sixth "author inside a symbol" follow-up to 47-edit. Phases 1 (delete),
2 (draw), 3 (node-edit), 4 (paint), 5 (layers-mutators) are merged. This routes the object
clipboard — `copySelected` and `paste` — to the active scene, and adds the paste-time cycle guard.

---

## 1. Motivation

Inside a symbol, the object clipboard is half-broken:

- `cut` already DELETES (phase 1 routed `deleteSelectedObject`), but it calls `copySelected` first,
  and `copySelected` reads the ROOT `project.objects` — so an internal id is never found and the COPY
  half no-ops (cut deletes without snapshotting).
- `copySelected` / `paste` (Cmd/Ctrl+C / V, wired in `useKeyboard.ts` with NO edit-mode gate) resolve
  the root scene: copy finds nothing for internal ids; paste APPENDS to the root `project.objects`, so
  pasting "inside" a symbol silently dumps the objects into the root scene (invisible in the focused
  edit view, present at the root).

This slice makes copy/cut/paste operate on the symbol's internal scene in edit mode.

## 2. The seam, again (+ one new safety guard)

Same active-scene seam as phases 1–5, applied to the two clipboard actions, plus the paste-time
authoring cycle guard that `placeSymbolInstance`/`swapSymbol` already use (47d "cycle guard #2").

### 2.1 `copySelected`

Scope the object read to `selectActiveObjects(s)` instead of `project.objects`. Assets stay GLOBAL
(`project.assets` — a symbol's internals reference global assets, so the per-object asset lookup is
unchanged and correct).

| Before | After |
|--------|-------|
| `s.selectedObjectIds.map((id) => project.objects.find(...))` | `s.selectedObjectIds.map((id) => selectActiveObjects(s).find(...))` |

The clipboard payload is unchanged: `{ object: SceneObject; asset?: Asset }[]`, zOrder-sorted, the
keyframe clipboard cleared. The clipboard is scene-agnostic — it holds object + asset SNAPSHOTS, so it
already supports cross-scene and cross-project paste.

### 2.2 `paste`

Route the OBJECT append and the incremental zOrder to the active scene; assets stay GLOBAL (the
`clonedAsset` add for a vector, or the cross-project re-add of a shared/svg/symbol asset, are
unchanged). The per-entry loop's incremental zOrder must read the ACTIVE scene's CURRENT objects (so
multi-entry and repeated pastes stack without colliding), which means reading from the growing local
`project`, not the committed store — handled by a pure `sceneObjectsOf(project, activeAssetId)`.

Two new pure helpers (the read/write duals already implied by phase-2/3's `appendObjectToScene` and
`replaceObjectInScene`):

```ts
// READ side: the active scene's objects[] from any project + activeAssetId.
function sceneObjectsOf(project: Project, activeAssetId: string | null): SceneObject[] {
  if (!activeAssetId) return project.objects;
  const a = project.assets.find((x) => x.id === activeAssetId);
  return a && a.kind === 'symbol' ? a.objects : project.objects; // missing/non-symbol -> root
}

// WRITE side: append ONE object to the active scene (no asset add).
function appendToScene(project: Project, activeAssetId: string | null, obj: SceneObject): Project {
  if (!activeAssetId) return { ...project, objects: [...project.objects, obj] };
  return {
    ...project,
    assets: project.assets.map((a) =>
      a.id === activeAssetId && a.kind === 'symbol' ? { ...a, objects: [...a.objects, obj] } : a,
    ),
  };
}
```

`appendObjectToScene` (phase 2) is refactored to COMPOSE `appendToScene` (DRY), keeping its existing
behaviour byte-identical:

```ts
function appendObjectToScene(project, activeAssetId, asset, obj) {
  return appendToScene({ ...project, assets: [...project.assets, asset] }, activeAssetId, obj);
}
```

The paste loop then computes `zOrder = nextZOrder(sceneObjectsOf(project, activeAssetId))` and appends
`placed` via `appendToScene(project, activeAssetId, placed)`; the asset-add lines (clonedAsset /
re-add) are untouched and still write the GLOBAL `project.assets`.

### 2.3 Paste-time cycle guard

Pasting a symbol INSTANCE (an object whose `assetId` points at a `SymbolAsset`) INTO a symbol can
author a cycle — exactly the corruption `placeSymbolInstance`/`swapSymbol` reject. When in edit mode
(`containing = selectActiveAssetId(s)` is non-null), an entry is CYCLIC if the entry's object is an
instance and `entry.object.assetId === containing || symbolContains(entry.object.assetId, containing,
project.assets)`. SKIP cyclic entries; if any were skipped, push one error toast (mirroring
placeSymbolInstance's copy). Non-instance entries (vector/svg/group; a group's `assetId` is `''`) are
never cyclic — `isSymbolInstance` is false — so they always paste. At the ROOT (`containing` null) no
entry is cyclic (the root can't be contained), so paste is unchanged.

Skipping per-entry (rather than rejecting the whole paste) keeps the safe entries usable and matches
the forgiving spirit of the existing guards; a stale cyclic entry is simply dropped with a toast.

## 3. `cut`, edit-propagation, parity, undo

- **`cut`** needs NO change: it is `copySelected()` + `deleteSelectedObject()`, both now scene-aware,
  so cut inside a symbol both snapshots and removes.
- **Edit-propagation** is automatic: a paste into a symbol's `objects[]` is rendered by every instance
  via `flattenInstances`.
- **Parity (preview == export)** is untouched — no engine-render change. (`sceneObjectsOf`/
  `appendToScene` are pure store helpers.)
- **Undo/persistence** unchanged: paste is one whole-project commit; the clipboard is transient store
  state (already survives `newProject` for cross-project paste, unchanged).
- **No UI/keyboard change:** `useKeyboard.ts` already calls `copySelected`/`cut`/`paste` with no
  edit-mode gate; they simply start working inside a symbol.

## 4. Scope (this slice) vs deferred

**In:** route `copySelected` + `paste` to the active scene; the paste-time cycle guard; the two pure
helpers + `appendObjectToScene` refactor; tests (store + e2e). `cut` works transitively (no code
change).

**Deferred (remaining author-in-symbol phases):** group/boolean inside (route `groupSelected`/
`ungroupSelected`/`booleanOp`), motion paths inside, advanced morph fine-tuning (per-node easing /
correspondence).

## 5. Risks / tradeoffs

- **Cross-scene paste is now a feature, not a bug:** copy a part inside symbol A, exit, paste at the
  root (or inside symbol B) → the object lands in the target scene, its asset cloned/re-added globally.
  This is desirable (move geometry between scenes) and falls out of the scene-agnostic clipboard; it is
  only gated by the cycle guard (§2.3).
- **Cycle guard completeness:** checking each entry's own `assetId` against the DEEPEST active symbol
  suffices — `editPath` is built by `enterSymbol` so ancestors transitively reach the deepest symbol,
  and `symbolContains` is fully transitive (the same reasoning 47d's reviewer confirmed for
  placeSymbolInstance). A group entry pasted into a symbol carries no children in the clipboard (only
  separately-copied child instances, each its own guarded entry), so no group-mediated cycle escapes.
- **Root behaviour byte-unchanged:** `sceneObjectsOf(p, null) === p.objects`,
  `appendToScene(p, null, o) === { ...p, objects: [...p.objects, o] }`, and `appendObjectToScene` is
  byte-identical after the refactor.

## 6. Testing strategy

- `store.test.ts` (objects inside a symbol, in edit mode):
  - copy + paste an internal part inside a symbol → the symbol's `objects[]` gains a clone (root
    `objects` untouched); both instances reflect the added part.
  - `cut` an internal part inside a symbol → the part is removed from the symbol AND the clipboard is
    populated (a subsequent paste re-adds it).
  - cross-scene paste: copy an internal part inside a symbol, `exitSymbol`, paste → the clone lands in
    the ROOT objects (not the symbol).
  - cycle guard: copy a root instance of symbol S, `enterSymbol('S')`, paste → no object added to
    S.objects and an error toast is pushed.
  - root copy/paste unchanged (a regression check: paste at root still appends to `project.objects`).
- e2e: create a symbol (one part) with two instances, enter it, select the internal part, Ctrl+C /
  Ctrl+V → the symbol gains a second part, so each of the two instances renders two leaves (4 total);
  exit.
