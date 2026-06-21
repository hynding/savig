# Savig — M2 Slice 5: Motion Paths (Design)

**Date:** 2026-06-21
**Status:** Approved design — ready for implementation planning
**Author:** Steve Hynding (with Claude)
**Context:** M2 vector tools, Slice 5. The vector foundation (Slice 1), pen/paths (Slice 2),
path morphing + the morph/easing roadmap Features 1–4 (arc-length resample, node
correspondence, per-node easing, unified easing UI), and color animation (Slice 4) are all
complete and merged. This slice delivers **motion paths** — the one remaining "advanced
tween" item the M1 roadmap named under M3 (*"Path morphing & advanced tweens … motion paths,
custom-bezier easing UI"*); morphing and the bezier-easing UI already shipped, so this closes
that line. The other Slice 5+ basket items (freehand brush, more primitives, gradients,
boolean ops) stay queued, each its own cycle.

## Summary

Let a scene object **follow a drawn guide path over the timeline** — its position
(and, optionally, its rotation) is driven by a point traveling along the path, paced by a
normalized **progress** track (0..1) with per-keyframe easing. Position is resolved per-frame
by the **same pure sampler** the Stage and the export runtime share — exactly as transform,
geometry, morph, and color already are. The feature reduces to **one optional field** on
`SceneObject` (`motionPath?`), so old projects load unchanged with **no migration**.

Constant progress-rate yields constant *speed* because the path is sampled by **arc length**,
reusing the proven flatten/cumulative-length core already built for arc-length morph
(`engine/morph/resample.ts`). That core is extracted into a small shared module so motion
paths and morph resampling share one tested implementation.

### Stack & standards (unchanged from M1/M2)

pnpm · Vite · React 18 + TS (strict) · Zustand · Vitest + RTL · Playwright · CSS Modules +
design tokens. Client-only. TDD throughout. The engine layer stays **pure TypeScript with
zero React/DOM dependencies**; the render core lifts verbatim into the export runtime.
Preview == export parity: the editor Stage and the export runtime resolve the followed
position/tangent via the **same** pure `pointAtFraction`/`tangentAtFraction` inside the
**same** `sampleObject`, and apply the resulting `x`/`y`/`rotation` via the **same**
`applyFrameToNodes`.

---

## 1. Where motion paths fit

Animated values flow through one pipeline today:
`sampleObject(obj, time) → RenderState → computeFrame → FrameItem → applyFrameToNodes`
(the Stage painter and the export runtime both call `computeFrame`/`applyFrameToNodes`).
`RenderState extends Transform2D`, so it **already carries `x`, `y`, and `rotation`**, and the
runtime already applies them to each object's wrapper `<g>`. A motion path does not introduce a
new resolved value *type* — it **changes how `x`/`y`/`rotation` are resolved** for one object:
instead of (or in addition to) reading the numeric tracks, `sampleObject` reads a point on the
guide path. So the render/apply side needs **no new attribute plumbing**; the work is the pure
resolver plus the authoring UI.

Scope: motion paths apply to **any scene object** (imported SVG or vector) — following a path
is a transform-level behavior, independent of what the object *is*. The guide path itself is a
`PathData` stored on the object (drawn with the existing pen tooling); it is not a separate
scene object and does not render in the export (it is editor-only chrome).

---

## 2. Data model

`SceneObject` gains one **optional** field, parallel to `shapeTrack` and `colorTracks`:

```ts
export interface MotionPath {
  /** Guide geometry in STAGE coordinates (same space as base.x/base.y). */
  path: PathData;
  /** When true, the object's rotation follows the path tangent (plus base rotation). */
  orient: boolean;
  /** Normalized position along the path over time: value in [0,1], 0 = path start,
   *  1 = path end. Reuses Keyframe (value/time/easing) and interpolate(). */
  progress: Keyframe[];
}

export interface SceneObject {
  // …
  motionPath?: MotionPath;
}
```

- **Position override (explicit semantics).** When `motionPath` is present **and** its
  `progress` track is non-empty, the resolved translate `(x, y)` is the **arc-length point on
  the guide at the sampled progress** — in stage coordinates, absolute. The numeric `x`/`y`
  tracks (and `base.x`/`base.y`) are **ignored for translation** while a motion path is active.
  This is the Flash/Wick "snap registration point to the guide" model; it is documented here
  rather than implemented as a confusing additive offset. (Scale/opacity/geometry/color tracks
  are unaffected — only translation, and rotation when `orient`, are taken over.)
