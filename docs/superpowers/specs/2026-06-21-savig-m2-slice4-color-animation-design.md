# Savig — M2 Slice 4: Fill/Stroke Color Animation (Design)

**Date:** 2026-06-21
**Status:** Approved design — ready for implementation planning
**Author:** Steve Hynding (with Claude)
**Context:** M2 vector tools, Slice 4. The vector foundation (Slice 1) and pen/paths
(Slice 2) explicitly deferred **fill/stroke color animation** to a later slice; the morph
& easing roadmap (Features 1–4) is complete. This slice is the first of the remaining
"Slice 4+" basket (the rest — freehand brush, more primitives, gradients, boolean ops —
stay queued for Slice 5+, each its own cycle).

## Summary

Let a vector object's **`fill` and `stroke` colors animate over the timeline** —
keyframed, interpolated, with per-keyframe easing — preserving preview == export parity.
A color is resolved per-frame by the **same pure resolver** the Stage and the export
runtime share, exactly as transform / geometry / morph already are. The feature reduces to
**one optional field** on `SceneObject` (`colorTracks?`), so old projects load unchanged
with **no migration**.

### Stack & standards (unchanged from M1/M2)

pnpm · Vite · React 18 + TS (strict) · Zustand · Vitest + RTL · Playwright · CSS
Modules + design tokens. Client-only. TDD throughout. The engine layer stays **pure
TypeScript with zero React/DOM dependencies**; the render core lifts verbatim into the
export runtime. Preview == export parity: the editor Stage and the export runtime resolve
colors via the **same** pure `sampleColor`/`sampleObject` and apply them via the **same**
`applyFrameToNodes`.

---

## 1. Where color animation fits

Animated values flow through one pipeline today:
`sampleObject(obj, time) → RenderState → computeFrame → FrameItem → applyFrameToNodes`
(the Stage painter and the export runtime both call `computeFrame`/`applyFrameToNodes`).
Transform, geometry, and morphed `pathD` are all **resolved per-frame** in this pipe.
Color is a new resolved value type in the same pipe — no new mechanism, just a new value.

Scope: color animation applies to **vector objects** (`rect`/`ellipse`/`path`), which carry
top-level `fill`/`stroke`. Imported SVG objects keep their colors inside their sanitized
markup and are out of scope here.

---

## 2. Data model

`SceneObject` gains one **optional** field, parallel to the numeric `tracks` and the
`shapeTrack`:

```ts
export type ColorProperty = 'fill' | 'stroke';

export interface ColorKeyframe {
  time: number;     // seconds
  value: string;    // hex color ('#rgb' / '#rrggbb'), or 'none'
  easing: Easing;   // per-keyframe easing into the next keyframe (reuses Easing)
}

export interface SceneObject {
  // …
  colorTracks?: Partial<Record<ColorProperty, ColorKeyframe[]>>;
}
```

- `colorTracks.fill` / `colorTracks.stroke` each hold ascending-time keyframes.
- The **static base** is the asset's `VectorStyle.fill` / `stroke` (used for a property with
  no color track) — mirroring `tracks`-over-`base` and `shapeTrack`-over-asset-path.
- **Additive optional field** → old projects (absent `colorTracks`) animate no color and
  render their static style. **No migration / no version bump**, consistent with the morph
  features (`morph`/`correspondence`/`nodeEasings`).

---

## 3. Engine

### 3.1 `engine/color.ts` (new, pure)

```ts
function parseHex(c: string): { r: number; g: number; b: number } | null; // #rgb / #rrggbb; else null
function formatHex(rgb: { r: number; g: number; b: number }): string;     // -> '#rrggbb'
function interpolateColor(a: string, b: string, t: number): string;       // RGB lerp
function sampleColor(track: ColorKeyframe[], time: number): string;        // bracket/clamp/easing
```

- `parseHex` accepts `#rgb` and `#rrggbb` (case-insensitive); returns `null` for `'none'`,
  named colors, `rgb(...)`, or malformed input.
