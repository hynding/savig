# Savig M4 — Author Inside a Symbol, Phase 8: In-Symbol Motion Paths

**Date:** 2026-06-26
**Milestone:** M4 (grouping, layers & nested symbols)
**Status:** design — the eighth "author inside a symbol" follow-up to 47-edit. Phases 1 (delete),
2 (draw), 3 (node-edit), 4 (paint), 5 (layers-mutators), 6 (clipboard), 7 (group/boolean) are merged.
This un-gates the `motion` tool inside a symbol and routes the motion-path actions to the active scene.

---

## 1. Motivation

A motion path makes an object follow a guide curve over time (`SceneObject.motionPath = { path, orient,
progress }`). Inside a symbol two things block it: the `motion` tool is GATED out of `SYMBOL_EDIT_TOOLS`
(so `setActiveTool('motion')` is forced back to `select` in edit mode), and the five motion-path store
actions resolve the ROOT `project.objects` (so they no-op for a symbol-internal object id). This slice
makes motion paths authorable inside a symbol.

Everything ELSE on the motion surface is already active-scene-aware and needs no change:
- The Stage motion-guide overlay reads the edit-scoped `project` (`{ ...present, objects: activeObjects }`),
  so it already renders for a symbol-internal selected object.
- The motion tool's draw commits via `usePathTools` → `addMotionPath(selectedObjectId, path)` (routed here).
- The Inspector single-object motion controls and the Timeline progress track are 47-edit scoped.
- The engine render path already applies motion: `sample.ts` samples `obj.motionPath` and
  `duration.ts` counts its progress keyframes — so an internal object with a motion path animates in
  EVERY instance with NO engine change.

## 2. The seam, applied

### 2.1 Un-gate the `motion` tool

Add `'motion'` to `SYMBOL_EDIT_TOOLS`:

```ts
const SYMBOL_EDIT_TOOLS: ReadonlySet<ToolMode> = new Set([
  'select', 'rect', 'ellipse', 'polygon', 'star', 'line', 'pen', 'brush', 'node', 'motion',
]);
```

### 2.2 Route the five motion-path actions

Each currently does `const obj = project.objects.find((o) => o.id === id)` then
`get().commit(replaceObject(project, { ...obj, motionPath: … }))`. Route = resolve the object from
`selectActiveObjects(s)` and write via `replaceObjectInScene(project, selectActiveAssetId(s), next)` —
the phase-3/4 single-object seam.

| Action | Object resolve | Write |
|--------|----------------|-------|
| `addMotionPath(objectId, path)` | `selectActiveObjects(s).find(id === objectId)` | `replaceObjectInScene(project, selectActiveAssetId(s), { ...obj, motionPath: { path, orient: false, progress } })` |
| `removeMotionPath(objectId)` | same | `replaceObjectInScene(…, { ...obj, motionPath: undefined })` |
| `setMotionPathOrient(objectId, orient)` | same | `replaceObjectInScene(…, { ...obj, motionPath: { ...obj.motionPath, orient } })` |
| `setMotionProgress(value)` | `selectActiveObjects(s).find(id === s.selectedObjectId)` (autoKey-gated) | `replaceObjectInScene(…, { ...obj, motionPath: { ...obj.motionPath, progress } })` |
| `removeSelectedProgressKeyframe()` | `selectActiveObjects(s).find(id === ref.objectId)` | `replaceObjectInScene(…, { ...obj, motionPath: { ...obj.motionPath, progress } })` |

The `motionPath.path` is captured by the pen draft in the focused scene's stage space, so inside a
symbol it lives in the symbol's local space — exactly where the overlay draws it and where
`sampleObject` reads it; each instance then composes its own transform onto the followed position
(Flash-style). At the root `selectActiveObjects(s) === project.objects` and
`replaceObjectInScene(p, null, x) === replaceObject(p, x)`, so behaviour is byte-unchanged.

## 3. Edit-propagation, parity, undo

- **Edit-propagation** is automatic: writing `motionPath` onto a symbol's internal object is rendered
  by every instance via `flattenInstances → sampleObject`.
- **Parity (preview == export)** is untouched — no engine change; the existing render path applies the
  motion path identically in preview and export.
- **Undo/persistence** unchanged: each action is one whole-project commit.
- **No other UI change:** overlay, motion tool, Inspector motion controls, Timeline progress track are
  already active-scene-aware.

## 4. Scope (this slice) vs deferred

**In:** add `motion` to `SYMBOL_EDIT_TOOLS`; route `addMotionPath`, `removeMotionPath`,
`setMotionPathOrient`, `setMotionProgress`, `removeSelectedProgressKeyframe` to the active scene; tests
(store + e2e).

**Deferred:**
- **In-symbol timeline keyframe DRAG** (move / easing / paste) for ALL track types including the motion
  `progress` track. These generic timeline-keyframe actions resolve the root and safely no-op inside a
  symbol today; routing them is a separate "in-symbol timeline keyframe editing" concern (not specific
  to motion), to keep this slice coherent. Setting a progress keyframe via the autoKey control
  (`setMotionProgress`) IS routed here, mirroring phase-4's animated-property writes.
- **Advanced morph fine-tuning** (per-node easing / correspondence) — the final author-in-symbol phase.

After this slice, motion + the deferred morph slice complete "author inside a symbol".

## 5. Risks / tradeoffs

- **Coordinate space:** `motionPath.path` is in the focused scene's local stage space; the overlay
  draws it in the same content group with no per-object transform, and each instance maps the followed
  position through its own transform chain. This is the correct Flash-style result and requires no
  special handling (the path is just object data, like any animated property).
- **Partial timeline support:** inside a symbol you can attach a motion path, set orient, and set/remove
  progress keyframes via the controls, but cannot yet DRAG progress keyframes on the timeline — the same
  limitation every track type has in a symbol today (a coherent, documented boundary).
- **Root behaviour byte-unchanged:** the five routings reduce to the prior `replaceObject` calls at the
  root.

## 6. Testing strategy

- `store.test.ts` (object inside a symbol, in edit mode):
  - `addMotionPath(internalId, path)` → the symbol object gains `motionPath` (path + a 2-keyframe
    progress track); root `objects` untouched.
  - `setMotionPathOrient(internalId, true)` → the symbol object's `motionPath.orient` flips.
  - `setMotionProgress(0.5)` with autoKey on a selected internal object → a progress keyframe is upserted
    on the symbol object's `motionPath`.
  - `removeMotionPath(internalId)` → the symbol object's `motionPath` is cleared.
  - `removeSelectedProgressKeyframe()` for a selected internal progress keyframe → that keyframe is
    removed from the symbol object's `motionPath.progress`.
  - edit-propagation: `flattenInstances(project, time)` yields a leaf for an instance whose underlying
    object carries the `motionPath` (every instance reflects the symbol edit).
  - `setActiveTool('motion')` in edit mode keeps `motion` (no longer gated back to `select`).
- e2e: create a symbol with one part and two instances, enter it, select the part, switch to the motion
  tool, draw a guide path → the `motion-guide` overlay appears (tool usable + `addMotionPath` routed +
  overlay reads the active scene); exit.
