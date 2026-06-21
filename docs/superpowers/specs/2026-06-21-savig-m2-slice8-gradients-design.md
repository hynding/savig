# M2 Slice 8 — Gradients (linear + radial fills/strokes)

**Status:** Design approved (user delegated choices 2026-06-21)
**Date:** 2026-06-21
**Milestone:** M2 (Vector drawing tools), Slice 8
**Predecessors:** Slices 1–7 complete & merged. Reuses the Slice-4 color
infrastructure (`engine/color.ts`) and the additive-optional-field persistence
pattern (`shapeTrack`/`colorTracks`/`motionPath`).

## 1. Goal

Let a vector object's **fill** and/or **stroke** be painted with a **gradient**
(linear or radial) instead of a solid color. Gradients are **static** this slice
(stops and gradient geometry do not animate); animating stops is a clean
follow-up that reuses this slice's data model plus the Slice-4 color seam.

Success: a user assigns a linear or radial gradient to a shape's fill/stroke in
the Inspector, sees it on the Stage, and the exported HTML5 bundle renders the
identical gradient (preview == export). It persists across save/load.

## 2. Non-goals (deferred, tracked)

- **Animated gradient stops** (color/offset/opacity keyframing) — next slice.
- **Animated gradient geometry** (moving endpoints over time).
- **On-canvas gradient handles** (drag endpoints/focal on the Stage). Inspector-only editing this slice.
- **Per-stop opacity Inspector control** (data model + emitter support it; UI deferred).
- `gradientUnits: userSpaceOnUse`, `spreadMethod` (repeat/reflect), `gradientTransform`.
- Gradients on imported SVG assets (vector objects only).
- HSL/OKLCH stop interpolation, named/`currentColor` stops (hex + per-stop opacity only).

## 3. Approach (chosen)

**Additive optional fields on `VectorStyle`.** A gradient is a *paint* attached
to a property; when present it overrides that property's solid color (and any
color track). This mirrors how `colorTracks`/`shapeTrack`/`motionPath` were added
— optional fields on the existing object graph, serialized generically, **no
migration / no version bump (stays v4)**.

Rejected alternatives:
- **Paint union** (`fill: string | Gradient`): cleaner long-term but ripples
  through `styleToSvgAttrs`, `sampleColor`, color tracks, escaping, and the
  Inspector for no slice-8 benefit. Deferred as a possible later refactor.
- **Animate stops now**: a second slice's worth of surface (per-frame defs,
  FrameItem fields, runtime apply, timeline lanes).

### 3.1 Gradient units = `objectBoundingBox` (SVG default)

Gradient geometry is expressed in **0..1 fractions of the shape's bounding box**.
This is the SVG default (we emit no `gradientUnits` attribute) and means the
gradient **auto-fits the shape regardless of animated geometry or morphing** —
no per-frame recompute, which is precisely why static gradients need **zero
runtime/bundle changes**.

## 4. Data model (`engine/types.ts`)

```ts
export interface GradientStop {
  /** 0..1 position along the gradient. */
  offset: number;
  /** Hex color ('#rgb' / '#rrggbb'). */
  color: string;
  /** 0..1; omitted = 1 (fully opaque). */
  opacity?: number;
}

export interface LinearGradient {
  type: 'linear';
  /** Endpoints in objectBoundingBox units (0..1). Default horizontal L→R. */
  x1: number; y1: number; x2: number; y2: number;
  stops: GradientStop[];
}

export interface RadialGradient {
  type: 'radial';
  /** Center + radius in objectBoundingBox units (0..1). */
  cx: number; cy: number; r: number;
  /** Optional focal point (defaults to center). */
  fx?: number; fy?: number;
  stops: GradientStop[];
}

export type Gradient = LinearGradient | RadialGradient;
```

`VectorStyle` gains two optional fields:

```ts
export interface VectorStyle {
  fill: string;            // unchanged — solid fallback / used when no gradient
  stroke: string;          // unchanged
  strokeWidth: number;
  strokeLinecap?: ...;
  strokeLinejoin?: ...;
  /** When present, fill is painted with this gradient (overrides `fill` + any fill color track). */
  fillGradient?: Gradient;
  /** When present, stroke is painted with this gradient (overrides `stroke` + any stroke color track). */
  strokeGradient?: Gradient;
}
```