- **`interpolateColor`** parses both endpoints, lerps `r`/`g`/`b` (rounded, clamped 0–255) in
  **RGB space** (simple and predictable for v1; HSL/OKLCH deferred), and formats back to
  `#rrggbb`. If **either endpoint is unparseable** (e.g. `'none'`), it **steps** — returns
  `a` for `t < 1`, `b` at `t === 1` — so a color/`none` boundary holds rather than producing
  garbage.
- **`sampleColor`** mirrors `interpolate`'s structure exactly: empty track throws; `time ≤
  first.time → first.value`; `time ≥ last.time → last.value`; otherwise find the bracketing
  pair, `progress = applyEasing(a.easing, rawProgress)`, return `interpolateColor(a.value,
  b.value, progress)`.

### 3.2 `sampleObject` resolves colors onto `RenderState`

`RenderState` gains optional resolved colors:

```ts
interface RenderState extends Transform2D {
  // … objectId, geometry?, path?
  fill?: string;
  stroke?: string;
}
```

`sampleObject` sets `fill`/`stroke` only when `obj.colorTracks?.[prop]` exists and is
non-empty (via `sampleColor`); otherwise leaves them `undefined` (the static style stands).

### 3.3 Duration includes color tracks

`computeProjectDuration` must fold in `colorTracks` keyframe times (as Slice 3 did for
`shapeTrack`), so a color keyframe placed past the current end **extends** the timeline like
any other keyframe.

---

## 4. Render pipeline & parity

- **`FrameItem`** (`runtime/frame.ts`) gains `fill?: string` / `stroke?: string`, populated
  by `computeFrame` from the resolved `RenderState`.
- **`applyFrameToNodes`** sets `fill`/`stroke` on the **inner shape element** (the vector
  wrapper's child), exactly as it already sets geometry attributes and `d`. Absent ⇒ not set
  ⇒ the static style from the initial render stands.
- The **static initial render** (`renderShapeToSvg`) is unchanged — it emits the asset's
  static style; per-frame the resolved color overrides it. (At `t=0` with a color track,
  `applyFrame` immediately paints the first keyframe's color.)
- **Runtime bundle regenerated** (`pnpm build:runtime`). **Export** inlines the vector with
  its static style and the bundled runtime tweens `fill`/`stroke` per-frame — same path as
  animated geometry/`pathD`.
- **Parity assertion:** `computeFrame(...).fill/stroke === sampleColor(track, t)` (and ===
  the Stage-applied value) at several `t`, for both a fill track and a stroke track.

---

## 5. UI

### 5.1 Authoring (auto-key, like geometry)

A store action `setVectorColor(property: ColorProperty, value: string)`:
- **autoKey on** → upsert a `ColorKeyframe` at the snapped playhead in
  `colorTracks[property]` (seeding the keyframe's `easing` to `'linear'`), one undo step.
- **autoKey off** → edit the static `VectorStyle` (today's `setVectorStyle` behavior).

The Inspector fill/stroke `type="color"` inputs (Slice 1) route through `setVectorColor`
instead of `setVectorStyle`, and **display the resolved color at the playhead** (the
`sampleObject` `fill`/`stroke` when a track exists, else the static style) — mirroring how
the geometry inputs already show sampled values. The fill/stroke enable toggles (`'none'`)
keep using `setVectorStyle` (a static structural change, not an animatable value); animating
a property requires it enabled (its color input is disabled while `'none'`).

### 5.2 Timeline color-keyframe lane

A lane per animated color property (fill / stroke) shows keyframe diamonds, reusing the
existing keyframe-lane rendering. Selecting a diamond sets `selectedColorKeyframe:
{ objectId, property, time }` (a new selection field alongside `selectedKeyframe` /
`selectedShapeKeyframe`).

### 5.3 Color-keyframe easing & delete

- The Inspector **Keyframe section** (Feature 1) shows the selected color keyframe's easing
  via `EasingEditor`; `setSelectedKeyframeEasing` routes to the color track when a color
  keyframe is the active selection (mirroring its existing scalar-vs-shape routing).
- Context-aware **Delete** removes the selected color keyframe (extends the existing
  node → shape-kf → scalar-kf priority chain).

---

## 6. Testing (TDD: engine → parity → RTL → e2e)

**Engine (`color.ts`):** `parseHex` (`#rgb`/`#rrggbb`/invalid→null); `formatHex` round-trip;
`interpolateColor` midpoint RGB lerp, clamps, and **steps** when an endpoint is
`'none'`/unparseable; `sampleColor` bracket/clamp/single-keyframe/easing; immutability.
`sampleObject` sets `fill`/`stroke` only when a track exists. `computeProjectDuration`
extends to a color keyframe placed past the prior end.