- **`orient`.** When true, resolved `rotation = tangentAngleDeg(path, progress) + base.rotation`
  (the static `base.rotation` acts as a constant offset; the `rotation` *track*, if any, is
  ignored while orienting — same override rule as translation). When false, rotation resolves
  normally (track or base).
- **Static base.** A motion path with an **empty** `progress` track resolves nothing (the
  object animates by its ordinary tracks/base). This makes "guide drawn but not yet paced" a
  valid intermediate state and keeps the override strictly gated on a non-empty progress track.
- **Additive optional field** → old projects (absent `motionPath`) behave exactly as today.
  **No migration / no version bump**, consistent with `shapeTrack` / `colorTracks` /
  `morph` / `correspondence` / `nodeEasings`.

---

## 3. Engine

### 3.1 `engine/geom/arcLength.ts` (new, pure — extracted)

The arc-length core currently private to `engine/morph/resample.ts` is lifted verbatim into a
shared module and re-imported by `resample.ts` (behavior-preserving; guarded by resample's
existing tests and the morph parity tests):

```ts
export interface Flattened {
  pts: PathPoint[];   // fine polyline along the RENDERED curve (same L/C rule as pathToD)
  cum: number[];      // cumulative arc length; cum[last] = total length
  total: number;
}
function flattenPath(path: PathData): Flattened;
function pointAtLength(flat: Flattened, target: number): PathPoint;   // clamped to [0,total]
```

`resample` is refactored to call `flattenPath`/`pointAtLength`; its output stays byte-identical
(its tests and the arc-length morph parity tests are the guard).

### 3.2 `engine/motion.ts` (new, pure)

```ts
function pointAtFraction(path: PathData, frac: number): PathPoint;       // frac in [0,1], clamped
function tangentAngleDeg(path: PathData, frac: number): number;         // degrees, atan2 of local tangent
```

- **`pointAtFraction`** = `pointAtLength(flattenPath(path), clamp01(frac) * total)`.
  Degenerate guards mirror `resample`: empty path → `{x:0,y:0}`; zero-length path → the start
  point.
- **`tangentAngleDeg`** samples the polyline direction at `frac` via a small central finite
  difference in arc-length space (`frac ± ε`, ε a fraction of total length), returning
  `atan2(dy, dx)` in **degrees** to compose with the existing degree-based rotation. Endpoint
  clamping uses the one-sided difference. Zero-length / single-point path → `0`.

### 3.3 `sampleObject` resolves the followed position/rotation

After the existing transform-resolution loop in `sampleObject` (`engine/sample.ts`), add a
motion-path override:

```ts
const mp = obj.motionPath;
if (mp && mp.progress.length > 0) {
  const frac = interpolate(mp.progress, time);     // eased, clamped 0..1 by progress endpoints
  const p = pointAtFraction(mp.path, frac);
  state.x = p.x;
  state.y = p.y;
  if (mp.orient) state.rotation = tangentAngleDeg(mp.path, frac) + obj.base.rotation;
}
```

`interpolate` already clamps before the first / after the last keyframe and applies per-keyframe
easing, so progress naturally holds at the path ends and eases between progress keyframes. The
override runs **after** the normal resolution so it cleanly supersedes x/y (and rotation when
orienting) without disturbing scale/opacity/geometry/color.

### 3.4 Duration includes the progress track

`computeProjectDuration` must fold in `motionPath.progress` keyframe times (as it already does
for `tracks`, `shapeTrack`, and `colorTracks`), so a progress keyframe placed past the current
end **extends** the timeline like any other keyframe.

---

## 4. Render pipeline & parity

- **No new `FrameItem` field and no new apply code.** Motion paths resolve into the existing
  `x`/`y`/`rotation` on `RenderState`; `computeFrame` → `FrameItem` → `applyFrameToNodes`
  already carry and apply the object transform (the wrapper `<g>` `transform` string via the
  shared `buildTransform`). The followed motion therefore appears in preview and export through
  the unchanged transform path.
- **Runtime carries the guide.** `motionPath` (including its `path`) is part of the serialized
  `SceneObject`, so the exported project data includes the guide geometry; the bundled runtime
  runs the **same** `sampleObject` and resolves the follow identically. The guide path is
  **not** rendered as visible art in the export — it exists only as data the runtime samples.
  Regenerate the runtime bundle (`pnpm build:runtime`).