Defaults when a user switches a property to a gradient:
- **Linear:** `{ x1:0, y1:0.5, x2:1, y2:0.5 }` (horizontal left→right), two stops
  `[{offset:0, color:<current solid or #000000>}, {offset:1, color:#ffffff}]`.
- **Radial:** `{ cx:0.5, cy:0.5, r:0.5 }`, same default two stops.

## 5. Engine: `engine/gradient.ts` (new, pure)

The parity oracle for gradient markup. Pure, deterministic, framework-free; all
numbers through `fmt`, all colors through `escapeAttr` (defense-in-depth even
though stops are validated hex).

```ts
/** Reference string for a gradient by id, e.g. paintRef('g') === 'url(#g)'. */
export function paintRef(id: string): string;

/** Emit a <linearGradient>/<radialGradient> def with <stop> children.
 *  No gradientUnits attribute (objectBoundingBox default). offset/opacity clamped 0..1. */
export function gradientToSvg(id: string, g: Gradient): string;
```

`gradientToSvg` output shape (linear example):
```
<linearGradient id="<id>" x1=".." y1=".." x2=".." y2=".."><stop offset=".." stop-color=".." [stop-opacity=".."]/>...</linearGradient>
```
Radial uses `<radialGradient id cx cy r [fx] [fy]>`. `stop-opacity` emitted only
when `< 1`. Re-exported from the `engine/index.ts` barrel.

### Id scheme (document-unique)
`savig-grad-<objectId>-fill` and `savig-grad-<objectId>-stroke`. `objectId` is a
uuid → safe in an id and unique per object/property.

## 6. Render seam

**Invariant preserved:** the shape element stays the wrapper `<g>`'s
`firstElementChild` everywhere (export, Stage, runtime), so `applyFrameToNodes`
is untouched. Therefore gradient `<defs>` are emitted **separately** from the
shape element, never as a child before it.

### 6.1 `renderShapeToSvg` (`engine/renderShape.ts`)
Add an optional `idScope?: string` parameter. `styleToSvgAttrs` becomes
gradient-aware:
- `fill = style.fillGradient && idScope ? paintRef('savig-grad-<idScope>-fill') : style.fill`
- `stroke = style.strokeGradient && idScope ? paintRef('savig-grad-<idScope>-stroke') : style.stroke`

It still returns **only** the shape element string (firstElementChild-safe). The
gradient defs are produced by the caller via `gradientToSvg`.

### 6.2 Export (`services/export/renderDocument.ts`)
For each vector object whose style has `fillGradient`/`strokeGradient`, append
`gradientToSvg('savig-grad-<obj.id>-fill', g)` / `-stroke` to the **top-level
`<defs>`** (where SVG symbols already live), and pass `obj.id` as `idScope` to
`renderShapeToSvg`.

### 6.3 Editor Stage (`ui/components/Stage/Stage.tsx`)
Render the gradient via React as `<linearGradient>/<radialGradient>` with `<stop>`
children, using the **same id scheme** `savig-grad-<obj.id>-fill|stroke`, placed
**as a sibling after the shape** inside the object `<g>` (never before — the shape
must stay `firstElementChild`). Set the shape's `fill`/`stroke` to `url(#…)` when a
gradient is present. (A `<linearGradient>` is referenceable by id from anywhere in
the document; it does not need to live in a `<defs>` block.)

### 6.4 Load-bearing guard — `computeFrame` (`runtime/frame.ts`)
**Suppress `item.fill` when `fillGradient` is present (and `item.stroke` when
`strokeGradient` is present).** Otherwise a stale fill/stroke color track's
per-frame hex would clobber the `url(#…)` reference via `applyFrameToNodes`,
breaking the gradient. The gradient always wins.

No new `FrameItem` field. No runtime bundle regeneration (static gradients are
baked into the initial export markup and never updated per-frame).

## 7. Color-track interaction (Inspector-enforced + engine-guarded)

Per property, a paint is **either** a solid color (optionally animated via a
color track) **or** a gradient — mutually exclusive:
- Switching a property to a gradient sets `fillGradient`/`strokeGradient`. The
  existing color track is left in the data but **ignored** (gradient wins via §6.4).
- Switching back to Solid clears the gradient field; the solid `fill`/`stroke`
  (and any retained color track) applies again.
