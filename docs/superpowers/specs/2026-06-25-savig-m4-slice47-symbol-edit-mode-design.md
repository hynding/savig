# Savig M4 — Symbol Edit Mode (enter / edit / exit a symbol's internal scene)

**Date:** 2026-06-25
**Milestone:** M4 (grouping, layers & nested symbols)
**Status:** design — the remaining half of the slice47 spec's "47b" (the instance transform UI half
shipped as slice 47b, merge `a42718a`). This is the **symbol edit-mode** slice.

---

## 1. Motivation

47a built reusable symbol definitions (`SymbolAsset.objects`) and 47b gave an instance a transform
UI. But there is still **no way to edit a symbol's internals** after `createSymbol`. You can move
the instance as a whole; you cannot reach inside to rearrange, retime, or delete its parts. This
slice adds the Flash-style **edit-in-place**: double-click an instance to descend into its scene,
edit its objects (with every instance on the stage updating live — edit-propagation), and exit back
out via a breadcrumb or Esc.

## 2. The core decision — symbols are global assets, so "the scene being edited" is a flat array

A `SymbolAsset` lives in `project.assets`. An instance is an ordinary object whose `assetId` points
at it. Therefore **editing symbol B's internals is always editing `project.assets[B].objects`** — a
single flat array — *regardless of how deeply you navigated to reach it*. Two consequences:

1. **No new data model and no recursive write-back.** The "place" you edit is one array: either the
   root `project.objects`, or one global symbol asset's `objects`.
2. **Undo/redo/persistence are free.** History already snapshots the whole `Project` (including its
   `assets`). Editing a symbol's `objects` mutates a nested array of that same snapshot, so existing
   `commit`/undo/redo/autosave work unchanged.

The only real work is **redirecting reads and writes to the active scene** — there is no new
persistence, history, or render-engine plumbing.

## 3. Architecture — a transient "focused scene" view

### 3.1 State

Add one piece of transient editor state (a *view*, like `selectedObjectIds`/`zoom` — **NOT** in
history):

```ts
/** The symbol-asset ids entered, outermost-first (e.g. ['symA','symB'] = editing symB reached via
 *  an instance of symA). [] = editing the root scene. Purely navigation/breadcrumb context: the
 *  WRITE target is always the LAST entry (a global SymbolAsset) or the root. */
editPath: string[];   // default []
```

### 3.2 Read side — `editProject` / `activeObjects`

```ts
// The asset id of the scene being edited, or null for the root scene.
const activeAssetId = editPath.at(-1) ?? null;

// The objects[] array of the active scene (root or the deepest symbol). Read by Stage, Timeline,
// LayersPanel, Inspector, and the scene selectors so the WHOLE editor shows the active scene.
selectActiveObjects(s): SceneObject[]
  = activeAssetId
      ? (assets.find(a => a.id === activeAssetId && a.kind === 'symbol')?.objects ?? present.objects)
      : present.objects;

// A "focused project" = the real project with objects[] swapped to the active scene. Fed to
// flattenInstances/computeFrame so the Stage renders ONLY the symbol's internals. Assets stay the
// GLOBAL assets[] (a symbol's leaves resolve against them, and nested instances still expand).
selectEditProject(s): Project = activeAssetId ? { ...present, objects: selectActiveObjects(s) } : present;
```

