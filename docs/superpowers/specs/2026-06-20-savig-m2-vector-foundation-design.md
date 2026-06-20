# Savig — M2 Slice 1: Editable Vector Foundation (Design)

## Summary

This is the first slice of **Milestone 2 — Vector drawing tools**. It introduces
the ability to **draw, edit, style, and animate primitive vector shapes**
(rectangle and ellipse) directly in Savig, alongside imported SVGs, while
preserving M1's defining guarantee: **preview == export**, byte-for-byte, via
pure engine functions shared with the export runtime.

It deliberately establishes the *editable-vector architecture* — a new editable
asset kind, animatable geometry, on-canvas authoring — so later M2 slices (pen/
bezier, freehand brush, more primitives, gradients, color animation, boolean ops)
build on a proven foundation. Vector drawing tools beyond rect/ellipse remain a
later slice.

### Stack & standards (unchanged from M1)

pnpm · Vite · React 18 + TS (strict) · Zustand (UI state) · Vitest + RTL ·
Playwright (e2e) · CSS Modules + design tokens. Client-only, no backend. TDD
throughout. The engine layer stays **pure TypeScript with zero React/DOM
dependencies** so the tween/render core can be lifted verbatim into the export
runtime.

---

## Scope

### In scope (this slice)

- Two primitive shape tools: **rectangle** and **ellipse**.
- A **select tool** plus on-canvas **resize handles** *and* **Inspector numeric
  fields**, kept in sync, for editing geometry.
- **Solid styling**: `fill`, `stroke`, `strokeWidth`, each of fill/stroke with a
  **"none"** option.
- Drawn shapes are **fully animatable**: the existing transform/opacity tracks
  **plus geometry** — rect `width`/`height`/`cornerRadius`, ellipse
  `radiusX`/`radiusY` — as scalar tracks.
- **Preview == export parity** maintained for all of the above (static and
  animated geometry).
- Backward-compatible **persistence migration** (old projects load unchanged).

### Out of scope (later M2 slices)

Pen/bezier authoring · freehand brush · polygon / line / star · gradients ·
fill/stroke **color** animation · `fillOpacity`/`strokeOpacity` per channel ·
boolean ops · grouping/layers · reuse/instancing UI for drawn assets · on-canvas
**rotate** handle (rotation is edited via the Inspector this slice).

---

## 1. Architecture (fits the existing three layers)

No new layers. The work slots into M1's structure:

```
UI layer        Toolbar (tool palette) · Stage (draw + resize handles) ·
                Inspector (geometry + style) · object/timeline list
Engine layer    VectorAsset type · geometry tracks · sampleObject geometry +
                fractional-anchor resolution · renderShapeToSvg (shared) ·
                migration
Services layer  Export branch for inline vector shapes · runtime applyGeometry ·
                persistence (already serialization-agnostic)
```

**Key principle preserved:** the engine layer has zero React/DOM dependencies.
The new `renderShapeToSvg()` is the M2 analogue of M1's `buildTransform()` — a
single pure function called by **both** the Stage and the export runtime, so
there is exactly one shape-rendering definition and preview cannot drift from
export.

---

## 2. Data model

### New editable asset kind

`Asset` becomes `SvgAsset | AudioAsset | VectorAsset` (the existing union is
already discriminated by `kind`).

```ts
interface VectorAsset {
  id: string;             // uuid — MUTABLE content, so NOT a content hash
  kind: 'vector';
  name: string;
  shapeType: 'rect' | 'ellipse';
  style: VectorStyle;     // static this slice (color animation is a later slice)
}

interface VectorStyle {
  fill: string | 'none';      // solid color (CSS hex) or absent
  stroke: string | 'none';    // solid color (CSS hex) or absent
  strokeWidth: number;        // user units; 0 allowed
}
```

- **uuid, not content-hash.** Imported `SvgAsset`/`AudioAsset` are
  content-addressed for dedupe; drawn vectors are unique and mutable, so they get
  a uuid.
- **Style lives on the asset; geometry + transform live on the object** (see
  §2.2). Style is static this slice.

### Animatable geometry on the object

Geometry must be resolvable per-frame, so it lives in the object's track system,
exactly like transform.

```ts
type GeometryProperty =
  | 'width' | 'height' | 'cornerRadius'   // rect
  | 'radiusX' | 'radiusY';                // ellipse

type AnimatableProperty =
  | 'x' | 'y' | 'scaleX' | 'scaleY' | 'rotation' | 'opacity'   // existing
  | GeometryProperty;                                          // new
```

