# Savig M2 Slice 7 — Freehand brush (design)

Date: 2026-06-21
Status: approved-to-plan
Milestone: M2 (Vector drawing tools)

## 1. Goal

Add a **freehand brush** tool. The user click-drags across the Stage and the gesture
becomes a smooth, editable vector stroke. This completes M2's "Pen / shapes / **brush**"
remit — today the only freeform authoring is hand-placing nodes with the pen tool.

## 2. Why this slice (scope rationale)

Of the remaining M2 candidates (freehand brush, gradients, boolean ops) and the
explicitly-M4 multi-select/grouping, **freehand brush** is the best-bounded, lowest-risk,
highest-leverage next step:

- Squarely finishes M2 scope (the literal "brush" in "pen / shapes / brush").
- Closes the last obvious gap in the drawing toolkit.
- Reuses the entire existing path pipeline (see §3), so the implementation surface is a
  pair of pure functions plus tool wiring — the same shape as Slice 6.
- Gradients (a `<defs>`/stop model + export namespacing) and boolean ops (a robust
  polygon-clipping dependency) are genuinely larger, export-/dependency-heavy slices and
  stay deferred.

## 3. Key insight — a brush is a path generator

Exactly as in Slice 6 (primitives), `store.addVectorPath(path: PathData)` already:

- bbox-normalizes a **stage-space** `PathData` so its top-left sits at local origin,
- creates a `shapeType: 'path'` `VectorAsset` + `SceneObject` (anchorMode `'fraction'`,
  centered pivot) positioned by the object transform,
- selects the new object and switches to the `node` tool.

So any tool that can **generate** a `PathData` inherits — with zero new engine,
render-seam, export, runtime, or persistence work — node editing, path morphing, per-node
easing, fill/stroke color animation, motion-path following, and HTML5 export.

A freehand brush is therefore: **capture a pointer drag → simplify → fit to smooth nodes →
`addVectorPath`.** This means **no new `VectorShapeType`, no engine render-seam change, no
persistence version bump, no export/runtime change. Stays at project version 4.**

## 4. The capture → vector pipeline (the core design)

Raw pointer samples are dense and noisy. We turn them into a clean `PathData` with two
pure, deterministic stages (both tested as the parity oracle — the same generated path
previews and exports because everything downstream is the existing path pipeline):

1. **Simplify (Ramer–Douglas–Peucker).** Reduce the raw stage-space point list to the
   fewest points that stay within a tolerance `epsilon` of the original polyline. RDP
   preserves endpoints and genuine corners while stripping pointer jitter and over-sampled
   density. Lands as reusable pure `engine/geom/simplify.ts` (sibling to `arcLength.ts`).

2. **Smooth-fit (Catmull-Rom → cubic bezier).** Convert the simplified point sequence into
   `PathData` nodes **with in/out bezier handles** — one node per simplified point, with
   handles derived from a Catmull-Rom spline through the points (standard CR→bezier tangent
   = (P[i+1] − P[i−1]) / 6, scaled by a tension). End nodes use one-sided tangents. This
   yields natural-looking curves AND a node count appropriate for downstream morph/editing.
   The result is an **open** path of smooth nodes (the same node model Slice 2's pen uses;
   `in == −out` ⇒ smooth).

Orchestrated by new pure `engine/brush.ts`:

```ts
// Build an open, smooth vector stroke from raw drag samples (stage-space).
// opts.tolerance → RDP epsilon; opts.smoothing → Catmull-Rom tension (handle length).
strokeToPath(points: PathPoint[], opts: { tolerance: number; smoothing: number }): PathData
//   - dedupes near-coincident input points,
//   - returns { nodes, closed:false } with smooth in/out handles,
//   - degenerate guards: 0/1 input points → empty (caller cancels); 2 points → a
//     straight open 2-node path (corner nodes, no handles).
```

`strokeToPath` is the single source of geometry truth → preview == commit == export.

Rejected alternatives:
- **Corner-only polyline** (like the `line`/`polygon` primitives): jagged, dense, wrong
  look and bad node count for a freehand stroke.
- **Schneider least-squares bezier fitting**: more compact curves, substantially more
  complex (iterative reparameterization). Deferred (YAGNI) — CR→bezier is simple, local,
  deterministic, and good enough.

## 5. Brush output style — `addVectorPath` optional style seed

A brush stroke is conceptually a **stroked open path**: `fill:'none'`, a stroke color, a
brush-width `strokeWidth`, and round linecap/linejoin so it reads like a drawn line.

`PATH_DEFAULT_STYLE` is already `{ fill:'none', stroke:'#000000', strokeWidth:2 }`, so the
brush only needs to override `strokeWidth` (brush size) and set round caps/joins. To keep
creation a single atomic undo step (vs a `setVectorStyle` follow-up commit), `addVectorPath`
gains an **optional second param**:

```ts
addVectorPath(path: PathData, styleSeed?: Partial<VectorStyle>): void
//   merged over PATH_DEFAULT_STYLE before createVectorAsset. Absent = today's behavior
//   (byte-identical for all existing callers: pen, primitives, motion).
```

The brush commit passes `{ strokeWidth: brushSize, strokeLinecap:'round', strokeLinejoin:'round' }`.
This is the only store-API change, and it is backward-compatible.

## 6. Tool options (minimal, mirroring Slice 6's options row)

UI tool-option state on the store, with clamped setters, used **at creation** (not stored
parametrically — same YAGNI tradeoff as polygon sides):