Inside a symbol scene, that scene's objects are "top-level," so `flattenInstances` emits
**un-prefixed** renderIds (the object's own id) — selection by id works directly, exactly as at the
root. (At the root these same objects render as an instance with `instId/…`-prefixed ids; different
view, same data.)

### 3.3 Write side — `commitActiveScene`

```ts
// Write the active scene's next objects[] back and snapshot the whole project (history/undo free).
commitActiveScene(nextObjects: SceneObject[]): void
  = activeAssetId
      ? commit({ ...present, assets: present.assets.map(a =>
          a.id === activeAssetId && a.kind === 'symbol' ? { ...a, objects: nextObjects } : a) })
      : commit({ ...present, objects: nextObjects });
```

The routed editing actions read `selectActiveObjects` and write `commitActiveScene` instead of
`present.objects` / `commit({...present, objects})`. Because all instances of the symbol read the
same asset, an edit is seen by **every instance** with zero extra work (edit-propagation).

### 3.4 Enter / exit

- **Enter:** double-click an instance's flattened leaf → resolve the owning top-level object
  (renderId before the first `/`) → if it is a symbol instance, `enterSymbol(symId)` pushes its
  asset id onto `editPath` and clears selection. Double-clicking a *nested* instance while already
  inside a symbol descends another level (free — the target is just another global asset).
- **Exit:** `exitSymbol()` pops one level; `exitToDepth(n)` (breadcrumb click) truncates `editPath`
  to length `n`; both clear selection. **Esc** exits one level when in edit mode (and not
  pen-drafting); at the root Esc keeps its current behaviour (return to select tool).
- Entering/exiting **clears the selection** (ids belong to a specific scene) and switches the active
  tool to `select` (see §4).

### 3.5 Breadcrumb

A small new component `EditBreadcrumb` (rendered above/over the Stage), visible only when
`editPath` is non-empty: `Root › SymbolName › …`, each segment a button (`exitToDepth`), the last
segment current/non-clickable. `Root` calls `exitToDepth(0)`.

## 4. Tool scope in edit mode (v1 boundary)

v1 routes **only the select-tool editing actions** to the active scene: move-drag, arrow-nudge, the
scale/rotate/instance handles, geometry resize, `setProperties`/`setObjectsTransforms`, and
delete. With auto-key on, transform edits keyframe the internals — so **animating** a symbol's parts
works for free. This is a coherent, demoable edit mode: *enter, rearrange / transform / delete /
animate the parts, watch every instance update, exit.*

To keep the action-routing bounded and avoid a half-scoped editor, **edit mode restricts the
toolbar to the select tool** (entering edit mode switches to `select`; the geometry-creation tools —
rect/ellipse/polygon/star/line/pen/brush — and the node tool are disabled while `editPath` is
non-empty). Creating/drawing *new* geometry inside a symbol, node-editing, grouping/boolean inside,
and copy-paste inside are **deferred to a follow-up slice** ("author inside a symbol"); they require
routing the ~10 creation/structural actions, out of scope here.

## 5. What changes (surface)

- **store:** `editPath` state; `enterSymbol`/`exitSymbol`/`exitToDepth` actions (clear selection +
  force select tool); `selectActiveObjects`/`selectEditProject`/`commitActiveScene` helpers; route
  the transform/delete actions (`setProperties`, `setObjectsTransforms`, `nudgeSelected`,
  `deleteSelected`/`removeObject`, and the booleans/group buttons are simply gated off in edit mode)
  to `selectActiveObjects`+`commitActiveScene`.
- **selectors:** `selectProject`→`selectEditProject`; `selectSelectedObject`, `selectEditablePath`,
  `selectEditedShapeKeyframe` read `selectActiveObjects`.
- **Stage:** read `selectEditProject` (render the focused scene); double-click leaf → `enterSymbol`;
  restrict tools; (the existing handle/selection/snapping code is unchanged — it already operates on
  "the project" it is handed).
- **Timeline / LayersPanel / Inspector:** read `selectActiveObjects` instead of
  `present.objects` so they show the active scene.
- **useKeyboard:** Esc exits a symbol level when in edit mode.
- **new:** `EditBreadcrumb` component.

## 6. Edit-propagation, parity, undo

- **Edit-propagation** is automatic: instances render from `flattenInstances`, which reads the same
  `SymbolAsset.objects` the edit wrote.
- **Parity (preview == export)** is untouched: no engine/runtime/export render code changes; the
  Stage simply feeds `flattenInstances`/`computeFrame` a focused project view (the same functions,
  different `objects[]`). Export always renders the ROOT project (edit mode is editor-only view
  state, never serialized).
- **Undo/redo** snapshot the whole project; undoing an in-symbol edit restores the asset. `editPath`
  itself is transient (not undone); if an undo/redo leaves `editPath` pointing at an asset that no
  longer exists, the getters fall back to root (guard: a missing active asset resolves to root).

## 7. Scope (this slice) vs deferred

**In:** `editPath` + enter/exit/breadcrumb/Esc; Stage/Timeline/Layers/Inspector scoped to the active
scene; double-click to enter (incl. nested); select-tool transform/move/delete/keyframe routed to
the active scene; edit-propagation; tool restriction; selection cleared on enter/exit; missing-asset
fallback to root.

**Deferred (follow-up "author inside a symbol"):** creating new geometry inside a symbol
(rect/ellipse/polygon/star/line/pen/brush), node editing, grouping/boolean/duplicate/clipboard
inside, reorder inside; a visible "you are inside a symbol" Stage tint/frame beyond the breadcrumb;
showing the symbol's `width`/`height` content frame. (47c independent timelines and 47d library
remain separately after.)

## 8. Risks / tradeoffs

- **Cross-cutting reads.** Four UI surfaces + the selectors must point at the active scene; missing
  one yields an incoherent editor (e.g. Layers showing root while the Stage shows the symbol). The
  plan routes them explicitly and a test asserts each shows the symbol's objects in edit mode.
- **Stale selection across scenes.** Selection ids are scene-local; enter/exit clears selection to
  avoid an id from one scene resolving in another. Tested.
- **Undo deleting the active asset.** Guarded: a missing `activeAssetId` resolves to the root scene
  (and a follow-up could auto-pop the breadcrumb).
- **Tool confusion.** Restricting to select-tool in edit mode is the v1 guardrail that keeps the
  un-routed creation actions from writing to the root while the user "feels" inside the symbol.

## 9. Testing strategy

- **store:** `enterSymbol` sets `editPath`/clears selection/forces select tool; `selectActiveObjects`
  returns the symbol's objects in edit mode and root otherwise; `commitActiveScene` writes back into
  the asset (and a root edit still writes `project.objects`); a transform/delete action inside a
  symbol mutates the asset and **both instances** reflect it (edit-propagation); undo restores;
  missing-asset fallback returns root; exit clears selection.
- **selectors:** `selectEditProject`/`selectSelectedObject`/`selectEditablePath` resolve against the
  active scene.
- **Stage (jsdom):** in edit mode the Stage renders the symbol's objects (un-prefixed ids) and a
  double-click on an instance leaf enters; transform of an internal commits to the asset.
- **Timeline/Layers/Inspector:** show the active scene's objects in edit mode.
- **useKeyboard:** Esc exits a symbol level in edit mode; returns to select tool at root.
- **e2e:** create a symbol from 2 shapes → duplicate the instance (2 instances) → double-click one →
  breadcrumb shows the symbol → move an internal part → BOTH instances update → Esc exits → root
  scene intact.
- Existing engine/parity/Stage suites stay green (root rendering unchanged).
