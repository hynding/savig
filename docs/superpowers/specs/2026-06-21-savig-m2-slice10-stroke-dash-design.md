# M2 Slice 10 — Stroke Dash & Self-Drawing Animation (design)

Date: 2026-06-21
Status: design approved (decisions delegated to implementer; see §10)
Predecessor: Slice 9 — animated gradients (merged `3c8f9df`)

## 1. Goal

Give a vector object a **dashed stroke** and **animate `stroke-dashoffset`** over
the timeline — the iconic "self-drawing path" effect (animated logos, signatures,
icon line-draws), plus "marching ants" for free from a looping offset. A one-click
**Draw-on** seeds the keyframes.

This is the first stroke-*paint-style* animation and the **fifth** "animate-a-thing"
seam on `SceneObject` after `shapeTrack` (Slice 3), `colorTracks` (Slice 4),
`motionPath` (Slice 5), and `gradientTracks` (Slice 9).

Non-goals (deferred, tracked in §11): animating `stroke-dasharray` itself; per-dash
segment control; real-length (perimeter) readouts; boolean ops (gated on multi-select
= M4); on-canvas gradient handles.

## 2. Design principles (inherited)

Same shape as every prior animation seam:

- an **optional field on `SceneObject`** (`dashOffsetTrack?: Keyframe[]`), absent by default;
- resolved in **`sampleObject`** onto `RenderState` only when present & non-empty;
- the static `VectorStyle` value stands when the track is absent;
- **no persistence migration** (optional fields, generic JSON serialize, stays v4);
- **preview == export == runtime**, enforced by the runtime↔engine parity test;
- **`computeProjectDuration` folds the new track** (the explicit lesson from Slice 9,
  where a forgotten duration fold meant a track-only animation held t=0 on export).

`stroke-dashoffset` is reused as a plain scalar `Keyframe[]` track (reusing
`interpolate`/`applyEasing`), NOT a new `AnimatableProperty` — it is a paint-style
property, not a transform, so it does not belong in `base: Transform2D`.

## 3. Data model

On `VectorStyle` (`src/engine/types.ts`), static base:

```ts
  /** Dash pattern in pathLength-normalized units (0..1). Absent = solid stroke. */
  strokeDasharray?: number[];
  /** Static dash phase in pathLength-normalized units. Absent = 0. */
  strokeDashoffset?: number;
```

On `SceneObject`, the animation track (alongside `gradientTracks`):

```ts
  /** Animated stroke-dashoffset (pathLength-normalized). A non-empty track
   *  overrides the static VectorStyle.strokeDashoffset. */
  dashOffsetTrack?: Keyframe[];
```

`Keyframe` already exists (`{ time, value, easing, rotationMode? }`); the
`rotationMode` field is simply unused here.

## 4. Normalization — `pathLength="1"`

Whenever `strokeDasharray` is present, the rendered shape element carries
`pathLength="1"`, so `stroke-dasharray` and `stroke-dashoffset` are interpreted in
units where the **total path length == 1**, uniformly for `rect`/`ellipse`/`path`
(no perimeter computation). A solid object (no dasharray) emits neither
`stroke-dasharray`, `stroke-dashoffset`, nor `pathLength`.

`strokeDasharray` serializes to a space-joined string (e.g. `[1, 1]` → `"1 1"`).

## 5. Pipeline

### 5.1 Static markup — `renderShape.ts`

`renderShapeToSvg`/`styleToSvgAttrs` gain an optional `dashOffset?: number` param
(the resolved offset to bake in; threaded like `gradientPaint`). Emit, **only when
`style.strokeDasharray` is present and non-empty**:
- `stroke-dasharray="<space-joined dasharray, each via fmt>"`
- `pathLength="1"`
- `stroke-dashoffset="<fmt(dashOffset ?? style.strokeDashoffset ?? 0)>"`

These go on the shape element (rect/ellipse/path) alongside the existing stroke attrs.
A solid object (no dasharray) emits none of the three.

### 5.2 `RenderState` + `sampleObject` (`src/engine/sample.ts`)