`SceneObject` gains static base values for geometry alongside `base:
Transform2D`, and `tracks` accepts the geometry keys. Only the keys relevant to
the shape type are populated.

```ts
interface SceneObject {
  // ...existing: id, name, assetId, zOrder, parentId?, base, tracks
  shapeBase?: Partial<Record<GeometryProperty, number>>; // static geometry values
  anchorMode?: 'absolute' | 'fraction';   // see §3.1; vector objects use 'fraction'
  // anchorX/anchorY are reinterpreted per anchorMode (absolute units, or 0..1)
}
```

> Implementation note: the exact field shape (`shapeBase` vs folding geometry
> into a generalized `base` record) is finalized in the plan. The contract that
> matters: geometry has static base values + optional keyframe tracks, resolved
> identically to transform.

### Model decisions

- **Resize handles edit geometry; `scale` is a separate transform.** A drawn rect
  can be sized two ways and they are intentionally different:
  - animating **scale** scales the stroke too (stroke visibly thickens);
  - animating **geometry** (`width`/`height`) keeps stroke width constant while
    the box grows.

  Both are kept because both are useful. The **resize handles edit geometry**
  (the non-distorting, expected behavior); `scaleX/scaleY` remain available as
  transform tracks via the Inspector. This distinction is a documented feature.
- **Local coordinate convention** (so anchor/bbox/hit-testing are well-defined):
  - rect → `<rect x="0" y="0" width height>`
  - ellipse → `<ellipse cx="radiusX" cy="radiusY" rx="radiusX" ry="radiusY">`
  - bbox is `(0, 0, width, height)`; center is `(width/2, height/2)`.
  - Placement is **entirely** via the object transform: `base.x`/`base.y` is
    where the local top-left lands in stage space. The local shape always starts
    at origin.
- **Geometry → SVG attribute mapping** (in `renderShapeToSvg`):
  `cornerRadius` → rect `rx`/`ry`; `radiusX`/`radiusY` → ellipse `rx`/`ry`. The
  distinct property names avoid colliding rect-corner radius with ellipse radii
  in the `AnimatableProperty` union.
- **VectorAsset is undoable document state.** Unlike binary SVG/audio assets
  (whose blobs are kept out of undo in IndexedDB), `VectorAsset` is small plain
  data and lives **inside the undoable `Project`**, so creating/deleting a drawn
  shape is a normal undo step.

---

## 3. Engine & parity

### 3.1 Fractional anchor resolution (critical for animated geometry)

M1's `buildTransform()` takes an **absolute** `anchorX/anchorY` (default = bbox
center) as the pivot for rotate/scale. For a drawn shape the bbox **animates**
(`width`/`height` are tracks), so a fixed absolute anchor stops being the center
once geometry changes — rotation/scale would visibly pivot off-center.

**Resolution:** vector objects store the anchor as a **normalized fraction**
(`anchorMode: 'fraction'`, default `anchorX = 0.5, anchorY = 0.5`). During
sampling the fraction is resolved to absolute coordinates against the
**resolved** geometry of that frame:

```
absAnchorX = anchorX * resolvedWidth      // rect: width; ellipse: 2*radiusX
absAnchorY = anchorY * resolvedHeight
```

The resolved absolute anchor is then passed to the **unchanged**
`buildTransform()`. Imported SVG objects keep `anchorMode: 'absolute'` and behave
exactly as in M1. This keeps the pivot stable as a shape grows.

### 3.2 Sampling

`sampleObject()` resolves geometry from `shapeBase` + geometry tracks using the
**existing** scalar `interpolate()` — geometry properties are plain scalars, so
**no new interpolation math** is introduced (this is what keeps the slice
tractable and distinct from M3 path-morphing). The resolved render state for a
vector object carries transform + opacity (as today) **plus** the resolved
geometry values and the (static) style.

### 3.3 `renderShapeToSvg` (the shared, parity-critical function)

A new pure, dependency-free engine function:

```ts
renderShapeToSvg(
  shapeType: 'rect' | 'ellipse',
  geometry: ResolvedGeometry,   // resolved scalars for this frame
  style: VectorStyle,
): string                       // e.g. '<rect x="0" y="0" width="120" .../>'
```

