# Savig M4 — Symbol Library Rename & Delete (47d polish)

**Date:** 2026-06-26
**Milestone:** M4 (grouping, layers & nested symbols)
**Status:** design — the second slice47d-polish item (thumbnails shipped). Adds rename + delete-symbol
management to the AssetPanel "Symbols" library section.

---

## 1. Motivation

The library lists each symbol as a place-on-click row with a thumbnail and `Name (count)`, but a symbol
cannot be RENAMED (every symbol is `Symbol`, `Symbol 2`, …) or DELETED (an unused symbol lingers
forever). This slice adds inline rename and a guarded delete, so the library can be kept tidy.

## 2. Architecture

### 2.1 Store actions (undoable)

**`renameAsset(assetId: string, name: string)`** — the asset analogue of `renameObject`. Find the asset;
trim `name`; an empty/whitespace name keeps the old one (no-op); otherwise update the asset's `name` and
commit. Generic over any asset; wired to symbols in this slice.

**`deleteSymbol(symId: string)`** — delete a library symbol, guarded:

1. Resolve the asset; return if it is not a `symbol`.
2. **In-use guard:** `countSymbolInstances(symId, project)` counts instances across the root scene AND
   every symbol's `objects[]`. If `> 0`, push an error toast (`Can't delete "{name}" — it has N
   instance(s).`) and return. A symbol is deletable only at **0 instances** — matching the established
   "a library symbol persists at 0 instances" model (author-in-symbol phase 1), and transitively
   covering "currently being edited" (being inside a symbol via `editPath` implies an instance reaches
   it, so its count is `> 0`).
3. At 0 instances: remove the symbol asset from `project.assets`, then **cross-scene prune** the
   now-orphaned internal vector/svg assets — `collectReferencedAssetIds(postDeleteProject)` and drop any
   `vector`/`svg` asset no longer referenced anywhere (keep `symbol`/`audio`), exactly the predicate
   author-in-symbol delete and boolean use. Commit.

Both actions are whole-project commits (undoable). No engine-render change — `deleteSymbol` only edits
the asset array; an unused symbol has no leaves in `flattenInstances`, so preview/export are unaffected.

### 2.2 AssetPanel symbol-row restructure

Each symbol row becomes a `<div className={symbolRow}>` containing sibling controls (no nested
interactive elements), mirroring the Layers panel's `editingId` inline-rename:

```tsx
<div className={styles.symbolRow} key={sym.id}>
  {editingId === sym.id ? (
    <input
      data-testid={`symbol-rename-${sym.id}`}
      defaultValue={sym.name}
      autoFocus
      onBlur={(e) => finishRename(sym.id, e.currentTarget.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') cancelRename(); }}
    />
  ) : (
    <button
      className={styles.item}
      data-testid={`symbol-${sym.id}`}
      disabled={cyclic}
      title={cyclic ? 'Would create a containment cycle' : 'Place an instance'}
      onClick={() => placeSymbolInstance(sym.id)}
    >
      <SymbolThumbnail symbol={sym} assets={assets} meta={meta} />
      <span>{sym.name} ({countSymbolInstances(sym.id, { objects, assets })})</span>
    </button>
  )}
  <button data-testid={`symbol-rename-btn-${sym.id}`} aria-label={`Rename ${sym.name}`} onClick={() => setEditingId(sym.id)}>✎</button>
  <button data-testid={`symbol-delete-${sym.id}`} aria-label={`Delete ${sym.name}`} onClick={() => deleteSymbol(sym.id)}>×</button>
</div>
```

- The place `<button>` keeps its `data-testid` / click-to-place / cyclic-disabled behaviour (existing
  tests unaffected).
- Rename uses local `editingId` + an uncontrolled `<input>` (the Layers approach): commit on
  Enter/blur via `renameAsset`, cancel on Escape.
- Delete calls `deleteSymbol`; the in-use toast comes from the store action.

## 3. Parity, undo, safety

- **Parity (preview == export)** is untouched — no engine/render change; both actions edit asset
  metadata / the asset array; a deleted (0-instance) symbol had no rendered leaves.
- **Undo** restores a renamed/deleted symbol (whole-project commit).
- **In-use safety:** delete is blocked whenever any instance references the symbol (root or nested), so
  deletion can never orphan an instance or break a containing symbol.

## 4. Scope (this slice) vs deferred

**In:** `renameAsset`, `deleteSymbol`; the AssetPanel symbol-row rename/delete UI; tests (store + RTL +
e2e).

**Deferred (separate 47d slices):** drag-to-place an instance from the library with a drop point;
recompute the instance anchor on `swapSymbol`; rename/delete for NON-symbol assets (svg/audio).

## 5. Risks / tradeoffs

- **Row restructure** changes the symbol row from a bare `<button>` to a `<div>` wrapper with sibling
  controls; the place button keeps its `data-testid`, so the existing place/cycle tests still pass.
- **Delete-while-editing:** the in-use guard already blocks it (editing a symbol implies an instance
  reaches it → count `> 0`), so no separate `editPath` guard is needed; if a future path allows editing
  a 0-instance symbol, add an `editPath.includes(symId)` guard.
- **Prune scope:** only the deleted symbol's now-unreferenced `vector`/`svg` internal assets are pruned;
  nested library symbols and audio are kept, consistent with every other prune.

## 6. Testing strategy

- `store.test.ts`:
  - `renameAsset(symId, 'Hero')` → the symbol asset's `name` is `'Hero'`; an empty name keeps the old.
  - `deleteSymbol` on a symbol with `0` instances → the symbol asset is removed; a vector asset used
    ONLY by that symbol is pruned; a vector asset also used at root is KEPT.
  - `deleteSymbol` on a symbol WITH instances → no removal, an error toast is pushed.
  - undo restores a deleted symbol.
- RTL (`AssetPanel.test.tsx`): the symbol row shows a rename button and a delete button; clicking rename
  reveals an input and submitting it calls `renameAsset` (the row label updates); clicking delete on a
  0-instance symbol removes the row; on an in-use symbol the row remains and a toast appears.
- e2e (`symbols.spec.ts`): create a symbol, rename it via the library → the row shows the new name.