- **Parity assertion:** `computeFrame(project, t)` yields `x`/`y` equal to
  `pointAtFraction(mp.path, interpolate(mp.progress, t))` (and, with `orient`, `rotation` equal
  to `tangentAngleDeg(...) + base.rotation`) at several `t`, matching the Stage-applied transform
  — for both an oriented and a non-oriented object.

---

## 5. UI

### 5.1 Authoring — draw a guide for the selected object

A store action `addMotionPath(objectId, path: PathData)`:
- Sets `obj.motionPath = { path, orient: false, progress: [<seed>] }`, seeding a default
  progress track of **two keyframes, value 0 → 1**, from the current playhead to playhead +
  1s (snapped to frames), easing `'linear'`. One undo step.
- The path is drawn with the **existing pen tooling** entered via a "Draw motion path" mode:
  with an object selected, the user activates the mode (Toolbar/Inspector), draws a path on the
  Stage exactly as the pen tool draws a vector path, and on commit the points become the guide
  (in stage coordinates) via `addMotionPath`. No new path-drawing math — it reuses
  `usePathTools` / `pathEdit`.

Editing the guide later (moving its nodes) reuses the same path-edit affordances, writing back
to `obj.motionPath.path`; `removeMotionPath(objectId)` clears the field (one undo step).

### 5.2 Inspector — "Motion Path" section

Shown when the selected object has a `motionPath`:
- **Orient to path** checkbox → `setMotionPathOrient(objectId, boolean)` (one undo step).
- **Remove motion path** button → `removeMotionPath`.
- A read-only **progress at playhead** readout (the sampled 0..1), mirroring how geometry/color
  inputs show the resolved value at the playhead.

When no guide exists, the section instead offers **"Draw motion path"** (enters the draw mode).

### 5.3 Timeline — progress lane

A keyframe lane for `motionPath.progress` shows keyframe diamonds, reusing the existing
keyframe-lane rendering. Selecting a diamond sets `selectedProgressKeyframe: { objectId, time }`
(a new selection field alongside `selectedKeyframe` / `selectedShapeKeyframe` /
`selectedColorKeyframe`). Editing progress values uses the ordinary numeric-keyframe authoring
(auto-key at the playhead) so the user can shape acceleration along the path with intermediate
progress keyframes.

### 5.4 Progress-keyframe easing & delete

- The Inspector **Keyframe section** (Feature 1) shows the selected progress keyframe's easing
  via `EasingEditor`; `setSelectedKeyframeEasing` routes to the progress track when a progress
  keyframe is the active selection (extends its existing scalar / shape / color routing).
- Context-aware **Delete** removes the selected progress keyframe (extends the existing
  node → shape-kf → color-kf → scalar-kf priority chain).

### 5.5 Stage — guide overlay

When the selected object has a `motionPath`, the Stage renders the guide as **ghosted editor
chrome** (a dashed path in a token color) with its nodes draggable, plus a marker at the
**current followed position** (the `sampleObject` x/y at the playhead). The overlay is
editor-only — never part of the exported document. Reuses the existing path/correspondence
overlay rendering patterns.

---

## 6. Testing (TDD: engine → parity → RTL → e2e)

**Engine (`geom/arcLength.ts`):** `flattenPath` produces the same polyline as the prior
private flatten (covered transitively by resample's unchanged tests); `pointAtLength` clamps
below 0 / above total and interpolates within a segment; total length is the cumulative sum.

**Engine (`motion.ts`):** `pointAtFraction` at `frac` 0 / 0.5 / 1 on a straight 2-node path and
a curved path; clamps `frac` outside [0,1]; degenerate (empty / zero-length) guards.
`tangentAngleDeg` returns 0° along +x, 90° along +y, correct sign on a curve; endpoint
one-sided difference; degenerate → 0. Immutability (no input mutation).

**Engine (`sample.ts`):** with a `motionPath` + non-empty progress, `sampleObject` overrides
`x`/`y` to the followed point and **ignores** the x/y tracks; with `orient`, overrides
`rotation` to tangent + `base.rotation` and ignores the rotation track; with an **empty**
progress track, no override (ordinary tracks/base stand); scale/opacity/geometry/color
unaffected throughout. `computeProjectDuration` extends to a progress keyframe past the prior end.

**Parity:** `computeFrame` `x`/`y` (and oriented `rotation`) === the `pointAtFraction` /
`tangentAngleDeg` resolution at several `t` (regenerate the runtime bundle); the followed
transform matches Stage == export == runtime.

**RTL:** drawing a guide for the selected object creates `motionPath` with a seeded 0→1
progress track (one undo); toggling **Orient to path** writes `orient` (one undo); removing the
motion path clears the field; selecting a progress keyframe shows its easing and editing it
routes to the progress track; context-aware Delete removes a progress keyframe; the Inspector
shows the resolved progress at the playhead.

**e2e:** select an object → draw a motion path → (default 0→1 progress) → export → the exported
bundle animates the object's position along the path (its `transform` translate changes between
the path endpoints over time); a second case asserts `orient` rotates the object along the path.

