# Savig M4 — In-Symbol Timeline Keyframe Editing

**Date:** 2026-06-26
**Milestone:** M4 (grouping, layers & nested symbols)
**Status:** design — the completion of in-symbol editing. "Author inside a symbol" (phases 1–9) is
merged; this routes the remaining shared keyframe-manipulation functions to the active scene so EVERY
timeline keyframe operation works inside a symbol.

---

## 1. Motivation

The author-in-symbol phases routed each track type's property-SET writes (`setProperties` scalar,
`setVectorColor` colorTracks, etc.) plus the motion `progress` keyframe ops (phase 8) and the morph
`shape` keyframe easing (phase 9). So you can CREATE animated keyframes on a symbol-internal object and
SEE them on the in-symbol Timeline (47-edit scoped). But the SHARED keyframe-manipulation store actions
still resolve the ROOT `project.objects` for the remaining track types, so removing / retiming / copying
/ pasting / re-easing a scalar/color/gradient/dash (and the copy/paste/retime of shape) keyframe inside
a symbol is a silent no-op (the id isn't in `project.objects`, the lookup misses, the action returns).
This slice routes the whole surface uniformly.

## 2. The seam, applied uniformly

Every routed branch performs the identical transform — resolve the object from `selectActiveObjects(s)`
instead of root `project.objects`, and write via `replaceObjectInScene(project, selectActiveAssetId(s),
next)` instead of `replaceObject(project, next)`. At the root `selectActiveObjects(s) ===
project.objects` and `replaceObjectInScene(p, null, x) === replaceObject(p, x)`, so behaviour is
byte-unchanged.

### 2.1 Per-type keyframe removes (single object lookup each)
- `removeSelectedKeyframe` (scalar `tracks[property]`)
- `removeSelectedColorKeyframe` (`colorTracks[property]`)
- `removeSelectedGradientKeyframe` (`gradientTracks[property]`)
- `removeSelectedDashKeyframe` (`dashOffsetTrack`)

(`removeSelectedProgressKeyframe` was routed in phase 8 — unchanged.)

### 2.2 Per-keyframe easing / rotation
- `setSelectedKeyframeEasing` — route its `selectedProgressKeyframe` (motion easing — missed in phase
  8), `selectedColorKeyframe`, `selectedGradientKeyframe`, `selectedDashKeyframe`, and `selectedKeyframe`
  (scalar) branches. (Its `selectedShapeKeyframe` branch was routed in phase 9 — unchanged.)
- `setSelectedKeyframeRotationMode` (scalar `tracks.rotation`).

### 2.3 The shared multi-branch ops
- `copyKeyframe` — route its `selectedKeyframe`/`selectedShapeKeyframe`/`selectedColorKeyframe`/
  `selectedGradientKeyframe`/`selectedDashKeyframe` object lookups (snapshots into `keyframeClipboard`;
  no commit). (Its `selectedProgressKeyframe` branch was routed in phase 8.)
- `retimeSelectedKeyframe` — route its scalar/shape/color/gradient/dash branches' object lookups +
  writes. (Its `selectedProgressKeyframe` branch was routed in phase 8.)
- `pasteKeyframe` — route its shared object lookup (used by the scalar/dash/color/gradient/shape switch
  cases) and those cases' writes. (Its `clip.kind === 'progress'` short-circuit, added in phase 8,
  already resolves the active scene — unchanged.)

## 3. Parity, edit-propagation, undo

- **Parity (preview == export)** is untouched — every write is an OBJECT-field track write
  (`tracks`/`colorTracks`/`gradientTracks`/`dashOffsetTrack`/`shapeTrack`); no engine change. The
  existing `flattenInstances → sampleObject` render path applies them identically in preview and export.
- **Edit-propagation** is automatic: editing a symbol-internal object's track is rendered by every
  instance.
- **Undo/persistence** unchanged: each commit is one whole-project snapshot. `copyKeyframe` mutates only
  the transient `keyframeClipboard` (no commit).
- **No UI change:** the Timeline and Inspector are already active-scene scoped; this only fixes the
  store actions they call.

## 4. Scope (this slice) vs deferred

**In:** route every remaining root-resolved branch of `removeSelectedKeyframe` / `removeSelectedColor
Keyframe` / `removeSelectedGradientKeyframe` / `removeSelectedDashKeyframe` / `setSelectedKeyframe
Easing` / `setSelectedKeyframeRotationMode` / `copyKeyframe` / `retimeSelectedKeyframe` / `pasteKeyframe`
to the active scene; tests (store + e2e).

**Out / already done:** the progress branches (phase 8) and the morph shape-easing branch (phase 9) are
already routed and unchanged. Property-SET writes and add/removeShapeKeyframe were routed in earlier
phases.

**After this slice, the entire in-symbol editing surface is closed** — every action that operates on a
selected object or keyframe routes to the active scene.

## 5. Risks / tradeoffs

- **Uniformity removes the asymmetry:** routing all branches of each shared function together (rather
  than per-track-type) is exactly what the phase-8/9 reviews recommended — no half-routed function.
- **Root behaviour byte-unchanged:** every routing reduces to the prior `replaceObject` call at the
  root; the existing root keyframe tests (remove/retime/copy/paste/easing/rotation) are unaffected.
- **`pasteKeyframe` shared lookup:** routing the shared `obj` lookup to `selectActiveObjects` and ALL
  the switch-case writes to `replaceObjectInScene` keeps the function internally consistent (no
  useless-commit for any kind); the progress short-circuit above it is unaffected.
- **Size:** ~9 functions, but one mechanical seam; mitigated by TDD (a representative in-symbol test per
  function) and the byte-identical-at-root invariant.

## 6. Testing strategy

- `store.test.ts` (a symbol-internal object with the relevant animated track, in edit mode) — one
  representative per function (all branches share the identical seam):
  - `removeSelectedKeyframe` removes a SCALAR keyframe from the symbol object (root untouched).
  - `removeSelectedColorKeyframe` removes a color keyframe from the symbol object.
  - `setSelectedKeyframeEasing` (scalar branch) sets a scalar keyframe's easing on the symbol object.
  - `setSelectedKeyframeRotationMode` sets the rotation keyframe mode on the symbol object.
  - `retimeSelectedKeyframe` moves a SCALAR keyframe of the symbol object.
  - `copyKeyframe` + `pasteKeyframe` round-trip a SCALAR keyframe inside the symbol (paste lands on the
    symbol object at the new playhead time).
  - edit-propagation: after a remove/retime, `flattenInstances` yields the instance leaf with the
    updated track.
- e2e: inside a symbol, create an animated scalar property on the internal part (autoKey move at two
  playhead times → two scalar keyframes), select one keyframe on the Timeline, delete it → the keyframe
  count drops (the in-symbol Timeline keyframe op takes effect); exit.
