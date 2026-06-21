# Savig M2 Slice 6 — Polygon / Star / Line primitives (design)

Date: 2026-06-21
Status: approved-to-plan
Milestone: M2 (Vector drawing tools)

## 1. Goal

Add three drawing primitives — **regular polygon**, **star**, and **line** — to the
editor. Today the only way to make these is to hand-place nodes with the pen tool. These
tools let a user click-drag to stamp a shape, sized and oriented by the drag.

## 2. Why this slice (scope rationale)

M2's remit is "Pen / shapes / brush" vector drawing tools. Of the remaining M2 candidates
(freehand brush, gradients, boolean ops) and the explicitly-M4 multi-select/grouping,
**more primitives** is the best-bounded, lowest-risk, highest-leverage next step:

- Squarely in M2 scope (grouping is M4; gradients/boolean ops are large, export-/geometry-
  heavy slices deferred).
- Closes an obvious, visible gap in the drawing toolkit.
- Reuses the entire existing path pipeline (see §3), so the implementation surface is tiny.

## 3. Key insight — primitives are paths

`store.addVectorPath(path: PathData)` already:

- bbox-normalizes a **stage-space** `PathData` so its top-left sits at local origin,
- creates a `shapeType: 'path'` `VectorAsset` + `SceneObject` (anchorMode `'fraction'`,
  centered pivot) positioned by the object transform,
- selects the new object and switches to the `node` tool.

Therefore any tool that can **generate** a `PathData` inherits — with zero new engine,
render-seam, export, runtime, or persistence work — full creation, node editing, path
morphing, per-node easing, fill/stroke color animation, motion-path following, and HTML5
export. The whole downstream stack already operates on paths.

So Slice 6 is, in essence, **three pure path generators + tool wiring**.

## 4. Chosen approach — "stamp a primitive, get a path" (static PathData)

We emit a static `PathData` at creation rather than introducing parametric shape types.

Rejected alternative — **parametric `VectorShapeType`s** (`'polygon'|'star'|'line'` with
params stored on the asset, regenerated in the render seam): allows re-editing sides/radius
after creation, but adds new shape types, a generator branch in the `renderShape` /
`geometryToSvgAttrs` seam, and a persistence migration — more risk and surface for a
marginal-this-slice benefit.

The one capability the static approach gives up — re-editing "5 points → 6" after the
fact — is recovered **at creation time** via *tool options* (UI state used by the
generator, not stored parametrically). Created primitives are ordinary editable paths.

This means: **no new `VectorShapeType`, no engine render-seam change, no persistence
version bump, no export/runtime change.** Stays at project version 4.

## 5. Engine — `src/engine/primitives.ts` (pure)

New pure module, tested as the parity oracle (it is the single source of geometry truth;
the same generated `PathData` previews and exports because everything downstream is the
existing path pipeline). All generators return `PathData` with **corner** nodes (no bezier
handles → `in`/`out` absent), in stage-space coordinates.

```ts
// Regular n-gon. `rotation` in radians; angle 0 places the first vertex at angle
// -90° (pointing up) by convention so polygons/stars read upright.
polygonPath(cx: number, cy: number, radius: number, sides: number, rotation?: number): PathData
//   nodes: `sides` corner anchors evenly spaced on the circle; closed: true.
//   sides clamped to >= 3.

starPath(cx: number, cy: number, outerRadius: number, innerRadius: number, points: number, rotation?: number): PathData
//   nodes: 2*points corner anchors alternating outer/inner radius; closed: true.
//   points clamped to >= 2.

linePath(p0: PathPoint, p1: PathPoint): PathData
//   nodes: [p0, p1] corner anchors; closed: false.
```

Notes:
- First-vertex-up convention keeps a freshly stamped polygon/star visually upright.
- `innerRadius` for the star is derived from `outerRadius * starInnerRatio` by the caller
  (the generator takes an absolute inner radius; the UI owns the ratio).
- Degenerate guards: a zero-radius drag (no meaningful size) is handled by the UI commit
  (it does not call `addVectorPath`, which itself already no-ops on `< 2` nodes).

No other engine file changes.

## 6. Store — `src/ui/store/store.ts`

