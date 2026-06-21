# Savig — Unified Keyframe Easing-Editing UI (Design)

## Summary

Feature 1 of the [M2 Morph & Easing Roadmap](./2026-06-20-savig-m2-morph-easing-roadmap-design.md).
Gives the user a way to **edit the `easing` of any selected keyframe** — scalar
(`Keyframe`) or shape (`ShapeKeyframe`) — through preset buttons and a draggable
cubic-bezier curve, surfaced as a **"Keyframe" detail section in the Inspector**.

This is a **pure-UI feature with zero engine, data-model, or persistence change**.
The data already carries `easing: Easing` (including `CubicBezierEasing`) on both
`Keyframe` (`types.ts:33`) and `ShapeKeyframe` (`types.ts:124`); `applyEasing`
(`easing.ts:63`) already evaluates every variant; and `interpolate` (`interpolate.ts:39`)
and `samplePath` (`path.ts:113`) already consume it. We are only adding a way to
**write** the value that is already read, interpolated, serialized, and exported.

As a discovered fold-in, the same per-keyframe detail section becomes the home for
the otherwise-orphaned `Keyframe.rotationMode` (`types.ts:38`), which also has no
editor today.

### Stack & standards (unchanged)

pnpm · Vite · React 18 + TS (strict) · Zustand · Vitest + RTL · Playwright ·
CSS Modules + design tokens. Client-only. TDD throughout. No engine change, so the
engine's purity and the export-runtime parity surface are untouched.

---

## Scope

### In scope

- An **`EasingEditor`** widget: preset buttons (`linear · easeIn · easeOut ·
  easeInOut · custom`) plus an SVG curve canvas that plots the **actual**
  `applyEasing(value, t)` and, in `custom` mode, exposes two draggable bezier
  control handles writing a `CubicBezierEasing`.
- An Inspector **"Keyframe"** section, shown when a scalar or shape keyframe is
  selected, embedding the `EasingEditor` and (for rotation-track keyframes) a
  `rotationMode` toggle.
- Store actions `setSelectedKeyframeEasing` / `setSelectedKeyframeRotationMode`
  that route to the active selection (scalar track vs shape track), one undo step each.
- `selectKeyframe` / `selectShapeKeyframe` also set `selectedObjectId` so the
  Inspector reliably shows the section.

### Out of scope

- Any engine/interpolation change (already supports all easings).
- Any persistence/migration change (`easing` and `rotationMode` already serialize).
- Per-**node** easing (roadmap feature 4), morph features (2, 3).
- Easing on properties other than per-keyframe (e.g. global/track-level easing).
- A library of extra named cubic-bezier presets beyond the four engine names plus
  `custom` (YAGNI; the curve covers every other case).

---

## 1. Architecture

No new layer; a new UI component plus Inspector/store wiring:

```
UI layer   EasingEditor (new component) · Inspector "Keyframe" section ·
           store: setSelectedKeyframeEasing / setSelectedKeyframeRotationMode ·
           selectKeyframe/selectShapeKeyframe also select the object
Engine     (unchanged — applyEasing/interpolate/samplePath already consume easing)
Services   (unchanged — easing/rotationMode already serialize & export)
```

**Why no engine work:** `applyEasing` already maps any `Easing` → eased progress,
and both interpolators call it. Storing a `cubicBezier` object on a keyframe already
animates and exports correctly today; there has simply been no UI to author it.

---

## 2. Data model

**No changes.** For reference, the relevant existing shapes:

```ts
type EasingName = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';
interface CubicBezierEasing { type: 'cubicBezier'; p1; p2; p3; p4 }   // p1..p4 = x1,y1,x2,y2
type Easing = EasingName | CubicBezierEasing;

interface Keyframe { time; value; easing: Easing; rotationMode?: 'shortest' | 'raw' }
interface ShapeKeyframe { time; path; easing: Easing }
```

The editor reads/writes the `easing` field in place; `rotationMode` likewise. No
version bump, no migration.

---

## 3. `EasingEditor` component

`src/ui/components/EasingEditor/EasingEditor.tsx` (+ `.module.css`, `.test.tsx`).

