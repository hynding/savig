# Savig M4 — Author Inside a Symbol, Phase 2: In-Symbol Draw

**Date:** 2026-06-26
**Milestone:** M4 (grouping, layers & nested symbols)
**Status:** design — the second "author inside a symbol" follow-up to 47-edit. Phase 1 (in-symbol
delete + cross-scene asset prune) is merged. This routes the geometry-**create** actions to the
active scene and un-gates the draw tools in edit mode.

---

## 1. Motivation

In symbol edit mode you can move, animate, and now delete a symbol's internal parts, but you cannot
**draw new ones**: 47-edit forces the `select` tool in edit mode (the `setActiveTool` gate), and the
create actions append to the root `project.objects`. This slice lets you draw rectangles, ellipses,
polygons, stars, lines, freehand brush strokes, and pen paths **inside** a symbol — every instance
of that symbol immediately shows the new part.

## 2. The asset/object split

A symbol's internal objects reference **global** assets (a `SymbolAsset.objects` entry whose
`assetId` points at a project-level `VectorAsset`), exactly as `flattenInstances` already resolves
them. So drawing inside a symbol must:

- add the new **asset** to the global `project.assets` (project-wide, as today), AND
- add the new **object** to the **active scene** (the root `project.objects`, or the edited
  symbol's `objects[]`).

The three create actions (`addVectorShape`, `addVectorPath`, `addPrimitive`) share an identical
commit tail today — `commit({ ...project, assets: [...assets, asset], objects: [...objects, obj] })`.
Factor that tail into one pure helper that honours the active scene:

```ts
// store.ts (module-level pure helper, like replaceObject)
/** Add a freshly-created asset to the GLOBAL assets[] and its object to the ACTIVE scene (root
 *  project.objects, or the edited symbol's objects[] when activeAssetId is set). Returns the next
 *  project (caller commits + sets selection). */
function appendObjectToScene(
  project: Project,
  activeAssetId: string | null,
  asset: Asset,
  obj: SceneObject,
): Project;
```

## 3. Routing the three create actions

Each action (`addVectorShape`, `addVectorPath`, `addPrimitive`) changes in three small ways:

1. Read the **active scene**: `objects = selectActiveObjects(get())`, `activeId = selectActiveAssetId(get())`.
2. Compute `zOrder`/name over `objects` (the active scene) instead of `project.objects`.
3. Commit via `appendObjectToScene(project, activeId, asset, obj)`, then set the selection and the
   **after-draw tool**: `addVectorShape` lands on `select` (unchanged). `addVectorPath`/`addPrimitive`
   land on `node` **at the root** (for immediate node editing, unchanged) but on `select` **inside a
   symbol** (node-editing inside a symbol is a later phase, so we don't drop the user into a
   non-functional node tool).

At the root (`activeId === null`) `appendObjectToScene` returns exactly today's project, so root draw
behaviour is byte-unchanged.

## 4. Un-gating the draw tools

47-edit's `setActiveTool` gate is `if (editPath.length > 0 && tool !== 'select') return;`. Relax it
to allow the **create tools** while still blocking the tools whose actions are NOT yet routed:

```ts
const SYMBOL_EDIT_TOOLS: ReadonlySet<ToolMode> =
  new Set(['select', 'rect', 'ellipse', 'polygon', 'star', 'line', 'pen', 'brush']);
// in setActiveTool:
if (get().editPath.length > 0 && !SYMBOL_EDIT_TOOLS.has(tool)) return; // node/motion still gated (deferred)
```

`node` and `motion` stay gated in edit mode — their edit actions (`setPathData`, `deleteSelectedNode`,
`addMotionPath`, …) are not routed yet, so allowing them would surface a non-functional tool. Because
the create actions set the after-draw tool themselves (via `set`, not `setActiveTool`), and we force
`select` after an in-symbol path draw (§3), the user never lands on the still-gated `node` tool inside
a symbol.

## 5. Edit-propagation, parity, undo

- **Edit-propagation** is automatic: the new object lives in `SymbolAsset.objects`, which every
  instance reads through `flattenInstances`. Draw once, see it in every instance.
- **Parity (preview == export)** is untouched: no engine-render change. The new object renders via
  the existing `flattenInstances`/`computeFrame`/`renderDocument` path; the Stage already renders the
  active scene in edit mode (47-edit).
- **Undo/persistence** unchanged: each draw is one whole-project commit.

## 6. Scope (this slice) vs deferred

**In:** `appendObjectToScene`; routing `addVectorShape`/`addVectorPath`/`addPrimitive` to the active
scene (zOrder over the active scene, after-draw tool conditional); relaxing the `setActiveTool` gate
to allow the create tools (rect/ellipse/polygon/star/line/pen/brush) while keeping `node`/`motion`
gated; tests (store + e2e).

**Deferred (later author-in-symbol phases):** **node-edit** inside a symbol (route `setPathData`/
`deleteSelectedNode`/the node-drag + un-gate `node`); **motion paths** inside; **group/boolean**
inside; **clipboard** (copy/cut/paste) inside. (Per phase 1, `cut` already deletes inside a symbol
but copy still no-ops.)

## 7. Risks / tradeoffs

- **After-draw tool divergence** (root → `node` for paths; symbol → `select`). Deliberate: node
  editing inside a symbol is a later phase; landing on `select` keeps the user on a functional tool
  (move/transform the new part, which IS routed). Documented.
- **`node`/`motion` still gated in edit mode** — selecting them is a no-op until their phases land.
  Acceptable and consistent with phase 1's "non-routed actions don't surface".
- **zOrder must be computed over the active scene** (not root) so a part drawn inside a symbol stacks
  correctly among the symbol's objects; tested.

## 8. Testing strategy

- `store.test.ts`:
  - In edit mode, `addVectorShape('rect', …)` appends the rect object to the edited symbol's
    `objects[]` (not root), adds the vector asset globally, selects it; both instances then resolve
    it. Same for `addVectorPath` (a path) and `addPrimitive` (a polygon spec).
  - In edit mode, the after-draw tool is `select` for a path/primitive (not `node`).
  - At the root, all three actions are unchanged (object in `project.objects`, asset global; path/
    primitive land on `node`).
  - `setActiveTool('rect')` is allowed in edit mode (was blocked); `setActiveTool('node')` is still
    blocked in edit mode.
- e2e: create a symbol with two instances, enter it, draw a NEW rectangle inside → both instances
  show the extra part (composite-leaf count grows for every instance); exit.
