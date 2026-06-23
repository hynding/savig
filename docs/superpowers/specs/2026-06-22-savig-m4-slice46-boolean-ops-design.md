# Savig M4 Slice 46 — Boolean path ops (union / subtract / intersect / exclude)

**Date:** 2026-06-22
**Status:** Approved (M4 headline feature — first of the two remaining: boolean ops, then nested symbols)
**Depends on:** vector foundation (PathData, `flattenPath`, `pathBounds`, `createVectorAsset`),
group containers 45a–45f (`groupTransformPrefix`/`mapPoint` world-transform machinery).

## 1. Goal

Select ≥2 vector shapes and combine them with a set operation — **Union**, **Subtract**,
**Intersect**, **Exclude (XOR)** — producing one new path object. Wired into the Inspector
multi-select panel (alongside Group / Align) and keyboard shortcuts. This is the first of the
two remaining M4 headline features; it is its own multi-slice sub-project because robust
polygon clipping is hard to get right.

## 2. Key decisions (settled in brainstorming)

- **Clipper = the `polygon-clipping` dependency** (mfogel; MIT; zero deps of its own; the
  Martinez-Rueda-based lib Turf.js uses). Robust polygon clipping is the canonical
  "don't roll your own" geometry problem — degeneracies (coincident edges, vertex-on-edge,
  collinear overlaps) are exactly what users produce with snapping/grid alignment, and a
  hand-rolled clipper carries multi-day effort + subtle data-dependent bug risk for the
  payoff of one fewer dep. This is the **one** place we break the lean-dependency ethos by
  one well-justified runtime dep (4 → 5). The project's real value-add — baking paths through
  their transform chain, flattening, rebuilding clean `PathData` — is still all from-scratch.
- **Destructive replace.** The op consumes the selected source objects and replaces them with
  one new result path object. Matches Figma "Flatten" / Illustrator Pathfinder; the existing
  history/undo stack makes it fully reversible, so we get the clean result *and* safety.
- **Curves flatten to polygons** (16 steps/segment via the existing `flattenPath`). The result
  is a polygon path — the standard trade-off for raster-free boolean ops.

## 3. Decomposition (3 sub-slices)

### 46a — Boolean engine (pure, no UI) — `src/engine/geom/boolean.ts`

The reusable primitive is **"map a flattened path through its full transform chain into world
space."** Everything else is glue.

```
objectToWorldRings(project, obj, time): Ring[]      // Ring = {x,y}[]; we close rings GeoJSON-style
                                                    //   (first==last) at the polygon-clipping boundary
  outline = local closed polyline(s) for obj:
    - shapeType 'path'  -> flattenPath(asset.path).pts  (a closed path's flatten already ends
                            back at the start point — the GeoJSON closed-ring form we want)
    - 'rect'            -> 4 corners from shapeBase/base (w,h)
    - 'ellipse'         -> flatten an ellipse outline (N steps)
  resolve the object's ABSOLUTE anchor (ax,ay) via pathBounds + anchorMode (reuse
    resolveObjectAnchor / the fraction logic the renderer uses)
  for the object's own transform then each group ancestor (immediate -> outermost):
    map every point through mapPoint(sample(t), anchor)   // reuse groupTransform.ts math
  -> world-space ring(s)

booleanOp(project, objs, op, time): Ring[]            // op: 'union'|'subtract'|'intersect'|'exclude'
  per-object MultiPolygon = objectToWorldRings(...)
  union     = polygonClipping.union(all)
  intersect = polygonClipping.intersection(all)
  exclude   = polygonClipping.xor(all)
  subtract  = polygonClipping.difference(BOTTOM, ...rest)   // bottom = lowest zOrder; rest = the upper shapes
  -> flatten the resulting MultiPolygon to a flat Ring[] (outer rings + hole rings together;
     polygon-clipping already orients them; even-odd fill renders holes regardless of winding)
```

`mapPoint` is currently private to `groupTransform.ts`; export it (and reuse `sampleObject` /
the anchor resolution) rather than duplicating the matrix.

### 46b — Compound-path rendering (the holes data-model change)

A boolean result routinely has **holes** (interior subtract → annulus) and **disjoint pieces**
(disjoint union). One `PathData` ring cannot express a hole, so add to `VectorAsset`:

```ts
/** Extra closed rings rendered together with `path` using fill-rule:evenodd — boolean-op
 *  results with holes/disjoint pieces (slice 46). Render/export/transform-only in v1:
 *  node-editing and morph operate on the primary `path` only. */
compoundRings?: PathData[];
```

- **Render** (`pathToD` / `renderShape` / Stage): when `compoundRings` is present, emit each
  ring as its own `M…Z` subpath appended to the primary `d`, and set `fill-rule="evenodd"`.
- **Bounds** (`pathBounds` and any AABB used for handles/selection): span the primary path
  **and** all compound rings.
- **Export** (`renderDocument` runtime): same `d` concatenation + `fill-rule`; verify export
  parity with the editor.