- The Inspector shows gradient controls XOR solid-color controls per property.

## 8. UI (`ui/store/store.ts`, `ui/components/Inspector/`)

New store actions (single undo step each, commit-on-blur where applicable):
- `setFillGradient(g: Gradient | undefined)` / `setStrokeGradient(g)` — set/clear
  the gradient on the selected vector object's asset style.
- `setGradientStops(prop: 'fill'|'stroke', stops: GradientStop[])` — replace stops.
- `setGradientType(prop, 'linear'|'radial')` — convert, preserving stops, resetting
  geometry to the type default.
- (Linear) `setGradientAngle(prop, deg)` — maps an angle to `x1/y1/x2/y2` in
  objectBoundingBox space (a UI convenience; engine stores native coords).

Inspector Fill/Stroke sections gain a **paint-type control** (Solid | Linear |
Radial). When Linear/Radial is selected, a gradient editor shows:
- type toggle, linear **angle** number field (radial: centered default, no geometry
  UI this slice),
- a **stop list**: each stop = offset (0..1) + color picker + remove; an
  **add-stop** button. Stops kept sorted by offset on commit. (Per-stop *opacity*
  is supported by the data model + emitter but its Inspector control is deferred —
  see §13.)

No tool palette / shortcut changes — a gradient is a style, not a tool.

## 9. Persistence

Additive optional fields on `VectorStyle`/`Gradient`/`GradientStop`; persistence
serializes the object graph generically (`JSON.stringify(sortKeys(...))` /
`JSON.parse`). **No migration, no version bump (stays v4).**

## 10. Security

- Stop colors validated as hex on input (reuse `parseHex`; reject → keep prior /
  fall back to a safe default). Emitted via `escapeAttr` (defense-in-depth, like
  `fill`/`stroke` today).
- Offsets/opacity clamped to `[0,1]`; geometry numbers through `fmt`.
- Ids derived from a uuid `objectId` + literal suffix → no injection surface.

## 11. Testing

- **Unit — `engine/gradient.test.ts`:** `gradientToSvg` linear/radial markup,
  stop-opacity emitted only `<1`, offset/opacity clamping, `fmt` on all numbers,
  `escapeAttr` on colors; `paintRef`.
- **Unit — `renderShape.test.ts`:** with `idScope` + a gradient, `fill`/`stroke`
  becomes `url(#savig-grad-<scope>-fill|stroke)`; without `idScope`, falls back to
  solid; shape element unchanged otherwise.
- **Unit — `renderDocument.test.ts`:** gradient object emits a `<linearGradient>`
  in `<defs>` and the shape references it; two objects → two distinct ids.
- **Unit — `frame.test.ts`:** `computeFrame` omits `fill` when `fillGradient`
  present even if a fill color track exists (gradient wins).
- **Unit — store/Inspector:** set/clear gradient; Solid↔gradient mutual exclusion;
  add/remove/edit stops; angle→coords; single undo step.
- **e2e (Playwright, real chromium):** assign a linear gradient to a rect's fill →
  export → exported SVG `<defs>` contains a `<linearGradient>` and the rect's
  `fill="url(#…)"` resolves (assert the gradient def + reference exist and the id
  matches). Confirms preview == export.

## 12. Plan decomposition

Two plans mirroring prior slices:
- **Plan A — Engine & pipeline:** `Gradient`/`GradientStop` types; `engine/gradient.ts`
  (`gradientToSvg`/`paintRef`) + barrel; `renderShapeToSvg` `idScope`; export defs
  wiring; `computeFrame` gradient-overrides-color guard; parity test. No bundle regen.
- **Plan B — UI:** store actions (`setFillGradient`/`setStrokeGradient`/
  `setGradientStops`/`setGradientType`/`setGradientAngle`); Inspector paint-type
  control + stop editor; Stage gradient rendering; e2e.

## 13. Deferred (tracked for later slices)

Animated gradient stops/geometry (next, reuses Slice-4 color seam); on-canvas
gradient handles; `userSpaceOnUse` / `spreadMethod` / `gradientTransform`;
gradients on imported SVG assets; HSL/OKLCH/alpha stop interpolation; the
`fill: string | Gradient` paint-union refactor; boolean ops; multi-select/grouping (M4).