It is compiled into the export runtime (like the tween core) so the editor and
the exported bundle emit byte-identical shape markup. Style attributes
(`fill`/`stroke`/`stroke-width`) are static and emitted once; geometry attributes
are what the runtime updates per frame (§4).

### 3.4 Edge cases

- A geometry track with no keyframes returns the object's static `shapeBase`
  value (mirrors transform behavior).
- Geometry clamps to a small **minimum** (e.g. ≥ 0) to avoid invalid SVG; degenerate
  draws are handled at the UI layer (§5).
- A vector object whose asset is missing renders nothing (defensive, like a
  missing SVG asset).

---

## 4. Rendering & export

### Stage (preview)

Each vector object renders as the existing `<g transform="…">` wrapper (from
`buildTransform`) whose child is `renderShapeToSvg(...)`. During playback,
geometry/transform/opacity are written **imperatively to node refs**, bypassing
React reconciliation (M1's performance principle), so geometry animation is part
of the same 60fps imperative path — not React state.

### Export (HTML5 bundle)

- Imported SVG objects keep using `<defs>` + `<use>` as in M1.
- **Vector objects emit an inline `<rect>`/`<ellipse>`** (not a `<use>` of a def),
  because their geometry animates per-frame and a static def cannot capture that.
- The exporter iterates objects in `zOrder` and emits the correct element type
  per object, so z-order interleaving of imported and drawn shapes is preserved.
  `<defs>` continues to hold only SVG assets.
- The runtime gains a small **`applyGeometry`** step: for objects with geometry
  tracks it sets `width/height/rx/ry` on the inner shape node each frame (the
  existing transform/opacity application already targets the wrapper). This
  requires a node/attribute binding for the inner shape element (e.g. a
  data-attribute the runtime resolves), extending M1's existing binding scheme.

### Parity

The existing **runtime↔engine parity test** is extended so that, for a sample of
times, the runtime's resolved geometry attributes equal the engine's
`sampleObject` geometry (the same way transform parity is already asserted). This
is the automated guarantee that animated drawn shapes preview == export.

---

## 5. UI layer

### 5.1 Tool palette

The Toolbar gains a tool mode: `select | rect | ellipse`. Active tool is
**ephemeral UI state** in the Zustand UI store — **not** part of the `Project`,
**not** persisted, **not** undoable. Optional keyboard shortcuts: `V` (select),
`R` (rect), `E` (ellipse).

### 5.2 Drawing

In `rect`/`ellipse` mode, pointer-down → drag on the Stage shows a **live
preview**; pointer-up **commits**. Commit is a single undo entry that:

1. creates a `VectorAsset` (uuid, default style, `shapeType` from the tool),
2. creates a `SceneObject` instancing it, with `base.x/base.y` at the drag
   origin (in stage coordinates) and `shapeBase` width/height from the drag
   delta, `anchorMode: 'fraction'` (0.5, 0.5),
3. switches to the select tool and selects the new object.

Coordinate handling: pointer positions are converted screen → stage space
accounting for the existing Stage **zoom/pan**. **Negative-direction drags** are
normalized (origin swapped) so width/height stay positive. A **minimum-size
threshold** cancels near-zero drags (no shape created).

### 5.3 Resize handles (on-canvas)

When the select tool is active and a vector object is selected, the Stage renders
an 8-handle bounding box. Dragging a handle edits geometry (`width`/`height` for
rect, `radiusX`/`radiusY` for ellipse), **auto-keying** when the playhead is off
the object's base frame (consistent with M1's Inspector auto-key), and the whole
drag is **coalesced into one undo step** (reusing M1's existing stage-drag
coalescing). Dragging the body (not a handle) moves the object via `x`/`y` as in
M1.

**Handles are rotation-aware:** because rotation is editable (via the Inspector),
handles map pointer → local space through the object transform's **inverse**, so
they behave correctly on rotated shapes. (An axis-aligned-only fallback is
explicitly rejected — it would silently misbehave on any rotated shape.)

### 5.4 Inspector

For a selected vector object, the Inspector shows:

- **Geometry** numeric fields (rect: width/height/cornerRadius; ellipse:
  radiusX/radiusY) with the existing **auto-key + commit-on-blur** behavior; kept
  in sync with the on-canvas handles.
- **Style** controls: native `<input type="color">` for fill and stroke, **"none"
  toggles** for each, and a numeric **strokeWidth** field. Native color input is
  hex-only (no alpha); per-channel alpha and gradients are deferred — use the
  object's existing **opacity** for transparency this slice.