- `ToolMode` gains `'polygon' | 'star' | 'line'`:
  `'select' | 'pen' | 'node' | 'rect' | 'ellipse' | 'motion' | 'polygon' | 'star' | 'line'`.
- Tool-option state + setters (defaults in parens):
  - `polygonSides: number` (5), `setPolygonSides(n)`
  - `starPoints: number` (5), `setStarPoints(n)`
  - `starInnerRatio: number` (0.5), `setStarInnerRatio(r)`  // inner/outer, clamp (0,1)
- **No new creation action** — the Stage tool generates a `PathData` and calls the existing
  `addVectorPath`. Setters clamp (sides ≥ 3, points ≥ 2, ratio in (0,1)).
- `setActiveTool` already exists and is reused; primitive tools need no special branch
  (unlike `node`/`motion`), but switching away behaves like other non-node tools.

## 7. Stage / interaction — `src/ui/components/Stage/usePathTools.ts` (+ Stage pointer routing)

Click-drag creation, mirroring the existing rect/ellipse drag and pen-draft commit pattern:

- **Polygon / Star:** pointer-down sets the **center**; drag distance = `radius`, drag
  angle = `rotation`. Live preview renders the generated path imperatively during drag.
  On release: if radius below a small threshold → cancel (no commit); else generate via
  `polygonPath` / `starPath` (star inner = `radius * starInnerRatio`) and call
  `addVectorPath`. One undo step.
- **Line:** pointer-down = `p0`, drag = `p1`; release commits `linePath(p0, p1)` (cancel
  if the two points are ~coincident).
- Coordinate mapping reuses the existing client→stage-local CTM helper already used by pen
  and rect/ellipse drawing.
- Stage pen/draw pointer routing is broadened to include the three primitive tools.

## 8. UI surface

- **ToolPalette** (`src/ui/components/Toolbar/`): add Polygon, Star, Line buttons with the
  existing active/aria-pressed pattern.
- **Keyboard** (`src/ui/hooks/useKeyboard.ts`): `G`→polygon, `S`→star, `L`→line (verified
  free; existing V/P/N/R/E/M unchanged). Lowercase + uppercase cases like siblings.
- **Tool options:** a small control row (rendered when a primitive tool is active) bound to
  the store tool-option state — a number input for polygon sides, and number inputs for
  star points + inner-radius ratio. Placement next to/below the palette (a `Toolbar`
  sub-area); kept minimal and consistent with existing inputs (e.g. `NumberField`).

## 9. Export / runtime / persistence

Unchanged. Primitives are `shapeType: 'path'` objects; export inlining, the runtime bundle,
parity, and `.savig` persistence all already handle paths. **No migration, no version bump.**

## 10. Testing

- **Engine unit (parity oracle):** `polygonPath` — vertex count/positions, closed,
  first-vertex-up, rotation; `starPath` — `2*points` alternating radii, closed; `linePath`
  — open 2-node. Determinism + clamp guards.
- **Store unit:** ToolMode extension; tool-option setters + clamping.
- **Stage/interaction unit:** drag→commit produces an object whose path matches the
  generator (within float tolerance) at the dragged size; sub-threshold drag does not
  commit; single undo step.
- **Keyboard unit:** G/S/L set the active tool.
- **e2e (Playwright, real chromium):** select Star tool → drag to stamp → node-morph
  keyframe (reusing existing morph authoring) → export → assert the exported bundle
  animates. One new e2e, mirroring prior slices.

## 11. Slice structure (plans)

Mirrors the established engine→UI rhythm:

- **Plan A — Engine:** `engine/primitives.ts` generators + tests. Self-contained, shippable.
- **Plan B — UI/tools:** ToolMode + tool-option state, Stage drag-to-stamp, palette buttons,
  shortcuts, tool-options row, e2e.

## 12. Deferred (tracked, not built this slice)

- True **parametric re-editing** (change sides/points/inner-ratio after creation; would
  reintroduce parametric shape types or a derived-from-params asset field).
- **Rounded-corner** polygons/stars; star tip "sharpness"/skew controls.
- **Freehand brush** (point capture + simplification → PathData).
- **Gradients** (defs model, stop animation, export/namespacing) — larger slice.
- **Boolean ops** (union/intersect/subtract; needs robust polygon clipping).
- **Multi-select / grouping** — explicitly M4.
