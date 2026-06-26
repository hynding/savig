# Savig M4 — Drag-to-Place a Symbol (47d polish)

**Date:** 2026-06-26
**Milestone:** M4 (grouping, layers & nested symbols)
**Status:** design — the third slice47d-polish item (thumbnails + rename/delete shipped). Adds dragging
a symbol from the AssetPanel library onto the Stage to place an instance at the drop point.

---

## 1. Motivation

A symbol is placed by CLICKING its library row — the instance lands at the symbol's content-centre on
the artboard (`placeSymbolInstance`). There is no way to drop one at a chosen spot. This slice adds
HTML5 drag-and-drop from the library row to the canvas, placing the instance under the cursor.

## 2. Architecture

### 2.1 Store action `placeSymbolInstanceAt(symId, x, y)`

A position-taking sibling of `placeSymbolInstance`: same cycle guard, same active-scene routing
(`selectActiveObjects`/`selectActiveAssetId` + `commitActiveScene`), but the new instance is offset so
the symbol's content-centre lands at `(x, y)` in the active scene's coordinate space:

```ts
placeSymbolInstanceAt(symId, x, y) {
  const s = get();
  const project = s.history.present;
  const symbol = project.assets.find((a) => a.id === symId);
  if (!symbol || symbol.kind !== 'symbol') return;
  const containing = selectActiveAssetId(s);
  if (containing && (symId === containing || symbolContains(symId, containing, project.assets))) {
    get().pushToast('error', `Can't place ${symbol.name} here — it would contain itself.`);
    return;
  }
  const objects = selectActiveObjects(s);
  const time = snapToFrame(s.time, project.meta.fps);
  const box = sceneContentAABB(symbol.objects, project.assets, time);
  const cx = box ? (box.minX + box.maxX) / 2 : 0;
  const cy = box ? (box.minY + box.maxY) / 2 : 0;
  const instance = createSceneObject(symId, {
    name: `${symbol.name} ${nextZOrder(objects) + 1}`,
    zOrder: nextZOrder(objects),
    anchorX: cx,
    anchorY: cy,
    base: { ...DEFAULT_TRANSFORM, x: x - cx, y: y - cy },
  });
  get().commitActiveScene([...objects, instance]);
  get().selectObject(instance.id);
}
```

The base offset `(x - cx, y - cy)` is a pure translation, so the content-centre `(cx, cy)` renders at
`(x, y)`. `placeSymbolInstance` (click-to-place at authored coords, `base` default) is unchanged — the
two share the guard + centre computation but place differently; kept as separate small actions.

### 2.2 AssetPanel — drag source

The symbol place `<button>` becomes a drag source:

```tsx
draggable
onDragStart={(e) => {
  e.dataTransfer.setData('application/x-savig-symbol', sym.id);
  e.dataTransfer.effectAllowed = 'copy';
}}
```

A custom MIME (`application/x-savig-symbol`) carries the symId across to the Stage (the components are
separate, so a shared ref — the Layers-panel drag technique — won't work; `dataTransfer` is the
cross-component channel). Click-to-place is unaffected: a click is not a drag, so `onClick` still fires
for a plain click.

### 2.3 Stage — drop target

The Stage `<svg>` gains drop handlers:

```tsx
onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-savig-symbol')) e.preventDefault(); }}
onDrop={(e) => {
  const symId = e.dataTransfer.getData('application/x-savig-symbol');
  if (!symId) return;
  e.preventDefault();
  const p = clientToLocal(e.clientX, e.clientY);
  if (p) useEditor.getState().placeSymbolInstanceAt(symId, p.x, p.y);
}}
```

- `onDragOver` must `preventDefault()` for the drop to fire (HTML5 DnD), gated on our MIME so unrelated
  drags are ignored.
- `clientToLocal` (the existing helper) maps the client point through the content group's screen CTM —
  accounting for the viewBox, pan, and zoom — to the active scene's coordinate space. In symbol edit
  mode the content group renders the active (symbol) scene, so the drop coords are in the symbol's local
  space, exactly where `placeSymbolInstanceAt` places. The action's cycle guard prevents dropping a
  symbol into itself / an ancestor while editing.

## 3. Parity, undo, safety

- **Parity (preview == export)** is untouched — `placeSymbolInstanceAt` adds an instance object, like
  `placeSymbolInstance`; no engine/render change.
- **Undo** restores: the placement is one `commitActiveScene` snapshot.
- **Cycle safety:** the same guard as `placeSymbolInstance`/`swapSymbol` blocks a self-containing drop in
  edit mode (toast).
- **Cross-component handoff:** `dataTransfer` (a custom MIME), not a store ref — the AssetPanel and Stage
  are distinct components.

## 4. Scope (this slice) vs deferred

**In:** `placeSymbolInstanceAt`; the AssetPanel drag source; the Stage drop target; tests (store + e2e).

**Deferred (separate 47d slices):** recompute the instance anchor on `swapSymbol`; rename/delete for
non-symbol assets; a drag-preview/ghost overlay while dragging.

## 5. Risks / tradeoffs

- **Playwright HTML5-DnD in the e2e:** `locator.dragTo()` (already used by `drag-reparent.spec.ts`)
  dispatches dragstart→dragover→drop with a shared `DataTransfer`, so `setData`/`getData` carry the
  symId. If `dragTo` proves not to carry `dataTransfer` in this setup, the store tests are the
  authoritative proof of the placement logic and the e2e falls back to a manual event dispatch (a
  constructed `DataTransfer`); the store/RTL coverage does not depend on the e2e.
- **Edit-mode coordinates:** `clientToLocal` already returns active-scene coords (it inverts the content
  group's CTM, which renders the active scene), so the same handler works at the root and inside a
  symbol with no special-casing.
- **Minor duplication** between `placeSymbolInstance` and `placeSymbolInstanceAt` (guard + centre) is
  accepted for readability; they place differently (authored coords vs drop point).

## 6. Testing strategy

- `store.test.ts`:
  - `placeSymbolInstanceAt(symId, X, Y)` adds an instance whose `base.x`/`base.y` equal `X - cx` /
    `Y - cy` (content-centre at the drop point); it is selected; the active scene grows by one.
  - in edit mode, dropping a symbol into itself (`placeSymbolInstanceAt(activeSymId, …)`) is blocked —
    no instance added, an error toast is pushed (same guard as `placeSymbolInstance`).
  - `placeSymbolInstance` (click) is unchanged (regression: places at authored coords, `base` default).
- RTL (`AssetPanel.test.tsx`): the symbol place button has `draggable` set.
- e2e (`symbols.spec.ts`): create a symbol, then drag its library row onto the Stage → a second instance
  is placed (the scene gains an instance / a new `[data-savig-object]` leaf).