Add `strokeDashoffset?: number` to `RenderState`. In `sampleObject`, after the
gradient block:

```ts
if (obj.dashOffsetTrack && obj.dashOffsetTrack.length > 0) {
  state.strokeDashoffset = interpolate(obj.dashOffsetTrack, time);
}
```

### 5.3 `FrameItem` + `computeFrame` (`src/runtime/frame.ts`)

`FrameItem` gains `strokeDashoffset?: number`. In `computeFrame`, set
`item.strokeDashoffset = fmt(state.strokeDashoffset)` when `state.strokeDashoffset`
is defined. (Like geometry/fill, the FrameItem carries the formatted string the DOM
attribute needs.)

### 5.4 `applyFrameToNodes` (runtime + editor painter)

When `item.strokeDashoffset` is present, set it on the shape (`node.firstElementChild`):

```ts
if (item.strokeDashoffset !== undefined) {
  const shape = node.firstElementChild;
  if (shape) shape.setAttribute('stroke-dashoffset', item.strokeDashoffset);
}
```

The runtime bundle is regenerated (`pnpm build:runtime`). The static markup already
carries `pathLength="1"` + `stroke-dasharray` (from §5.1, baked once); only
`stroke-dashoffset` changes per frame.

### 5.5 Export (`renderDocument.ts`)

`renderDocument` passes the **t=0 sample** as the `dashOffset` override to
`renderShapeToSvg`: since it already calls `sampleProject(project, 0)`, just pass
`state.strokeDashoffset` (present only when a track exists; falls back to
`style.strokeDashoffset` inside `styleToSvgAttrs` otherwise). This bakes the correct
frame-0 offset into the static markup (export-at-0 parity, like shapeTrack/color/gradient),
avoiding an initial-frame flash before the runtime applies frame 0.

### 5.6 Duration (`duration.ts`)

`computeProjectDuration` folds `dashOffsetTrack`:

```ts
for (const keyframe of obj.dashOffsetTrack ?? []) {
  if (keyframe.time > max) max = keyframe.time;
}
```

## 6. Parity

The runtime↔engine parity test gains a case: an object with a `dashOffsetTrack`,
sampled at an interior time, asserts `computeFrame(...).strokeDashoffset ===
fmt(interpolate(track, t))` and that `applyFrameToNodes` sets the shape's
`stroke-dashoffset` attribute to that value.

## 7. Authoring UI (Plan B)

- **Store** (`src/ui/store/store.ts`):
  - `setStrokeDasharray(dasharray: number[] | undefined)` — thin wrapper over
    `setVectorStyle({ strokeDasharray })` (undefined clears it, reverting to solid).
  - `setStrokeDashoffset(value: number)` — mirrors `setVectorColor`/`setMotionProgress`:
    autoKey ON → upsert a `Keyframe` (via `upsertKeyframe`) into `dashOffsetTrack` at the
    snapped playhead (one undo step); autoKey OFF → `setVectorStyle({ strokeDashoffset: value })`.
  - `drawOn()` — convenience: set `strokeDasharray=[1,1]` on the asset AND seed
    `dashOffsetTrack` with two keyframes `value 1 @ snapped playhead` and `value 0 @ +1s`
    (one atomic commit). Reuses `createKeyframe`. If the object has no stroke, still
    applies (the user can enable a stroke); v1 does not auto-enable the stroke.
  - `DashKeyframeRef = { objectId; time }`; `selectedDashKeyframe`;
    `selectDashKeyframe`/`removeSelectedDashKeyframe`; reset `selectedDashKeyframe` in
    every `select*` action (parallel to `selectedGradientKeyframe`).
  - `setSelectedKeyframeEasing` routes to `dashOffsetTrack` when a dash keyframe is selected.
  - **Delete chain** gains dash (order: progress → gradient → color → dash → shape → scalar;
    selections are mutually exclusive so order is not load-bearing — keep it deterministic).