---

## 7. Plan decomposition

- **Plan A — engine & pipeline** (pure, TDD): extract `engine/geom/arcLength.ts` from
  `resample.ts` (behavior-preserving; resample re-imports it); `engine/motion.ts`
  (`pointAtFraction` / `tangentAngleDeg`); `MotionPath` type + `motionPath` field;
  `sampleObject` override; `computeProjectDuration` folds in the progress track; export parity;
  regenerate the runtime bundle; **no migration**.
- **Plan B — UI** (RTL + e2e): draw-guide mode + `addMotionPath` (seeded progress) /
  `removeMotionPath` / `setMotionPathOrient`; Inspector "Motion Path" section; timeline progress
  lane + `selectedProgressKeyframe`; progress-keyframe easing (route `setSelectedKeyframeEasing`)
  + context-aware Delete; Stage guide overlay + followed-position marker; motion-path e2e.

Each prefix is shippable: A makes motion paths resolve/export (authorable from tests); A+B
delivers the full authoring experience.

---

## 8. Cross-cutting invariants

- **Preview == export parity** through the shared pure `pointAtFraction`/`tangentAngleDeg`
  inside `sampleObject` → unchanged `applyFrameToNodes`; new parity assertions at several `t`.
- **Optional field only** → no migration / no version bump; default-absent renders today's
  behavior. The override is further gated on a **non-empty** progress track.
- **One undo step per user gesture** (add/remove guide, toggle orient, edit/delete a progress
  keyframe, drag a guide node).
- **Engine stays pure** (no React/DOM); the runtime bundle lifts verbatim and is regenerated.
- **No new render/apply plumbing** — motion paths resolve into the existing `x`/`y`/`rotation`,
  so the transform path is reused unchanged.
- **TDD**: engine oracle tests first, then runtime/parity, then RTL, then e2e.

---

## 9. Fresh-perspective self-review

- **Why extract the arc-length core instead of duplicating it?** Motion paths and arc-length
  morph need the *same* "point at arc-length fraction along the rendered curve" math. One tested
  module prevents drift between morph and motion (e.g. a flatten-step fix benefiting both) and
  keeps `resample` byte-identical under its existing guard tests. ✓
- **Is the x/y override surprising?** It is the established motion-guide model (Flash/Wick), and
  it is gated and documented: only when a guide *and* a non-empty progress track exist. Scale,
  opacity, geometry, and color tracks are untouched; rotation is overridden only under `orient`.
  An empty progress track is an explicit no-op. ✓
- **Does it touch the parity guarantee safely?** Resolution happens in the shared pure
  `sampleObject`; the render/apply path is unchanged (reuses `x`/`y`/`rotation`); absent/empty
  `motionPath` changes nothing. New parity assertions cover the followed path. ✓
- **Why progress-as-track rather than a start/end time pair?** Reusing `Keyframe` + `interpolate`
  + `Easing` gives ease-in/out and mid-path acceleration for free, with zero new interpolation
  code, and slots into the existing keyframe/easing/Delete UI. A fixed start/end would be a
  weaker special case of this. ✓
- **Tangent at endpoints / closed paths?** One-sided finite difference at the ends; closed paths
  wrap through `flattenPath`'s closing segment, so the tangent is continuous around the loop.
  Degenerate paths return 0°. Covered by tests. ✓
- **Scope creep?** Position + optional orient only. Not in scope: motion blur, ease-along-path
  handles distinct from progress easing, multiple objects sharing one guide as a scene entity,
  banking/3D, or rendering the guide in the export. Each is a clean later addition. ✓
- **Migration risk?** None — additive optional field, generic serialization, no version bump
  (so the version-assertion tests are untouched, avoiding that known gotcha). ✓
- **Biggest residual risk.** The draw-guide authoring mode and the Stage guide overlay — UI
  integration reusing `usePathTools` / the correspondence-overlay pattern. Flagged for Plan B,
  covered by RTL + the e2e.