- **Hit-testing / selection outline:** include compound rings (a click inside the outer ring
  but inside a hole is, per even-odd, *outside* the shape — acceptable v1; selection by
  bbox/outer ring is fine).
- Node editor, morph, primitive re-edit: **untouched** — they read `path` (the primary ring)
  and ignore `compoundRings`. A path with compound rings is still selectable/movable/
  scalable/animatable as a whole (transform applies to the object, not per-ring).

### 46c — Store action + UI — `booleanOp` in `store.ts`, Inspector + keyboard

```
booleanOp(op):
  ids = current selection; objs = resolve, require >=2 AND all vector AND none isGroup (else no-op)
  rings = booleanOp(project, objs, op, currentTime)        // world space
  if rings empty -> no-op (e.g. intersect of disjoint shapes)
  primary = the largest-area ring; rest -> compoundRings
  normalize primary to its bbox origin (like addVectorPath); offset compoundRings by the SAME
    (-bbox.x,-bbox.y) so they stay registered to the primary
  asset = createVectorAsset('path', { path: primary, compoundRings, style: <topmost source's style> })
  obj   = createSceneObject(asset.id, { base:{...DEFAULT_TRANSFORM, x:bbox.x, y:bbox.y},
            anchorMode:'fraction', anchorX:0.5, anchorY:0.5, zOrder: nextZOrder(objects), name:<Op name> })
  commit: remove the source objects, add asset+obj   // assets orphaned exactly as deleteSelectedObject leaves them
  select the new object
```

- **Inspector** multi-select panel (`Inspector.tsx`, the `selectedIds.length > 1` block): a row
  of 4 buttons — Union / Subtract / Intersect / Exclude — gated `disabled` on
  `eligibleCount >= 2` where eligible = vector && !isGroup. (Same pattern as the
  movable-count gating already there for Align/Distribute — never enable a silent no-op.)
- **Keyboard** (`useKeyboard.ts`): no default modifier set is universally standard for booleans;
  reuse the existing `mod`-based pattern with un-conflicting keys, **or** ship buttons-only in
  v1 and defer shortcuts (decide in the plan; buttons-only is acceptable). No new global key
  may collide with existing `Cmd+G/D/C/X/V/Z/[/]`.

## 4. Semantics (fixed)

- **Subtract** removes the upper shape(s) from the **bottom-most** (lowest `zOrder`) shape —
  Figma "Subtract". Union / Intersect / Exclude are order-independent.
- **Result style** inherits the **topmost** (highest `zOrder`) source's `VectorStyle`.
- **Result placement:** single new object at the top of z-order, selected, primary ring
  node-editable.
- **Eligibility:** ≥2 selected, all `kind==='vector'`, none `isGroup`. SVG-asset objects and
  groups are excluded (buttons disabled) — documented for a later slice.

## 5. Scope (YAGNI) / v1 limitations (documented)

- **Curves → polygons** on the result (no curve-fitting back).
- **Animated sources collapse to a static snapshot** at the current frame.
- **Compound rings are not node-editable** in v1 (render/export/transform only).
- **Groups & SVG-asset objects are not eligible** operands in v1 (a group would need a
  union-of-leaf-descendants pass — deferred).
- **Non-uniformly-scaled rotated group ancestors** introduce the same shear approximation
  `bakeGroupIntoChild` already documents.
- **No non-destructive / live compound shapes** (the result is flattened, not a re-editable
  boolean tree).

## 6. Testing

- **46a (engine):** overlapping union → 1 ring; interior subtract → 2 rings (outer + hole);
  disjoint union → 2 rings; intersect of overlap → 1 ring; intersect of disjoint → empty;
  exclude → ring set with hole; **world-bake correctness** — a shape translated/scaled/rotated
  by its object transform, and one nested under a group ancestor, bakes to the expected world
  coordinates (compare against `mapPoint` applied directly).
- **46b (render):** `compoundRings` emits all subpaths in `d` + `fill-rule="evenodd"`;
  `pathBounds` spans all rings; export `renderDocument` matches the editor `d`.
- **46c (store + e2e):** `booleanOp` destructive replace removes sources and adds one selected
  result; **undo** restores the original sources; eligibility gating (no-op with <2 / a group /
  an SVG object selected; empty result is a no-op); Playwright e2e — draw two overlapping
  shapes → Subtract (interior) → an annulus renders (hole visible).

## 7. Risks

- **`polygon-clipping` output shape:** returns `MultiPolygon` = `Polygon[]` = `Ring[][]` where
  ring[0] is outer and the rest are holes; our flat `Ring[]` + even-odd fill renders correctly
  regardless of per-ring winding, so we don't depend on its orientation guarantees beyond
  "rings close the regions."
- **Degenerate / empty results** (full subtract, disjoint intersect) must no-op cleanly, not
  create a zero-node object.
- **Bundle size / license:** confirm `polygon-clipping` is MIT and adds modest weight before
  committing the dep; pin the version.
- **Float precision at the bake step:** flattening then clipping in world units is fine; we do
  not round-trip through the editor's per-frame transform, so no accumulation.