- **Inspector** (`Inspector.tsx`): the Style section gains
  - a dash toggle/field (e.g. a checkbox that sets `strokeDasharray=[1,1]` / clears it,
    or a small dash-pattern text input — v1: a checkbox "dashed"),
  - a **Draw on** button (calls `drawOn()`),
  - a `strokeDashoffset` `NumberField` showing the **sampled** value
    (`sampled.strokeDashoffset ?? style.strokeDashoffset ?? 0`) and writing through
    `setStrokeDashoffset` (auto-keys), and
  - a Dash keyframe section (selected dash keyframe → `EasingEditor` + delete button),
    parallel to the gradient/color keyframe sections.
- **Timeline** (`Timeline.tsx`): a `.dashDiamond` lane for `dashOffsetTrack` keyframes
  (new `--color-dash` token), testid `dash-keyframe-<objId>-<time>`; click selects the
  `DashKeyframeRef`.
- **Stage** (`Stage.tsx`): the shape already renders from the asset style; add
  `strokeDasharray`/`pathLength`/`strokeDashoffset` to BOTH shape branches, reading the
  **sampled** dashoffset (`sampled.strokeDashoffset ?? style.strokeDashoffset`) so the
  paused/scrubbed preview matches; playback updates it imperatively via `applyFrameToNodes`.
  (Do NOT collide with the decorative editor-chrome dasharrays already on overlay paths —
  those are separate overlay elements, not the object shape.)

## 8. Persistence

No migration. `strokeDasharray`/`strokeDashoffset`/`dashOffsetTrack` are optional;
absent → byte-identical to today. Project stays **v4**. (Runtime bundle regen is a
build artifact, not a persistence change.)

## 9. Testing

- **Engine unit:** `renderShape.test.ts` — dasharray present → emits
  `stroke-dasharray`/`pathLength="1"`/`stroke-dashoffset`; absent → none of them.
  `sample.test.ts` — `dashOffsetTrack` → `state.strokeDashoffset`; absent → undefined.
  `duration.test.ts` — dash keyframe extends duration.
- **Pipeline unit:** `frame.test.ts` — `computeFrame` sets `item.strokeDashoffset =
  fmt(interpolate(...))`; `applyFrameToNodes` sets the attr; parity test.
- **Store unit:** `setStrokeDashoffset` autoKey-on upserts / off writes static; `drawOn`
  seeds `[1,1]` + two keyframes 1→0; remove; easing routing; delete chain.
- **Inspector/Timeline unit:** dash field + Draw-on render; dashoffset NumberField shows
  sampled value + auto-keys; Timeline dash lane diamond selects the ref.
- **e2e (Playwright, real chromium):** draw a path → enable stroke + dashed → click
  **Draw on** → export → assert the exported shape has `pathLength="1"` +
  `stroke-dasharray` AND the runtime animates `stroke-dashoffset` across two times
  (sample two times, assert the attribute changes).

## 10. Decisions (delegated to implementer, recorded)

1. **Slice = stroke dash + animated dashoffset** (iconic self-drawing effect, single-object;
   boolean ops gated on multi-select/M4; gradient handles lower-impact).
2. **`dashOffsetTrack?: Keyframe[]`** (dedicated scalar track, reuses Keyframe/interpolate;
   not an AnimatableProperty since it's a paint-style prop, not a transform).
3. **`pathLength="1"` normalization** — uniform dash units, no perimeter math.
4. **Only `dashoffset` animates** (dasharray static — animating it deferred).
5. **Draw-on helper** seeds `[1,1]` + 1→0 keyframes over `[playhead, +1s]`.
6. **Two plans** A (engine/pipeline) + B (UI), inline-TDD + reviewer subagents.

## 11. Deferred (tracked)

- Animating `stroke-dasharray` (pattern morph).
- Real-length (perimeter) readout / un-normalized dash units; explicit dash-pattern editor
  (multiple dashes/gaps with a text field).
- Auto-enabling a stroke when Draw-on is clicked on a fill-only object.
- Dash-phase line-cap nuances; per-segment dash control.
- Boolean ops (gated on multi-select = M4); on-canvas gradient handles; gradient morphing.
- Multi-select / grouping (M4).
