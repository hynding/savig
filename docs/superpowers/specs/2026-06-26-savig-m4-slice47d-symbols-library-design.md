# Savig M4 — Nested Symbols 47d: Symbols Library Panel

**Date:** 2026-06-26
**Milestone:** M4 (grouping, layers & nested symbols)
**Status:** design — the last nested-symbols sub-slice (47a foundation + 47b transform UI +
47-edit edit-mode + 47c independent timelines are merged).

---

## 1. Motivation

Today a symbol can only be born from a selection (`createSymbol`) and instanced only by duplicating
an existing instance. There is no way to **browse** the symbols in a project, see how many times each
is used, **place a fresh instance** of one without an existing instance to copy, or **swap** an
instance to a different symbol. 47d adds that small library surface, completing the Flash-style
nested-symbols feature.

It also closes a latent gap: symbols are `Asset`s, so they already appear in the `AssetPanel`, but
clicking one currently falls through to `addAudioClip(symbolId)` (the panel's click handler only
distinguishes svg vs everything-else). 47d gives symbols a correct, first-class treatment.

## 2. The authoring-time cycle guard (guard #2)

A symbol may never (transitively) contain an instance of itself. 47a's render-time guard (the
per-path visited-asset `Set` in `flattenInstances`) prevents an infinite render even on a corrupt
file, but nothing stops the *authoring* actions from creating such a cycle. 47d adds the
authoring-time guard the spec reserved as "guard #2":

```ts
// engine/symbol.ts
/** Does `containerSymId` transitively contain an instance of `targetSymId`? Walks the container
 *  symbol's scene, recursing into nested symbol instances, cycle-guarded by a visited-asset Set.
 *  Used to reject placing/swapping an instance whose target would create a containment cycle. */
export function symbolContains(containerSymId: string, targetSymId: string, assets: Asset[]): boolean;
```

`symbolContains(Y, X)` is true when symbol Y already contains (at any depth) an instance of symbol X.
Placing or swapping creates a cycle exactly when the **containing scene's symbol** would become
reachable from the instance's new target.

## 3. Placement & swap semantics (active-scene aware)

The "containing scene" is the active scene (47-edit): the root (`editPath` empty) or a symbol asset
(`editPath`'s last entry, call it `C`). Both new actions route through the active scene via the
existing `commitActiveScene`, so they work at the root AND inside a symbol in edit mode.

### 3.1 `placeSymbolInstance(symId)`

Append a fresh instance of `symId` to the **active scene**:

- **Cycle guard:** if the active scene is a symbol `C` and (`symId === C` or `symbolContains(symId, C, assets)`),
  reject with a toast (`"Can't place <name> here — it would contain itself."`) and do nothing. At
  the root, `C` is null, so placement is always allowed.
- Create an instance `SceneObject` (`assetId = symId`) at the next z-order of the active scene,
  anchored at the symbol's **content centre** (`sceneContentAABB(symbol.objects, assets, time)`
  centre — mirrors `createSymbol`, so scale/rotate pivot is sensible). Base transform is identity.
- Commit via `commitActiveScene`; select the new instance. Undoable.

### 3.2 `swapSymbol(instanceId, newSymId)`

Repoint a selected instance at a different symbol, preserving its transform and `symbolTime`:

- Find the instance in the active scene; ignore if it isn't a symbol instance, or `newSymId` equals
  its current `assetId` (no-op).
- **Cycle guard:** with the containing-scene symbol `C` (active asset id, or null at root), reject
  with a toast if `C` and (`newSymId === C` or `symbolContains(newSymId, C, assets)`).
- Replace only the instance's `assetId` (`{ ...instance, assetId: newSymId }`) — its base/keyframes/
  `symbolTime`/anchor are kept (v1 does NOT recompute the anchor to the new content centre; the user
  can adjust). Commit via `commitActiveScene`. Undoable.

### 3.3 Instance count

```ts
// engine/symbol.ts
/** Total objects referencing `symId` across the root scene AND every symbol asset's objects[]. */
export function countSymbolInstances(symId: string, project: Project): number;
```

Pure, used by the library list to show a live usage count per symbol.

## 4. UI surface

### 4.1 AssetPanel — a "Symbols" section

