# M2 Slice 9 — Animated Gradients (design)

Date: 2026-06-21
Status: design approved (decisions delegated to implementer; see §10)
Predecessor: Slice 8 — static linear/radial gradients (merged `9232596`)

## 1. Goal

Let a vector object's fill and/or stroke **gradient animate over the timeline**:
stop colors, stop offsets, stop opacity, and gradient geometry (linear
`x1/y1/x2/y2`; radial `cx/cy/r/fx/fy`). Slice 8 shipped gradients as *static*
paint with **zero per-frame work** (the `url(#…)` ref never changes, and
`gradientUnits=objectBoundingBox` auto-fits geometry/morph). This slice is the
first gradient feature that animates the **def itself** while the shape's
`fill="url(#…)"` reference stays constant.

Non-goals (deferred, tracked in §11): cross-type / cross-stop-count gradient
morphing, on-canvas gradient handles, per-stop-opacity Inspector control,
`userSpaceOnUse` / `spreadMethod` / `gradientTransform`, gradients on imported
SVG assets, HSL/OKLCH/alpha stop interpolation.

## 2. Design principles (inherited)

This slice is the **fourth instance** of the established "animate-a-thing" seam,
after `shapeTrack` (Slice 3), `colorTracks` (Slice 4), and `motionPath`
(Slice 5). Each is:

- an **optional field on `SceneObject`**, absent by default;
- resolved in **`sampleObject`** onto `RenderState` only when present & non-empty;
- the asset's static value remains the base, used when the track is absent;
- **no persistence migration** (optional field, generic JSON serialize, stays v4);
- **preview == export** enforced by the runtime↔engine parity test.

Animated gradients follow this pattern exactly, reusing `interpolateColor`
(Slice 4) for stop colors and `gradientToSvg` (Slice 8) as the parity oracle.

## 3. Data model

New optional field on `SceneObject` (`src/engine/types.ts`):

```ts
export interface GradientKeyframe {
  /** Seconds from the start of the timeline. */
  time: number;
  gradient: Gradient;       // a full LinearGradient | RadialGradient snapshot
  easing: Easing;           // governs the outbound transition (from-kf), like ColorKeyframe
}

// on SceneObject, alongside colorTracks:
gradientTracks?: Partial<Record<ColorProperty, GradientKeyframe[]>>;
//                                 ^ 'fill' | 'stroke'
```

- The static `VectorStyle.fillGradient` / `strokeGradient` (on the **asset**)
  stays the base. Once a **non-empty** `gradientTracks[prop]` exists, it governs
  that property; the static gradient is ignored for that prop (same relationship
  as `shapeTrack` ↔ asset `path`, and `colorTracks` ↔ static color).
- **Paint precedence (unchanged invariant):** a gradient (static *or* animated)
  always beats a solid color (static *or* color-track) for the same property.

## 4. Interpolation — new pure `src/engine/gradientAnim.ts`

```ts
export function interpolateGradient(a: Gradient, b: Gradient, t: number): Gradient;
export function sampleGradient(track: GradientKeyframe[], time: number): Gradient;
```

**`interpolateGradient(a, b, t)`** — STEPS-hold when the two gradients are not
smoothly interpolable, else component-wise lerp:

- If `a.type !== b.type` **or** `a.stops.length !== b.stops.length` →
  **STEPS-hold**: return `t >= 1 ? b : a` (mirrors `interpolateColor`'s hold on
  unparseable endpoints). This keeps the data model simple and defers
  cross-type / cross-count gradient morphing.
- Otherwise the result is the same `type` as `a`, with:
  - geometry numbers lerped (`linear`: `x1,y1,x2,y2`; `radial`: `cx,cy,r`, and
    `fx,fy` lerped when **both** define them, else taken from `a` — i.e. held);
  - each stop lerped pairwise by index: `offset` lerped, `opacity` lerped using
    `?? 1` for an absent endpoint, `color` via **`interpolateColor`** (reused
    from Slice 4, inheriting its hold-on-unparseable behavior).

**`sampleGradient(track, time)`** — mirrors `sampleColor` exactly: throws on an
empty track; clamps to first/last; brackets `time` between two keyframes; raw
progress `(time - a.time) / span` (0 when `span === 0`); applies the
**from-keyframe's easing** via `applyEasing`; returns `interpolateGradient(a.gradient, b.gradient, eased)`.

Pure, framework-agnostic, fully unit-tested in isolation.

## 5. Pipeline resolution

### 5.1 `RenderState` (`src/engine/sample.ts`)

Add optional `fillGradient?: Gradient` / `strokeGradient?: Gradient`.
In `sampleObject`, after the `colorTracks` block:

```ts
if (obj.gradientTracks) {
  for (const prop of ['fill', 'stroke'] as const) {
    const track = obj.gradientTracks[prop];
    if (track && track.length > 0) {
      state[prop === 'fill' ? 'fillGradient' : 'strokeGradient'] = sampleGradient(track, time);
    }
  }
}
```

