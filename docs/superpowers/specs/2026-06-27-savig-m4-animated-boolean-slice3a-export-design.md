# Animated Boolean — Slice 3a: Standalone Export — Design

**Date:** 2026-06-27
**Status:** Approved (pending spec review)
**Area:** Savig M4 — boolean follow-ups (animated boolean milestone, slice 3a)
**Scope:** Make a standalone `.savig` export render + animate a live boolean (initial markup only)

## Milestone context

Slice 1 shipped live-boolean geometry (rendered + animated in the editor; the runtime bundle's
`computeFrame` computes the boolean `pathD` per frame). Slice 2 shipped authoring (Alt-modifier).
But a standalone EXPORT still renders a live boolean blank: `renderSvgDocument` (the exported
initial SVG markup) emits **no `<path>`** for a boolean node, so the embedded runtime — which sets
`d` on *existing* nodes — has nothing to animate. Slice 3a fixes the export initial markup. (Later
sub-slices: 3b group/nested operands, 3c editing-UX + Alt-aware button, 3d perf caching.)

## The gap

`renderShapeToSvg` (renderShape.ts:73-74) returns `''` for a path whose `path` is empty, and a
live boolean's `VectorAsset` carries an empty fallback `path`. `renderSvgDocument` therefore emits
`<g data-savig-object="…"></g>` with no `<path>` child for a boolean. The runtime's `computeFrame`
already computes the boolean (Slice 1) and `applyFrameToNodes` would set `d` on the node's first
child — but there is no child. So nothing renders. (Operands are already flatten-skipped from the
export, so they correctly don't draw.)

## Goal

A standalone export of a project containing a live boolean emits a `<path fill-rule="evenodd"
d="<time-0 clipped d>">` for the boolean node (operands absent), so the embedded runtime animates
its `d` per frame — matching the editor.

### Non-goals (3a)

- No runtime-bundle change: the runtime already bundles `polygon-clipping` and computes the boolean
  per frame (Slice 1). 3a touches only the export-time initial markup (`renderSvgDocument`), a
  separate codepath.
- Group / nested-boolean operands (3b); editing UX + Alt-aware button (3c); perf caching (3d).
- Root-scene only (Slice 1/2 boundary).

## Architecture

`renderSvgDocument` already handles the analogous MORPH case: a morphed path's initial markup uses
the frame-0 sample, and an empty frame-0 still emits a `<path d=""/>` so the runtime can animate it
once later keyframes have nodes (renderDocument.ts:79-84). A live boolean mirrors this, plus needs
`fill-rule="evenodd"` (its result may have holes).

### Component 1: `renderShapeToSvg` — `forceEvenOdd` param

`src/engine/renderShape.ts` — add an optional param and force the fill-rule:

```ts
export function renderShapeToSvg(
  shapeType: VectorShapeType,
  geometry: ResolvedGeometry,
  style: VectorStyle,
  path?: PathData,
  idScope?: string,
  gradientPaint?: { fill?: boolean; stroke?: boolean },
  dashOffset?: number,
  compoundRings?: PathData[],
  forceEvenOdd?: boolean,
): string {
  if (shapeType === 'path') {
    if (!path || path.nodes.length === 0) return '';
    const hasRings = !!compoundRings && compoundRings.length > 0;
    const attrs: Record<string, string> = {
      d: hasRings ? pathToDRings(path, compoundRings) : pathToD(path),
      ...((forceEvenOdd || hasRings) ? { 'fill-rule': 'evenodd' } : {}),
      ...styleToSvgAttrs(style, idScope, gradientPaint, dashOffset),
    };
    // …unchanged…
  }
  // …rect/ellipse unchanged…
}
```

`forceEvenOdd` is optional (default falsy) so existing callers (`buildBundle`, `thumbnailSvg`,
non-boolean `renderDocument`) are byte-identical. A boolean always carries evenodd even if its
time-0 frame has no hole (a later frame's hole then cuts correctly; the runtime sets `d`, not
fill-rule).

### Component 2: `renderSvgDocument` — boolean-aware path branch

`src/services/export/renderDocument.ts` (path branch ~63-84). When `obj.boolean`, compute the
time-0 rings and feed them to `renderShapeToSvg`:

```ts
const boolRings = obj.boolean ? resolveBooleanRings(project, obj, 0) : null;
const framePath = obj.boolean
  ? boolRings![0]                                   // may be undefined when degenerate
  : asset.shapeType === 'path' ? (state.path ?? asset.path) : undefined;
const pathBox = framePath ? pathBounds(framePath) : undefined;
const { anchorX, anchorY } = resolveAnchor(obj, state, asset.shapeType, pathBox);
const transform = (groupPrefix ? groupPrefix + ' ' : '') + buildTransform(state, anchorX, anchorY);
let shape = renderShapeToSvg(
  asset.shapeType,
  state.geometry ?? {},
  asset.style,
  framePath,
  leaf.renderId,
  { fill: !!fillGrad, stroke: !!strokeGrad },
  state.strokeDashoffset,
  obj.boolean ? boolRings!.slice(1) : (asset.shapeType === 'path' ? asset.compoundRings : undefined),
  !!obj.boolean, // forceEvenOdd
);
// A boolean (or morphed) path whose initial shape is empty still needs a <path> child so the
// runtime can animate `d` once the clip is non-empty.
if (!shape && asset.shapeType === 'path' && (obj.boolean || (obj.shapeTrack && obj.shapeTrack.length > 0))) {
  shape = obj.boolean ? '<path fill-rule="evenodd" d=""/>' : '<path d=""/>';
}
```

Import `resolveBooleanRings` from `../../engine`. `project` (the function param) and the time-0
flatten (`flattenInstances(project, 0)`, renderDocument.ts:25) make the rings consistent with the
exported initial frame. The boolean node renders under its identity transform with world-space
geometry, exactly as in the editor.

## Edge cases

- **Degenerate / empty boolean at time 0** (e.g. a subtract whose operands don't yet overlap) →
  `boolRings` empty → `framePath` undefined → `renderShapeToSvg` returns `''` → the empty-fallback
  emits `<path fill-rule="evenodd" d=""/>`; the runtime fills `d` once the clip is non-empty.
- **Boolean with a hole at time 0** → `boolRings` has ≥2 rings → `d` is a compound path (≥2
  subpaths) + evenodd cuts the hole.
- **Boolean with no hole at time 0** → 1 ring → `d` is one subpath, fill-rule still evenodd (forced).
- **Operands** → flatten-skipped (Slice 1), absent from the export markup.
- **Non-boolean objects** → `obj.boolean` absent → the existing morph/static branch runs,
  byte-identical (the `forceEvenOdd` arg is `false`).

## Files touched

- `src/engine/renderShape.ts` — `renderShapeToSvg` gains `forceEvenOdd?`.
- `src/engine/renderShape.test.ts` (exists) — `forceEvenOdd` emits evenodd without compoundRings.
- `src/services/export/renderDocument.ts` — boolean-aware path branch.
- `src/services/export/renderDocument.test.ts` (exists) — live-boolean export tests.

## Testing

- **`renderShapeToSvg` (unit):** with a 1-ring path + `forceEvenOdd: true`, the output contains
  `fill-rule="evenodd"`; without it (and no compoundRings), it does not — non-boolean parity.
- **`renderSvgDocument` (unit):** a project with a live boolean (two overlapping rects) →
  - the output contains `<g data-savig-object="boolobj"…>` with a `<path … fill-rule="evenodd"
    d="…">` whose `d` is the time-0 clipped result (non-empty);
  - the operand ids do NOT appear as `data-savig-object` (flatten-skipped);
  - a `subtract` of an interior operand → the boolean `<path>` `d` has ≥2 subpaths (`/M/g` ≥ 2);
  - a degenerate boolean (non-overlapping intersect) → `<path fill-rule="evenodd" d="">` placeholder.
- **Parity:** existing `exportProject.test` / morph export tests stay green (non-boolean unchanged).

## Open / deferred (later sub-slices)

- 3b: group + nested-boolean operands (consumed-skip subtree + recursive `resolveBooleanRings` +
  re-include groups/booleans in live eligibility).
- 3c: editing-operand UX (see/select render-hidden operands on canvas) + render-time Alt-aware
  button-disabled state.
- 3d: per-frame clip caching (only if profiling warrants).