```ts
interface EasingEditorProps {
  value: Easing;
  onChange: (next: Easing) => void;
  /** When true, the value governs no outgoing segment (last keyframe); shows a hint. */
  inert?: boolean;
}
```

### Presets row

Five buttons: `linear`, `easeIn`, `easeOut`, `easeInOut`, `custom`. The active button
is derived from `value`: a string matches its name; an object → `custom`. Clicking a
named preset calls `onChange(name)`. Clicking `custom` seeds a `CubicBezierEasing`
(default `{ type:'cubicBezier', p1:0.42, p2:0, p3:0.58, p4:1 }`) **only if** `value`
is not already an object, and reveals the handles.

### Curve canvas

An SVG drawn in a unit square (y-up visually; t→right). It plots
`y = applyEasing(value, t)` sampled at ~24 points as a polyline/path — **truthful for
every easing type** because it samples the real solver, so the preview cannot drift
from playback or export.

In `custom` mode two draggable control points are overlaid:

- `P1 = (p1, p2)`, `P2 = (p3, p4)`.
- Dragging updates the corresponding pair and calls `onChange(cubicBezier)`.
- **x clamped to `[0,1]`** (`p1`, `p3`) — the Newton/bisection solver in `easing.ts`
  assumes monotonic x. **y unclamped** (`p2`, `p4`) within a sane display range (e.g.
  `[-0.5, 1.5]`) so overshoot/anticipation ("back") curves are authorable; the curve
  canvas pads its viewport to show overshoot.
- Pointer math uses the canvas CTM (same approach as Stage node drag); a single
  `onChange` per pointer move, consistent with the app's commit-on-gesture model.

### Accessibility

Control points are `role="slider"`/focusable elements with `aria-label`s
("ease control point 1 x", …); arrow keys nudge by a small step (Shift = larger).
Preset buttons are real `<button>`s with `aria-pressed`.

### Read-back

A line shows the preset name or `cubic-bezier(p1, p2, p3, p4)` (rounded), so the exact
value is legible and testable.

---

## 4. Inspector "Keyframe" section

Rendered in `Inspector.tsx` when the store has a `selectedKeyframe` **or**
`selectedShapeKeyframe` that resolves to a keyframe on the selected object.

- **Resolution.** From `selectedShapeKeyframe` → find the object's `shapeTrack`
  entry at `time`. From `selectedKeyframe` → find `obj.tracks[property]` entry at
  `time`. (Times are frame-snapped on creation; match with the existing `KF_EPS`
  tolerance used in `Inspector.tsx:7`.)
- **Header.** `"{property} @ {time}s"` for scalar, `"shape @ {time}s"` for shape.
- **Body.** `<EasingEditor value={kf.easing} onChange={setSelectedKeyframeEasing}
  inert={isLastInTrack} />`.
- **rotationMode.** When the selected scalar keyframe is on the `rotation` track,
  a `shortest / raw` segmented toggle bound to `setSelectedKeyframeRotationMode`
  (defaults to `shortest` when the field is absent, matching `interpolate.ts:44`).