- Existing transform/opacity fields remain (including `scaleX/scaleY`, per the
  §2 scale-vs-geometry contract).

### 5.5 Asset panel

Drawn `VectorAsset`s are **not** surfaced in the import-oriented Asset panel this
slice (they would flood it with "Rectangle 1, 2, 3…"). They are created and
managed via the Stage and the object/timeline list. Surfacing/reusing drawn
assets is revisited when instancing lands in a later slice.

---

## 6. Persistence & migration

- Bump `meta.version` and add a **forward, no-op upgrader** to the existing
  migration registry: old projects have no vector assets and no geometry tracks,
  so they load unchanged (the upgrader only stamps the new version).
- The `.savig` zip and IndexedDB autosave already serialize arbitrary
  plain-object assets, so no format changes beyond the version bump.
- `VectorAsset` carries no binary, so (unlike SVG/audio) it serializes inline
  with the document and participates normally in undo/redo.

---

## 7. Error handling & edge cases (summary)

- **Degenerate draw** (drag below min-size): no shape created; tool stays active.
- **Negative-direction drag**: normalized so geometry stays positive.
- **Geometry ≤ 0** from animation/edit: clamped to a valid minimum before render.
- **Rotated-shape resize**: handled via inverse-transform mapping (§5.3).
- **Missing asset** for a vector object: renders nothing (defensive).
- **Zoom/pan**: all pointer math goes through the existing screen↔stage transform.

---

## 8. Performance

Geometry tracks add per-frame `interpolate()` calls per object. The mitigation is
M1's existing principle — **imperative writes to refs** during playback (geometry
attributes set directly, React untouched). This slice also inherits M1's tracked
perf items (the O(n) per-property segment scan in `interpolate` and the
per-call cubic-bezier solver allocation in `applyEasing`); adding geometry tracks
increases their weight, so the previously-budgeted perf pass (binary-search over
the sorted track + easing-solver memoization) becomes more valuable. No new perf
risk unique to this slice beyond more scalar tracks.

---

## 9. Testing strategy (TDD)

Engine (pure, no DOM):

- `renderShapeToSvg` output for rect/ellipse across styles ("none" fill/stroke,
  zero strokeWidth, corner radius).
- Geometry sampling: static base when no keyframes; correct interpolation between
  geometry keyframes with easing.
- Fractional-anchor resolution: pivot stays centered as geometry animates.

Runtime ↔ engine:

- Extended **parity test**: runtime resolved geometry attributes equal engine
  `sampleObject` geometry at sampled times.

UI (RTL):

- Draw-commit creates asset + object as **one** undo entry; tool switches to
  select; new object selected.
- Resize-handle drag edits geometry, auto-keys off-base, **coalesces** to one
  undo step; rotated-shape resize maps correctly.
- Inspector geometry fields ↔ handles stay in sync; style edits apply.
- Vector assets do **not** appear in the Asset panel.

E2E (Playwright, real Chromium):

- Draw a rectangle, keyframe its `width`, export the bundle, and assert the
  exported animation matches the in-editor preview (extends M1's existing
  export-parity e2e — the ultimate preview == export proof for animated geometry).

Migration:

- An M1-era project (no vector assets) loads unchanged after the version bump.

---

## 10. Plan decomposition (for the writing-plans step)

This slice is roughly the size of a full M1 plan, so it is split into two plans
for reviewability (mirroring M1's plan structure):

- **Plan A — Engine & pipeline (no UI):** `VectorAsset` type + union/migration,
  geometry properties + `shapeBase`, `sampleObject` geometry + fractional-anchor
  resolution, `renderShapeToSvg`, export inline-shape branch, runtime
  `applyGeometry`, extended runtime↔engine parity test.
- **Plan B — UI:** tool palette, draw interaction (zoom/pan-aware, min-size,
  negative-drag), rotation-aware resize handles with auto-key + undo coalescing,
  Inspector geometry + style controls, asset-panel exclusion, Playwright
  export-parity e2e.

Each plan is its own `writing-plans` → execution cycle.

---

## Open questions / deferred decisions

- Exact `SceneObject` field shape for geometry base (`shapeBase` vs generalized
  `base`) — finalized in Plan A.
- Whether `cornerRadius` ships in this slice or the next (cheap; included by
  default, droppable if it complicates the Inspector).
- Tool keyboard shortcuts (V/R/E) — included as optional polish.
