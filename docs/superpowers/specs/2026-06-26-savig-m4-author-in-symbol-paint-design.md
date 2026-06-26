# Savig M4 — Author Inside a Symbol, Phase 4: In-Symbol Paint (+ anchor)

**Date:** 2026-06-26
**Milestone:** M4 (grouping, layers & nested symbols)
**Status:** design — the fourth "author inside a symbol" follow-up to 47-edit. Phases 1 (delete),
2 (draw), 3 (node-edit) are merged. This routes the **appearance** (paint/style/dash) and **anchor**
actions to the active scene.

---

## 1. Motivation

Inside a symbol you can now select / transform / animate / delete / draw / node-edit parts, but you
cannot **recolor or restyle** them: the appearance actions resolve the selected object from the root
`project.objects`, so inside a symbol they find nothing and no-op. This slice makes fill/stroke
color, gradient, stroke style, dash, and anchor edits work on a symbol's internal parts.

## 2. The seam is already built

Phase 3 added `replaceObjectInScene(project, activeAssetId, next)` — the active-scene "replace one
object" (root → `replaceObject`; else the edited symbol's `objects[]`). Phase 4 reuses it. Every
appearance action shares the same two-part shape:

- **Resolve the object** via `project.objects.find(s.selectedObjectId)` → change to `selectActiveObjects(s).find(...)`.
- **Write** one of:
  - the **global asset** (`project.assets.map(... style ...)`) — static paint: `setVectorStyle`, the
    solid-paint branches of `setVectorColor`/`setVectorGradient`, the `set` branch of
    `setStrokeDasharray`. These are GLOBAL and need NO change once the object is found.
  - the **object** (`replaceObject(project, { ...obj, …tracks/anchor })`) — animated paint + anchor:
    `setVectorColor` (colorTracks), `setVectorGradient` (gradientTracks), `setStrokeDashoffset`
    (dashOffsetTrack), `setAnchor` (anchorX/Y). Change `replaceObject` → `replaceObjectInScene(project, selectActiveAssetId(s), …)`.
  - **both** (asset + object in one commit) — the "clear" branches of `setVectorGradient` (switch to
    solid: clears the asset gradient AND the object's gradient track) and `setStrokeDasharray`
    (clear: removes the asset dasharray AND the object's `dashOffsetTrack`). Route the object half:
    build the asset-updated project, then `replaceObjectInScene(withAssets, selectActiveAssetId(s), nextObj)`
    (exactly the compose used by phase 3's `removeShapeKeyframe`).

## 3. Changes (six actions)

| Action | Object resolve | Writes |
|--------|----------------|--------|
| `setVectorStyle` | scope to active scene | asset only (global) — no write change |
| `setVectorColor` | scope | autoKey → `replaceObjectInScene` (colorTracks); `!autoKey` → `setVectorStyle` (already scoped) |
| `setVectorGradient` | scope | clear → asset + `replaceObjectInScene`; autoKey → `replaceObjectInScene` (gradientTracks); `!autoKey` → `setVectorStyle` |
| `setStrokeDashoffset` | scope | autoKey → `replaceObjectInScene` (dashOffsetTrack); `!autoKey` → `setVectorStyle` |
| `setStrokeDasharray` | scope (clear branch) | `set` → `setVectorStyle`; clear → asset + `replaceObjectInScene` (drop dashOffsetTrack) |
| `setAnchor` | scope | `replaceObjectInScene` (anchorX/Y) |

`setVectorStyle` is the funnel for all static paint (the `!autoKey` color/dash branches and the
`set` dasharray branch call it), so scoping its object resolve once handles every asset write.

## 4. Edit-propagation, parity, undo

- **Edit-propagation** is automatic: a paint/anchor edit changes the symbol's object (animated
  tracks / anchor) or its global asset (static style); every instance reads it via `flattenInstances`.
- **Parity (preview == export)** is untouched: no engine-render change.
- **Undo/persistence** unchanged: each edit is one whole-project commit.
- **No UI change:** the Inspector's color/gradient/style/dash/anchor controls already call these
  actions; they simply start working inside a symbol.

## 5. Scope (this slice) vs deferred

**In:** route `setVectorStyle`, `setVectorColor`, `setVectorGradient`, `setStrokeDashoffset`,
`setStrokeDasharray`, `setAnchor` to the active scene (object resolve via `selectActiveObjects`;
object writes via `replaceObjectInScene`); tests (store + e2e).

**Deferred (remaining author-in-symbol phases):** clipboard (copy/paste; `cut` already deletes),
group/boolean inside, Layers mutators (visibility/lock/rename/reorder — still root-routed), motion
paths inside, advanced morph fine-tuning (per-node easing / correspondence).

## 6. Risks / tradeoffs

- **autoKey/static split:** static paint writes the global asset (works once the object is found);
  only the animated track writes need the seam. The plan routes each branch explicitly; tests cover
  both autoKey on (track on the symbol object) and off (asset).
- **Dual-write "clear" branches** compose an asset update with `replaceObjectInScene` — identical to
  phase 3's `removeShapeKeyframe`; the asset (a vector asset) and the active asset (a symbol) are
  distinct ids, so they can't collide.
- **`setAnchor`** is included (it's a single-object `replaceObject` write — same seam); it completes
  the single-object property writers inside a symbol alongside 47-edit's transform routing.

## 7. Testing strategy

- `store.test.ts` (a path or rect object inside a symbol, selected, in edit mode):
  - `setVectorColor('fill', '#f00')` with autoKey ON → a `colorTracks.fill` keyframe on the SYMBOL
    object (not root); with autoKey OFF → the SYMBOL's vector ASSET `style.fill` updated.
  - `setVectorStyle({ strokeWidth: 9 })` → the asset's `style.strokeWidth` updated; root untouched.
  - `setVectorGradient('fill', <gradient>)` with autoKey ON → `gradientTracks.fill` on the symbol
    object; `setVectorGradient('fill', undefined)` (clear) → the object's gradient track cleared.
  - `setStrokeDashoffset(2)` with autoKey ON → `dashOffsetTrack` on the symbol object.
  - `setAnchor(3, 4)` → the symbol object's `anchorX/anchorY` updated (not root).
  - all instances reflect the change; undo restores; at the root every action is unchanged.
- e2e: create a symbol (a filled rect) with two instances, enter it, change the internal part's fill
  via the Inspector → both instances render the new fill; exit.