- `brushSize: number` (default 4), `setBrushSize(n)` — clamp ≥ 1; seeds `strokeWidth`.
- `brushSmoothing: number` (default ~0.5, normalized 0..1), `setBrushSmoothing(r)` — clamp
  [0,1]; maps to the RDP `tolerance` and CR `smoothing`/tension fed to `strokeToPath`
  (higher = simpler/smoother). The 0..1 → `{tolerance, smoothing}` mapping is a small **pure**
  helper `brushParams(smoothing)` in `engine/brush.ts` (unit-tested for monotonicity), not
  buried in the Stage commit.

## 7. Store — `src/ui/store/store.ts`

- `ToolMode` gains `'brush'`:
  `'select' | 'pen' | 'node' | 'rect' | 'ellipse' | 'motion' | 'polygon' | 'star' | 'line' | 'brush'`.
- Tool-option state + setters from §6.
- `addVectorPath` optional `styleSeed` param from §5.
- No new creation action — the Stage tool generates a `PathData` and calls `addVectorPath`.

## 8. Stage / interaction — `src/ui/components/Stage/usePathTools.ts` (+ pointer routing)

Drag-capture creation, reusing the established CTM mapping and ref-commit discipline:

- **Pointer-down (brush tool):** begin a capture; record the first stage-local point.
- **Pointer-move:** append the stage-local point (via the existing client→stage-local CTM
  helper used by pen/rect/primitives), deduping near-coincident samples. Drive a live
  `<path data-testid="brush-preview">` imperatively (render the raw in-progress polyline via
  `pathToD`, or the smoothed path — raw polyline is cheapest and fine).
- **Pointer-up:** run `strokeToPath(points, {tolerance, smoothing})`; if it yields < 2 nodes
  (a tap / sub-threshold stroke) → cancel (no commit); else `addVectorPath(path, styleSeed)`.
  One undo step. Capture state held in a ref and nulled-after-read so exactly one commit
  fires (the StrictMode/double-invoke discipline established in Slices 2–3).
- Stage pen/draw pointer routing is broadened to include `'brush'` (as it was for `'motion'`
  and the primitive tools).

## 9. UI surface

- **ToolPalette** (`src/ui/components/Toolbar/`): add a **Brush** button with the existing
  active/aria-pressed pattern.
- **Keyboard** (`src/ui/hooks/useKeyboard.ts`): `B` → brush (verified free; existing
  V/P/N/R/E/M/G/S/L unchanged). Lowercase + uppercase cases like siblings.
- **Tool options:** the existing primitive-options-style control row, rendered when the
  brush tool is active, bound to `brushSize` + `brushSmoothing` (reuse `NumberField` / a
  range input, consistent with existing inputs).

## 10. Export / runtime / persistence

Unchanged. Brush strokes are `shapeType: 'path'` objects; export inlining, the runtime
bundle, parity, and `.savig` persistence already handle paths. **No migration, no version
bump (stays v4).**

## 11. Testing

- **Engine unit (parity oracle):**
  - `geom/simplify.ts`: RDP removes collinear/within-epsilon points, preserves endpoints,
    larger epsilon ⇒ fewer points, degenerate inputs (0/1/2 points) handled, determinism.
  - `engine/brush.ts`: `strokeToPath` returns an open path with smooth (`in == −out`) nodes;
    node count tracks simplification; 2-point input ⇒ straight 2-node open path; 0/1 input
    ⇒ empty; deterministic; tolerance/smoothing monotonicity sanity.
- **Store unit:** `ToolMode` extension; `brushSize`/`brushSmoothing` setters + clamping;
  `addVectorPath` style seed merges over defaults and is byte-identical when absent.
- **Stage/interaction unit:** a captured drag → commit produces an object whose path matches
  `strokeToPath` (within float tolerance) for the same points; a single-point/tiny drag does
  not commit; exactly one undo step; round caps/brush width applied. (jsdom CTM stubbed as in
  the Slice 6 stamp test; real drag covered by e2e.)
- **Keyboard unit:** `B` sets the active tool to `'brush'`.
- **e2e (Playwright, real chromium):** select Brush → drag a stroke → add a shape keyframe →
  node-morph (reusing existing morph authoring) → export → assert the exported bundle's path
  `d` animates. One new e2e, mirroring prior slices.

## 12. Slice structure (plans)

Mirrors the established engine→UI rhythm (each prefix shippable):

- **Plan A — Engine:** `geom/simplify.ts` (RDP) + `engine/brush.ts` (`strokeToPath`) +
  parity-oracle tests + barrel re-export. Self-contained.
- **Plan B — UI/tools:** `ToolMode` + tool-option state, `addVectorPath` style seed, Stage
  brush capture + live preview + ref-commit, ToolPalette button, `B` shortcut, tool-options
  row, e2e.

## 13. Deferred (tracked, not built this slice)

- **Pressure / velocity-variable stroke width** and **ribbon-outline** (filled-outline)
  brushes — the `PathData` model has no per-vertex width; this is a larger slice with its
  own geometry (variable-width offset / outline-on-export).
- **Input stabilizer / lazy-brush** (cursor-lag smoothing during capture).
- **Auto-close** when start/end points are near-coincident (commit a closed path).
- **Schneider least-squares** bezier fitting (more compact curves).
- **Textured / patterned** brushes.
- **Gradients** (defs model, stop animation, export/namespacing) — larger slice.
- **Boolean ops** (union/intersect/subtract; needs robust polygon clipping).
- **Multi-select / grouping** — explicitly M4.