**Parity:** `computeFrame` `fill`/`stroke` === `sampleColor` at several `t` for a fill track
and a stroke track (regenerate the runtime bundle); `applyFrameToNodes` sets the attrs on the
inner shape element.

**RTL:** changing the fill color with autoKey **on** writes a color keyframe (one undo);
with autoKey **off** edits the static style; selecting a color keyframe shows its easing;
editing the easing routes to the color track; context-aware Delete removes it.

**e2e:** draw a rect → keyframe its fill at two times (different colors) → export → the
exported bundle's `fill` animates between the two colors.

---

## 7. Plan decomposition

- **Plan A — engine & pipeline** (pure, TDD): `ColorProperty`/`ColorKeyframe` types +
  `colorTracks` field; `engine/color.ts` (`parseHex`/`formatHex`/`interpolateColor`/
  `sampleColor`); `sampleObject` color resolution; `computeProjectDuration` folds in
  `colorTracks`; `FrameItem` `fill`/`stroke` + `applyFrameToNodes`; runtime bundle
  regenerated; export parity; **no migration**.
- **Plan B — UI** (RTL + e2e): `setVectorColor` auto-key + Inspector color inputs;
  `selectedColorKeyframe` selection + timeline color-keyframe lane; color-keyframe easing
  (route `setSelectedKeyframeEasing`) + context-aware Delete; color e2e.

Each prefix is shippable: A makes color tracks resolve/export (authorable from tests);
A+B delivers the full authoring experience.

---

## 8. Cross-cutting invariants

- **Preview == export parity** through the shared pure `sampleColor`/`sampleObject` →
  `applyFrameToNodes`; new parity assertions at several `t`.
- **Optional field only** → no migration / no version bump; default-absent renders today's
  static style.
- **One undo step per user gesture** (set color / auto-key, edit easing, delete keyframe).
- **Engine stays pure** (no React/DOM); the runtime bundle lifts verbatim and is regenerated.
- **TDD**: engine oracle tests first, then runtime/parity, then RTL, then e2e.

---

## 9. Fresh-perspective self-review

- **Why a separate `colorTracks`, not the numeric `tracks`?** `Keyframe.value` is a number;
  colors are strings with their own interpolation. A parallel string-valued track keeps the
  numeric model clean and the color resolver isolated. ✓
- **Does it touch the parity guarantee safely?** Color flows through the existing
  resolved-value pipe; absent `colorTracks` changes nothing (static style stands). New parity
  assertions cover the animated path. ✓
- **`none` / unparseable handling?** `interpolateColor` steps rather than interpolating a
  non-color, so a color↔none boundary holds cleanly. ✓
- **Interpolation space?** RGB for v1 (predictable, matches the hex-only style input); HSL/
  OKLCH and alpha deferred. ✓
- **Scope creep?** Vector objects only; fill+stroke only; hex only. Gradients, color spaces,
  alpha, and SVG-import color are explicitly out. ✓
- **Migration risk?** None — additive optional field, generic serialization, no version bump
  (so the version-assertion tests are untouched, avoiding that known gotcha). ✓
- **Biggest residual risk.** The `setVectorColor` auto-key vs static-style split (autoKey
  on/off) and the color-keyframe selection/easing/Delete plumbing — UI integration, covered
  by RTL + the e2e. Flagged for Plan B.