`AssetPanel` gains a dedicated **Symbols** subsection (symbols are filtered OUT of the existing
generic asset list to avoid the broken click + double listing). Each row shows the symbol name and
its instance count (`countSymbolInstances`) and is a button that calls `placeSymbolInstance(sym.id)`.
A row that would create a cycle in the current active scene (`sym.id === activeAssetId` or
`symbolContains(sym.id, activeAssetId)`) is **disabled** (so the user sees why before clicking; the
store action also guards as a backstop). When there are no symbols, the section is omitted.

### 4.2 Inspector — "Swap symbol"

When a single symbol instance is selected, the Inspector's instance panel (next to the 47c "Symbol
timing" section) shows a **Swap symbol** `<select>` listing every *other* symbol; choosing one calls
`swapSymbol(instanceId, value)`. Cycle-creating targets are omitted from the options (and the store
guards as a backstop). Reuses `isSymbolInstance` for the gate.

## 5. What changes (surface)

- **engine/symbol.ts:** `symbolContains` + `countSymbolInstances` (pure, cycle-guarded).
- **store:** `placeSymbolInstance(symId)` + `swapSymbol(instanceId, newSymId)` (active-scene routed,
  cycle-guarded with toasts, undoable). Imports `sceneContentAABB`/`isSymbolInstance` (already from
  snapping) + the two engine helpers.
- **AssetPanel:** Symbols section (filter symbols out of the generic list; place buttons + counts +
  cycle-disabled rows).
- **Inspector:** Swap-symbol select on an instance.
- **new tests** + an e2e.

## 6. Parity, undo, edit-propagation

- **No engine-render change** (`flattenInstances`/`computeFrame`/`renderDocument` untouched) →
  preview==export parity intact. `symbolContains`/`countSymbolInstances` are pure read helpers.
- **Undo/persistence:** placement/swap mutate ordinary `SceneObject`/asset data via `commitActiveScene`
  → snapshotted by history, serialized normally.
- **Edit-propagation** is unchanged and free: a placed/swapped instance reads its `SymbolAsset.objects`
  like any instance.

## 7. Scope (this slice) vs deferred

**In 47d:** `symbolContains` + `countSymbolInstances`; `placeSymbolInstance` + `swapSymbol`
(active-scene, cycle-guarded, undoable); the AssetPanel Symbols section (list + count + click-to-place
+ cycle-disabled rows + fix the broken symbol click); the Inspector swap-symbol select; tests + e2e.

**Deferred:** rendered symbol **thumbnails** (needs a content render-snapshot); **drag-to-place** with
a drop point (v1 is click-to-place into the active scene); recomputing the instance anchor on swap;
rename/delete-symbol management in the library; a separate dockable library window (v1 lives in the
existing AssetPanel).

## 8. Risks / tradeoffs

- **Cycle guard correctness** is the one subtle piece: `symbolContains` must be transitive and
  cycle-guarded (a corrupt file could already contain a cycle; the walk must terminate). Tested
  directly and via place/swap rejection.
- **Active-scene awareness:** placement/swap go to the active scene; at the root the cycle guard is a
  no-op (root is not a symbol). Tested both at root and inside a symbol.
- **The "broken symbol click" fix** changes existing AssetPanel behaviour (symbols leave the generic
  list). Existing AssetPanel tests cover svg/audio; a new test covers the Symbols section.
- **Swap keeps the old anchor** (v1) — a swapped instance may pivot oddly until moved; acceptable and
  documented.

## 9. Testing strategy

- `engine/symbol.test.ts`: `symbolContains` — direct containment true; transitive (A→B→C) true;
  unrelated false; a self-referential/corrupt graph terminates (no infinite loop). `countSymbolInstances`
  — counts across root + symbol scenes; 0 when unused.
- `store.test.ts`: `placeSymbolInstance` appends an instance to the active scene (root and inside a
  symbol), selects it, undoable; rejects (no commit + toast) when it would cycle inside a symbol.
  `swapSymbol` changes only `assetId` preserving transform/`symbolTime`; no-op on same id; rejects a
  cycle-creating swap.
- `AssetPanel.test.tsx`: the Symbols section lists a symbol with its instance count and places an
  instance on click; a cycle-creating row is disabled in edit mode; existing svg/audio behaviour
  unchanged.
- `Inspector.test.tsx`: the Swap-symbol select shows for an instance and swaps on change.
- e2e: create two symbols, place a second instance of one from the library (count updates), swap an
  instance to the other symbol.
