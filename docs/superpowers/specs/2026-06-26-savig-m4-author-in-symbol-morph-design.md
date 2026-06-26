# Savig M4 — Author Inside a Symbol, Phase 9 (final): In-Symbol Advanced Morph Fine-Tuning

**Date:** 2026-06-26
**Milestone:** M4 (grouping, layers & nested symbols)
**Status:** design — the NINTH and FINAL "author inside a symbol" follow-up to 47-edit. Phases 1–8
(delete, draw, node-edit, paint, layers-mutators, clipboard, group/boolean, motion) are merged. This
routes the advanced morph fine-tuning actions to the active scene, completing "author inside a symbol".

---

## 1. Motivation

Morph fine-tuning controls let you tune a shape-tween between two shape keyframes: the per-keyframe
**morph mode**, the node **correspondence** map (which A-node maps to which B-node), and per-node
**easing**. Their store actions all resolve the ROOT `project.objects` and early-return on
`!obj?.shapeTrack`, so inside a symbol they no-op (phase 3 left them a documented safe no-op). This
slice routes them to the active scene.

Everything else on the morph surface is already active-scene-aware and needs no change:
- `selectEditedShapeKeyframe` / `selectSelectedObject` (selectors) resolve `selectActiveObjects`.
- The Inspector morph controls read `selectActiveObjects` (the `morph: N keyframe(s)` panel, the
  morph-mode control, "Suggest correspondence", per-node easing).
- The Stage correspondence drag-link overlay resolves the edit-scoped `project.objects`
  (`{ ...present, objects: activeObjects }`).
- The Timeline shape-keyframe row is 47-edit scoped.
- The engine render path applies the morph: `samplePath` reads `shapeTrack` (incl. `morph` /
  `correspondence` / `nodeEasings`), and `flattenInstances → sampleObject → samplePath` runs per leaf,
  so an internal path's morph tuning renders in EVERY instance with NO engine change.

## 2. The seam, applied

The four morph actions each do `const obj = project.objects.find((o) => o.id === <ref>.objectId)` (or
`s.selectedObjectId`), guard `if (!obj?.shapeTrack) return`, compute a new `shapeTrack` (an OBJECT-field
write of morph metadata), and `get().commit(replaceObject(project, { ...obj, shapeTrack }))`. Route =
resolve the object from `selectActiveObjects(s)` and write via `replaceObjectInScene(project,
selectActiveAssetId(s), { ...obj, shapeTrack })` — the phase-3 morph-write seam.

| Action | Object resolve | Write |
|--------|----------------|-------|
| `setSelectedShapeKeyframeMorph(mode)` | `selectActiveObjects(s).find(id === ref.objectId)` | `replaceObjectInScene(project, selectActiveAssetId(s), { ...obj, shapeTrack })` |
| `setSelectedShapeKeyframeCorrespondence(corr)` | same | same |
| `setSelectedNodeEasing(easing)` | `selectActiveObjects(s).find(id === s.selectedObjectId)` (with `selectEditedShapeKeyframe`, already active-scene) | same |
| `setCorrespondenceLink(aIndex, bIndex)` | `selectActiveObjects(s).find(id === ref.objectId)` | same |

`enterCorrespondenceEdit` / `exitCorrespondenceEdit` are pure transient-state toggles — no change.
`setSelectedNodeEasing` already reads `edited` from `selectEditedShapeKeyframe` (active-scene scoped);
only its object lookup + write need routing. At the root `selectActiveObjects(s) === project.objects`
and `replaceObjectInScene(p, null, x) === replaceObject(p, x)`, so behaviour is byte-unchanged.

## 3. Edit-propagation, parity, undo

- **Edit-propagation** is automatic: morph tuning on a symbol's internal path object is rendered by
  every instance via `flattenInstances → sampleObject → samplePath`.
- **Parity (preview == export)** is untouched — no engine change; the existing render path applies the
  morph identically in preview and export.
- **Undo/persistence** unchanged: each action is one whole-project commit.
- **No other UI change:** selectors, Inspector morph controls, Stage correspondence overlay, and
  Timeline are already active-scene-aware.

## 4. Scope (this slice) vs deferred

**In:** route `setSelectedShapeKeyframeMorph`, `setSelectedShapeKeyframeCorrespondence`,
`setSelectedNodeEasing`, `setCorrespondenceLink` to the active scene; tests (store + e2e).

**Deferred (separate, pre-existing):** general in-symbol timeline keyframe editing — the
`retimeSelectedKeyframe` / `copyKeyframe` / `pasteKeyframe` branches for scalar/shape/color/gradient/
dash (phase 8 routed only the motion `progress` branch). Same single-object seam across all branches of
the three shared keyframe functions; its own slice.

**After this slice, "author inside a symbol" (phases 1–9) is COMPLETE** — every editing action that
operates on a selected object/keyframe is routed to the active scene.

## 5. Risks / tradeoffs

- **Reachability:** the morph controls require a path object with a ≥2-keyframe `shapeTrack`. Inside a
  symbol that is now fully authorable (phase 3 routed node-edit + `addShapeKeyframe`), so a user can
  build a morph and tune it without leaving the symbol.
- **Root behaviour byte-unchanged:** the four routings reduce to the prior `replaceObject` calls at the
  root; the existing root morph tests are unaffected.
- **No new selectors/overlays:** this slice changes only the four store actions; the supporting
  surface was scoped in phases 3 and 47-edit.

## 6. Testing strategy

- `store.test.ts` (a symbol-internal path object with a 2-keyframe `shapeTrack`, in edit mode):
  - `setSelectedShapeKeyframeMorph(mode)` with the first shape keyframe selected → the symbol object's
    `shapeTrack[0].morph` is set; root `objects` untouched.
  - `setSelectedShapeKeyframeCorrespondence(corr)` → `shapeTrack[0].correspondence` is set.
  - `setSelectedNodeEasing(easing)` with a selected node + playhead on the first keyframe → the symbol
    object's `shapeTrack[0].nodeEasings[idx]` is set.
  - `setCorrespondenceLink(a, b)` → the symbol object's `shapeTrack[0].correspondence[a] === b`.
  - edit-propagation: `flattenInstances(project, time)` yields a leaf for an instance whose underlying
    object carries the tuned `shapeTrack` (morph metadata reflected in every instance).
- e2e: inside a symbol, author a path with two shape keyframes (node tool + add-shape-keyframe + a node
  drag, mirroring the root correspondence e2e), select the first shape keyframe, click "Suggest
  correspondence" → the summary shows "suggested · N nodes" (proving
  `setSelectedShapeKeyframeCorrespondence` routes end-to-end inside the symbol); exit.