### 5.2 `FrameItem` + `computeFrame` (`src/runtime/frame.ts`)

`FrameItem` gains `fillGradient?: Gradient` / `strokeGradient?: Gradient`.

In `computeFrame`, set them from `state.fillGradient`/`state.strokeGradient`
when present. Extend the **existing Slice-8 "gradient beats color track" guard**
so a color track is suppressed when *either* a static gradient (`asset.style.*Gradient`)
**or** an animated gradient (`state.*Gradient`) is present:

```ts
const hasFillGradient = (asset?.kind === 'vector' && !!asset.style.fillGradient) || state.fillGradient !== undefined;
const hasStrokeGradient = (asset?.kind === 'vector' && !!asset.style.strokeGradient) || state.strokeGradient !== undefined;
```

(When a property has an animated gradient track but the asset has no static
gradient, the initial DOM still has no def — see §5.4: the gradient def must be
emitted for export/runtime whenever a track exists.)

### 5.3 `applyFrameToNodes` (runtime player + editor painter) — the meaty part

This is the first `applyFrameToNodes` consumer that reaches **outside** the
object's wrapper `<g>` (which today only touches `node.firstElementChild`, the
shape). When `item.fillGradient` / `item.strokeGradient` is present:

```ts
function updateGradientDef(node: Element, id: string, g: Gradient): void {
  const root = node.ownerSVGElement ?? (node.getRootNode() as Document);
  const def = root?.querySelector?.(`#${CSS.escape(id)}`);
  if (!def) return; // defensive: never throw mid-frame if the def is missing
  // geometry attrs imperative; stop children always rebuilt (handles stop-count
  // changes across keyframes even under STEPS-hold) via a shared pure helper.
  applyGradientToElement(def, g);
}
```

- `id` is `savig-grad-<objectId>-<prop>` (same scheme as Slice 8).
- **Always rebuild stop children** rather than update-in-place: keyframe A may
  have 2 stops and keyframe C 4, and even with STEPS-hold the DOM's stop count
  can differ from the sampled gradient's. Rebuilding is simple and correct;
  gradient defs are few, so the churn is negligible.
- A **shared pure helper** in `engine/gradient.ts` produces the pieces so the def
  update stays byte-aligned with `gradientToSvg` (the parity oracle). Proposed:
  `gradientAttrs(g)` → `Record<string,string>` (coord attrs) and
  `gradientStopsMarkup(g)` → string (the `<stop>…` children). `gradientToSvg`
  is refactored to compose these (no output change — its tests are the guard).
  `applyGradientToElement` sets the coord attrs and `def.innerHTML = gradientStopsMarkup(g)`.
- `ownerSVGElement` is non-null for any element inside an `<svg>` in both the
  runtime player and the editor; the `getRootNode()` fallback + `if (!def) return`
  keep it defensive.

The **runtime bundle is regenerated** (`pnpm build:runtime`) so the export
honors animated gradients.

### 5.4 Export (`src/services/export/renderDocument.ts`)

The gradient def must be emitted **sampled at t=0** whenever a static gradient
**or** a non-empty gradient track exists for the property — same "export-at-0"
pattern as `shapeTrack`/`colorTracks`. Since `renderDocument` already calls
`sampleProject(project, 0)`, the resolved `state.fillGradient`/`strokeGradient`
*is* the t=0 sample; emit `gradientToSvg(id, state.<prop>Gradient ?? asset.style.<prop>Gradient)`
when either is present. The shape's `fill`/`stroke` becomes `url(#…)` via the
existing `idScope` path in `renderShapeToSvg` whenever a gradient (static or
animated) applies — `renderShapeToSvg`/`styleToSvgAttrs` must therefore treat a
property as gradient-painted when the asset has a static gradient **or** the
object has a non-empty gradient track. (Cleanest: pass a small `paintFlags`
{fillGradient, strokeGradient} into the render call rather than reading only
`style.*Gradient`.)

## 6. Parity

The runtime↔engine parity test gains a case: an object with an animated gradient
track, sampled at an interior time, asserts that `applyFrameToNodes`-mutated def
markup equals `gradientToSvg(id, sampleGradient(track, t))`. Because both the
runtime mutation and the export def are built from the same pure
`gradientAttrs`/`gradientStopsMarkup`, Stage == runtime == export by construction.

## 7. Authoring UI (Plan B) — mirror Slice 4 (color)

- **Store** (`src/ui/store/store.ts`):
  - Extend `setVectorGradient(property, gradient | undefined)`: when **autoKey
    on**, `upsertGradientKeyframe` at the snapped playhead capturing the supplied
    full gradient (and **select** the new keyframe, as `setVectorColor` does);
    when **autoKey off**, write the static `*Gradient` via `setVectorStyle`
    (current behavior). All gradient edits in the Inspector (paint-type select,
    stop add/remove/edit, linear angle, radial coords) route through this single
    action so they auto-key uniformly.
  - `GradientKeyframeRef = { objectId; property: ColorProperty; time }`;
    `selectedGradientKeyframe`; `selectGradientKeyframe` (also sets
    `selectedObjectId`, clears the other keyframe selections);
    `removeSelectedGradientKeyframe`.
  - `setSelectedKeyframeEasing` routes to the gradient track when a gradient
    keyframe is selected (add a gradient branch; keep selections mutually
    exclusive — order the branches so exactly one fires).
  - **Delete chain** gains gradient (e.g. gradient → color → node → shape →
    scalar; pick a deterministic order and document it).
  - All `selectObject` / track-clearing sites that reset
    `selectedColorKeyframe` also reset `selectedGradientKeyframe`.
  - `upsertGradientKeyframe` reuses the existing keyframe-upsert helper shape
    (snap to time, replace at `KF_EPS`, keep sorted).
- **Inspector** (`Inspector.tsx`): the paint-type `<select>` + stop editor +
  linear-angle field already exist (Slice 8); they now **display the sampled
  gradient** (`sampled.<prop>Gradient ?? asset.style.<prop>Gradient`) and write
  through `setVectorGradient`. Add a small "Gradient" keyframe section (selected
  gradient keyframe → easing editor, reusing Feature-1 `EasingEditor`; remove
  button), parallel to the existing color/keyframe sections.
- **Timeline** (`Timeline.tsx`): a gradient keyframe lane per animated property
  with a `.gradientDiamond` marker (new `--color-…` token); click selects the
  `GradientKeyframeRef`. (Per-property fill/stroke sub-lanes remain deferred, as
  for color — markers carry unambiguous testids.)
- **Stage** (`Stage.tsx`): `GradientEl` renders the **sampled** gradient when a
  track exists (`sampled.<prop>Gradient ?? asset.style.<prop>Gradient`) so the
  editor preview matches; during playback the imperative painter
  (`applyFrameToNodes`) updates the def — identical to how `colorTracks` drive
  the shape's `fill` today.

## 8. Persistence

No migration. `gradientTracks` is an optional field; absent → `undefined` →
byte-identical to today. Project stays **v4**. (Runtime bundle regen is a build
artifact, not a persistence change.)

## 9. Testing

- **Engine unit:** `gradientAnim.test.ts` — `interpolateGradient` (same-type
  same-count lerp of coords/offset/opacity/color; type mismatch holds; count
  mismatch holds; radial `fx/fy` half-defined holds); `sampleGradient` (clamp
  ends, bracket, easing applied, `span===0`). `gradient.test.ts` extended for
  the new `gradientAttrs`/`gradientStopsMarkup` (and unchanged `gradientToSvg`).
- **Pipeline unit:** `sample.test.ts` (track → `state.*Gradient`),
  `frame.test.ts` (`computeFrame` sets `item.*Gradient` + extended color-suppress
  guard; `applyFrameToNodes` mutates a def element's coords + stops), parity test.
- **Export unit:** `renderDocument.test.ts` — animated-gradient object emits a
  def sampled at t=0 + a `url(#…)` ref even with no static gradient.
- **Store unit:** `setVectorGradient` autoKey-on upserts a gradient keyframe /
  autoKey-off writes static; remove; easing routing; delete chain.
- **e2e (Playwright, real chromium):** draw rect → fill = linear gradient →
  enable autoKey → move playhead → change a stop color → export → assert the
  exported `index.html` contains a `<linearGradient id="savig-grad-…">` **and**
  the runtime animates its `<stop stop-color>` (sample two times, assert the
  stop color differs).

## 10. Decisions (delegated to implementer, recorded)

The user delegated brainstorm choices. Chosen, with rationale:

1. **Slice = animated gradients** (memory's flagged next candidate; boolean ops
   needs a clipping lib; multi-select is M4).
2. **Whole-gradient keyframes** (one snapshot per kf) over per-stop tracks —
   simplest data model, mirrors `colorTracks`, captures stops + geometry together.
3. **STEPS-hold** on type/count mismatch — defers gradient morphing, keeps the
   interpolator total and simple.
4. **Always-rebuild stop children** in the runtime def update — robust to
   stop-count changes across keyframes.
5. **Reuse** `interpolateColor` (stops) + `gradientToSvg` (parity oracle) +
   `EasingEditor`/Timeline/Delete-chain patterns (UI).
6. **Two plans** A (engine/pipeline) + B (UI), inline-TDD + reviewer subagents.

## 11. Deferred (tracked)

- Cross-type / cross-stop-count gradient **morphing** (would reuse the morph
  reconcile seam — a stop-count reconciler).
- On-canvas gradient **handles** (drag endpoints/center/focal on the Stage).
- Per-stop **opacity** Inspector control (data + emitter already support it).
- `userSpaceOnUse` / `spreadMethod` / `gradientTransform`.
- Animating gradients on **imported SVG** assets (vector objects only).
- HSL / OKLCH / **alpha** stop interpolation.
- `fill: string | Gradient` paint-union type refactor (still two parallel fields).
- Boolean ops; multi-select / grouping (M4).
