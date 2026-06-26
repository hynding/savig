# Savig M4 — Non-Symbol Asset Rename & Delete (47d polish)

**Date:** 2026-06-26
**Milestone:** M4 (grouping, layers & nested symbols)
**Status:** design — a 47d-polish wrap-up. Symbols can be renamed/deleted in the library; this extends
rename + delete to the imported svg/audio library assets, removing the asymmetry.

---

## 1. Motivation

The AssetPanel "Symbols" section supports rename + delete; the non-symbol asset list (imported svg and
audio) does not — an imported `box.svg` or a sound clip lingers with no way to rename or remove it. This
slice adds inline rename + a guarded delete to the svg/audio rows, matching the symbol rows.

(Per-shape **vector** assets also appear in the non-symbol list — a separate pre-existing quirk; this
slice scopes its new controls to `svg`/`audio` library assets and leaves vector rows unchanged.)

## 2. Architecture

### 2.1 Store action `deleteAsset(assetId)` (undoable)

`renameAsset(assetId, name)` already exists (generic, shipped with the symbol slice) — reused as-is.

`deleteAsset(assetId)`:

1. Resolve the asset; return if not found, or if it is a `symbol` (symbols use the instance-counted
   `deleteSymbol`).
2. **In-use guard** — an asset is in use when an OBJECT references it (across the root scene and every
   symbol's `objects[]`, via `collectReferencedAssetIds(project)`) OR an AUDIO CLIP references it
   (`project.audioClips.some((c) => c.assetId === assetId)` — audio assets are referenced by clips, not
   objects). If in use, push an error toast (`Can't delete "{name}" — it's in use.`) and return.
3. Otherwise remove the asset from `project.assets` and commit. No internal-asset prune is needed (svg
   and audio have no internal objects).

### 2.2 AssetPanel — non-symbol row rename/delete (svg/audio)

The non-symbol `nonSymbols.map(...)` rows are restructured like the symbol rows (reusing the existing
`editingId` state), with rename + delete controls shown ONLY for `svg`/`audio` assets:

```tsx
{nonSymbols.map((a) => {
  const manageable = a.kind === 'svg' || a.kind === 'audio';
  return (
    <div className={styles.symbolRow} key={a.id}>
      {editingId === a.id ? (
        <input
          className={styles.renameInput}
          data-testid={`asset-rename-${a.id}`}
          defaultValue={a.name}
          autoFocus
          onBlur={(e) => { renameAsset(a.id, e.currentTarget.value); setEditingId(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditingId(null); }}
        />
      ) : (
        <button
          className={styles.item}
          data-testid={`asset-${a.id}`}
          onClick={() => (a.kind === 'svg' ? addObject(a.id) : addAudioClip(a.id))}
        >
          {a.kind === 'audio' ? '♪ ' : ''}{a.name}
        </button>
      )}
      {manageable && (
        <>
          <button className={styles.rowBtn} aria-label={`Rename ${a.name}`} onClick={() => setEditingId(a.id)}>✎</button>
          <button className={styles.rowBtn} aria-label={`Delete ${a.name}`} onClick={() => deleteAsset(a.id)}>×</button>
        </>
      )}
    </div>
  );
})}
```

- The asset action button keeps its click behaviour (svg → `addObject`, audio → `addAudioClip`); a new
  `data-testid={`asset-${a.id}`}` aids tests.
- Vector rows render the button with no rename/delete controls (`manageable` is false).
- Reuses the `.symbolRow`/`.renameInput`/`.rowBtn` CSS from the symbol-rename slice.

## 3. Parity, undo, safety

- **Parity (preview == export)** is untouched — `deleteAsset`/`renameAsset` edit asset metadata / the
  asset array; no engine/render change. A deleted asset is, by the guard, referenced by nothing, so no
  object or clip is broken.
- **Undo** restores a renamed/deleted asset (one whole-project commit).
- **In-use safety:** delete is blocked while any object OR audio clip references the asset — deletion can
  never produce a dangling reference.

## 4. Scope (this slice) vs deferred

**In:** `deleteAsset`; the AssetPanel svg/audio row rename/delete UI; tests (store + RTL + e2e).

**Deferred:** filtering per-shape **vector** assets out of the AssetPanel list (a separate list-cleanup
concern); `swapSymbol` anchor recompute; a drag-preview ghost.

## 5. Risks / tradeoffs

- **Mixed list:** svg/audio rows gain controls; vector rows don't — a deliberate scope line (vectors are
  per-shape, managed via the Layers/objects, not as library items).
- **Audio in-use via clips:** the guard checks `audioClips`, not just object references, because audio
  assets are referenced by clips — missing this would let a clip's asset be deleted out from under it.
- **`renameAsset` reuse:** the symbol slice's generic `renameAsset` already handles any asset kind, so
  rename needs no new action.

## 6. Testing strategy

- `store.test.ts`:
  - `deleteAsset` removes an svg asset referenced by NO object; an svg referenced by an object is BLOCKED
    + toasts.
  - `deleteAsset` on an audio asset referenced by an audioClip is BLOCKED; an unused audio asset is
    removed.
  - `deleteAsset` on a `symbol` is a no-op (symbols use `deleteSymbol`).
  - `deleteAsset` is undoable.
  - `renameAsset` renames an svg asset (regression that it is generic).
- RTL (`AssetPanel.test.tsx`): an svg row shows rename + delete buttons; renaming via the input updates
  the row; deleting an unused svg removes the row; a per-shape VECTOR row has NO rename/delete controls.
- e2e (`assets.spec.ts` or `symbols.spec.ts`): import an svg via the file input, rename it via its row →
  the list shows the new name.