- **Inert hint.** When the keyframe is the **last** in its track, a small note:
  "easing applies to the segment into the next keyframe" — the value is editable but
  has no animated effect (consistent with how `interpolate`/`samplePath` use the
  *from* keyframe's easing).

The section sits after the existing Transform/Geometry/Path/Style groups, reusing the
`styles.group` / `styles.row` classes.

---

## 5. Store actions

Added to `store.ts`, following the `removeSelectedKeyframe` pattern (`store.ts:401`):

```ts
setSelectedKeyframeEasing(easing: Easing): void
```

- If `selectedShapeKeyframe`: find obj; map its `shapeTrack` replacing the entry at
  `time` with `{ ...kf, easing }`; `commit(replaceObject(...))`.
- Else if `selectedKeyframe`: find obj; map `tracks[property]` replacing the entry at
  `time` with `{ ...kf, easing }`; `commit(...)`.
- No-op if neither selection resolves. One undo step. Selection is preserved (the
  keyframe stays selected so the user can keep tuning).

```ts
setSelectedKeyframeRotationMode(mode: 'shortest' | 'raw'): void
```

- Applies only when `selectedKeyframe.property === 'rotation'`; replaces that
  keyframe's `rotationMode`. One undo step.

```ts
// selectKeyframe / selectShapeKeyframe now also set selectedObjectId:
selectKeyframe(ref)      → set({ selectedKeyframe: ref, selectedShapeKeyframe: null,
                                 selectedObjectId: ref?.objectId ?? selectedObjectId })
selectShapeKeyframe(ref) → symmetric
```

Setting `selectedObjectId` on keyframe-select ensures the Inspector (which
early-returns without a selected object, `Inspector.tsx:92`) shows the Keyframe
section even if the user clicks a diamond on a not-yet-selected row. Existing Timeline
tests that assert selection state are updated to expect the object also being selected.

---

## 6. Error handling & edge cases

- **No keyframe selected** → no Keyframe section (the rest of the Inspector is
  unchanged).
- **Selected keyframe not found** (e.g. removed) → section not rendered; actions no-op.
- **Last keyframe in a track** → easing editable but inert; hint shown (§4).
- **x out of range during drag** → clamped to `[0,1]` so the solver stays monotonic.
- **y overshoot** → allowed; produces anticipation/overshoot, which the curve canvas
  visualizes by padding its viewport.
- **Switching preset ↔ custom** → named→custom seeds a default bezier; custom→named
  discards the bezier for the named value (expected; the read-back makes it explicit).
- **rotationMode on non-rotation track** → toggle not shown; field never written.

---

## 7. Testing strategy (TDD)

**EasingEditor (RTL, no store):**
- Renders five preset buttons; the one matching `value` is `aria-pressed`.
- Clicking a named preset calls `onChange` with that name.
- Clicking `custom` calls `onChange` with a `cubicBezier` and reveals handles.
- Dragging a handle calls `onChange` with a `cubicBezier` whose params reflect the
  pointer delta (x clamped to `[0,1]`).
- The plotted curve path reflects `value` (e.g. differs between `linear` and `easeIn`).
- Keyboard: focusing a handle and pressing arrows nudges the param.
- `inert` shows the hint.

**Store (unit):**
- `setSelectedKeyframeEasing` with a scalar selection rewrites only that track's
  keyframe easing; with a shape selection rewrites only the shape keyframe; one undo
  step (undo restores prior easing); no-op when nothing selected.
- `setSelectedKeyframeRotationMode` writes only on a rotation-track keyframe.
- `selectKeyframe` / `selectShapeKeyframe` set `selectedObjectId`.

**Inspector (RTL):**
- Keyframe section appears with the correct header for a scalar selection and a shape
  selection; absent when no keyframe is selected.
- Editing via the embedded editor commits the new easing.
- rotationMode toggle appears only for a rotation-track keyframe and writes the mode.
- Inert hint shown for the last keyframe in a track.

**E2E (Playwright, light):**
- Create an object with two `x` keyframes; select the first; set `easeIn` via the
  editor; assert the sampled `x` at the segment midpoint differs from the linear
  midpoint, and that the value persists across a save/load (or export) round-trip.

---

## 8. Performance

Negligible. The curve canvas samples `applyEasing` ~24× on render and on drag; drag
emits one `onChange` per pointer move (React batches; commit-on-gesture). No per-frame
or playback-path cost is added.

---

## 9. Plan decomposition (for writing-plans)

A single UI-only plan, built test-first in this order:

1. **`EasingEditor` component** — curve plot from `applyEasing`, preset row, custom
   handles with clamped-x drag + keyboard, read-back; component tests.
2. **Store actions** — `setSelectedKeyframeEasing`, `setSelectedKeyframeRotationMode`;
   `selectKeyframe`/`selectShapeKeyframe` also select the object; unit tests
   (incl. updating affected Timeline selection tests).
3. **Inspector "Keyframe" section** — resolution from selection, header, embed editor,
   rotationMode toggle, inert hint; Inspector tests.
4. **E2E** — set easing on a keyframe; assert non-linear sampling + persistence.

---

## 10. Open questions / deferred

- **Extra named presets** (CSS `ease`, `back`, …) — deferred; the curve covers them.
- **Copy/paste easing between keyframes** — deferred convenience.
- **Multi-keyframe easing edit** (apply to a selection of keyframes) — deferred;
  single-selection only this feature.
- **Easing on the export side** — none needed; already routed through `applyEasing`.
