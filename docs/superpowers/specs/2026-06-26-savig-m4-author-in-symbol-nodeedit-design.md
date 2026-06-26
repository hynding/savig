# Savig M4 — Author Inside a Symbol, Phase 3: In-Symbol Node-Edit

**Date:** 2026-06-26
**Milestone:** M4 (grouping, layers & nested symbols)
**Status:** design — the third "author inside a symbol" follow-up to 47-edit. Phase 1 (in-symbol
delete) and phase 2 (in-symbol draw) are merged. This routes the path **node-edit** write actions to
the active scene and un-gates the `node` tool in edit mode.

---

## 1. Motivation

You can now draw a path inside a symbol (phase 2), but you cannot **edit its nodes** there: the
`node` tool is gated in edit mode, and the node-edit write actions resolve the selected object from
the root `project.objects` — so inside a symbol they find nothing and no-op. (Phase 2 even lands an
in-symbol path draw on `select` rather than `node`, precisely because node-edit wasn't routed.) This
slice makes node editing — drag/insert/delete/smooth/join a node, and add/remove a morph (shape)
keyframe — work on a path inside a symbol.

## 2. Two seams make this small

1. **All node-geometry editing funnels through `setPathData`.** Dragging a node (`usePathTools` →
   `setPathData`), inserting (`insertNode` → `setPathData`), deleting (`deleteSelectedNode` →
   `setPathData`), smoothing (`toggleSelectedNodeSmooth` → `setPathData`), joining (`joinSelectedNode`
   → `setPathData`) all commit through it. Route `setPathData` and they all follow.
2. **The object is resolved in exactly one place** — the `selectedPathCtx(get)` helper (used by
   `setPathData`, `addShapeKeyframe`, `removeShapeKeyframe`) and the read selectors
   `selectEditablePath`/`selectEditedShapeKeyframe` (already active-scene-scoped by 47-edit).
3. **A static-path edit writes the ASSET** (`asset.path`), which is global — so it already works
   inside a symbol the moment `selectedPathCtx` finds the object. Only the **morph branch** (a path
   change written to the object's `shapeTrack`) writes the object, and that's where active-scene
   routing is needed.

## 3. Changes

### 3.1 Scope `selectedPathCtx` to the active scene

```ts
// store.ts — change the object lookup from root to the active scene (47-edit's selectActiveObjects).
function selectedPathCtx(get): { obj; asset } | null {
  const s = get();
  const obj = selectActiveObjects(s).find((o) => o.id === s.selectedObjectId); // was s.history.present.objects
  if (!obj) return null;
  const asset = s.history.present.assets.find((a) => a.id === obj.assetId); // assets are global
  if (!asset || asset.kind !== 'vector' || asset.shapeType !== 'path') return null;
  return { obj, asset };
}
```

This single change enables **static-path node editing** inside a symbol (the common case: a freshly
drawn path has no `shapeTrack`, so `setPathData` takes the asset-write branch — already global).

### 3.2 A scene-aware object replace for the morph branch

```ts
// store.ts (pure module helper, next to replaceObject)
/** Replace one object in the ACTIVE scene: root project.objects, or the edited symbol's objects[].
 *  At root it is exactly replaceObject. (author-in-symbol node-edit) */
function replaceObjectInScene(project: Project, activeAssetId: string | null, next: SceneObject): Project {
  if (!activeAssetId) return replaceObject(project, next);
  return {
    ...project,
    assets: project.assets.map((a) =>
      a.id === activeAssetId && a.kind === 'symbol'
        ? { ...a, objects: a.objects.map((o) => (o.id === next.id ? next : o)) }
        : a,
    ),
  };
}
```

Route the three object-writing branches to use it (reading `activeId = selectActiveAssetId(s)`):

- `setPathData` **morph branch**: `commit(replaceObject(project, { ...obj, shapeTrack }))`
  → `commit(replaceObjectInScene(project, activeId, { ...obj, shapeTrack }))`.
- `addShapeKeyframe`: same substitution.
- `removeShapeKeyframe` — two branches:
  - last-keyframe-removed (writes the base into the asset AND drops the object's `shapeTrack`):
    update the asset globally first, then `replaceObjectInScene(withAsset, activeId, { ...obj, shapeTrack: undefined })`.
  - otherwise: `commit(replaceObjectInScene(project, activeId, { ...obj, shapeTrack: remaining }))`.

The **asset-write** branches (`setPathData` static branch; the asset half of `removeShapeKeyframe`)
need NO change — assets are global, so writing `project.assets` is correct in any scene.

### 3.3 Un-gate the `node` tool + land in-symbol draws on `node`

Add `'node'` to `SYMBOL_EDIT_TOOLS` (now that its writes are routed). And revert phase-2's after-draw
tool for in-symbol path/primitive draws: `addVectorPath`/`addPrimitive` set `activeTool: 'node'`
again (not `activeId ? 'select' : 'node'`) — node editing inside a symbol is now functional, so a
freshly drawn in-symbol path should drop the user into the node tool exactly as at the root. (Update
the phase-2 test that asserted `select`.)

`motion` stays gated (motion-path actions aren't routed — a later phase).

## 4. Edit-propagation, parity, undo

- **Edit-propagation** is automatic: a node/shape edit changes the symbol's object (or its global
  asset), which every instance reads through `flattenInstances`.
- **Parity (preview == export)** is untouched: no engine-render change. The Stage node overlay already
  renders against the active-scene-scoped `selectEditablePath` (47-edit).
- **Undo/persistence** unchanged: each edit is one whole-project commit.

## 5. Scope (this slice) vs deferred

**In:** scene-aware `selectedPathCtx` + `replaceObjectInScene`; route `setPathData` (morph branch),
`addShapeKeyframe`, `removeShapeKeyframe` object-writes; add `'node'` to `SYMBOL_EDIT_TOOLS`; land
in-symbol path/primitive draws on `node`; tests (store + e2e). This makes drag/insert/delete/smooth/
join nodes and add/remove morph keyframes work on a path inside a symbol.

**Deferred:** advanced morph fine-tuning inside a symbol — per-node easing (`setSelectedNodeEasing`),
morph mode (`setSelectedShapeKeyframeMorph`), correspondence editor (`setSelectedShapeKeyframeCorrespondence`)
— these don't use `selectedPathCtx` and still route to the root (safe no-op in a symbol); **in-symbol
paint/style** (color/gradient/strokeStyle/dash — these use `replaceObject` and can reuse
`replaceObjectInScene` in a later phase); motion paths; clipboard; group/boolean; Layers mutators.

## 6. Risks / tradeoffs

- **Deferred morph fine-tuning is a safe no-op**, not a crash: `setSelectedShapeKeyframeMorph` et al.
  resolve the object from the root, find nothing in a symbol, and either early-return or commit an
  identical project (a harmless empty undo step). Acceptable until the morph-fine-tuning phase;
  documented.
- **`replaceObjectInScene` is the reusable seam** for the future in-symbol-paint phase (all the
  `replaceObject`-based single-object writers), so this isn't throwaway plumbing.
- **After-draw tool reverts to `node`** for in-symbol paths (a phase-2 behaviour reversal); the
  phase-2 test is updated to match.

## 7. Testing strategy

- `store.test.ts`:
  - In edit mode, with a path object selected inside a symbol, `setPathData(newPath)` updates the
    path (static branch → the symbol's path asset changes; the symbol's object is untouched); both
    instances reflect it.
  - `deleteSelectedNode` inside a symbol removes a node (via `setPathData` structural delete).
  - With a `shapeTrack`, `setPathData` inside a symbol writes the morph keyframe into the symbol's
    object (`replaceObjectInScene`), not the root; `addShapeKeyframe`/`removeShapeKeyframe` likewise.
  - `setActiveTool('node')` is now allowed in edit mode; `setActiveTool('motion')` still blocked.
  - `addVectorPath` inside a symbol now lands on the `node` tool (update the phase-2 test).
  - At the root, all of the above are unchanged.
- e2e: create a symbol containing a path with two instances, enter it, select the node tool, delete a
  node → both instances show the simpler path; exit.
