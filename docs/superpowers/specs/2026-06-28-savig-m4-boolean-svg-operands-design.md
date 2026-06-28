# Boolean — SVG-Asset Objects as Operands — Design

**Date:** 2026-06-28
**Status:** Draft (pending review)
**Area:** Savig M4 — boolean follow-ups
**Scope:** Allow an SVG-asset object to be a boolean operand (its filled outline joins the clip)

## Context

A boolean operand's geometry comes from `operandWorldGeom` → `objectToWorldPolygon` → `localOutline`,
which only handles VECTOR assets (rect/ellipse/path). `assetOf` returns `undefined` for an SVG asset
(`kind: 'svg'`), so an SVG object contributes no geometry and is excluded from boolean eligibility on
both the engine and the authoring side. SVG assets are stored as raw, sanitized, id-namespaced markup
(`SvgAsset.normalizedContent`) with a `viewBox` and a render box `width`×`height`.

## Goal

An SVG-asset object can be a boolean operand. Its contribution is the UNION of its filled shapes —
i.e. the SVG treated as one merged region (like a group of shapes) — clipped against the other
operands. Destructive and live booleans both accept it; render and export agree (the geometry is
derived deterministically from the markup, no browser SVG APIs).

### v1 scope (deliberately bounded)

- **Elements:** `<path>`, `<rect>`, `<circle>`, `<ellipse>`, `<polygon>`. `<polyline>`/`<line>` have no
  fill area → ignored. `<g transform>` nesting is followed.
- **Path `d`:** commands `M m L l H h V v C c S s Q q T t A a Z z` (absolute + relative), flattened to
  polylines (cubic/quadratic via De Casteljau; arcs via center-parameterization → sampled points).
- **Transforms:** the element/ancestor `transform` attribute (`matrix translate scale rotate skewX
  skewY`) composed into a 2×3 matrix, then the `viewBox` → `width`×`height` mapping, then the object's
  world transform (via the existing `toWorld`).
- **Fill model:** each subpath/shape becomes one positive ring; all rings are UNIONED (so a multi-shape
  SVG acts as its merged silhouette). **Faceted** (curves flattened, no provenance — like groups).
- **Excluded (documented, fail-safe to empty/ignored):** `<use>`/`<defs>` references, `<text>`,
  `clip-path`/`mask`, even-odd HOLES (a donut SVG fills solid in v1 — see Deferred), stroke geometry
  (fill regions only), CSS `display:none`/`visibility`, percentage/unit dimensions.

## Architecture

Three layers, each independently testable, all pure-JS (run in jsdom + the runtime bundle):

### Component 1: SVG path-`d` parser — `geom/svg/parsePathD.ts`

`parsePathD(d: string): PathCommand[]` — tokenize the `d` string into a flat command list with absolute
coordinates resolved (relative commands folded against the running point; `S`/`T` reflect the previous
control point; `H`/`V` carry the current y/x; `Z` closes to the subpath start). Output:
`type PathCommand = { type: 'M'|'L'|'C'|'Q'|'A'|'Z'; ... }` with absolute numbers. Pure string→data, no
geometry. This is the bulk of the parsing risk; it is fully unit-testable in isolation.

### Component 2: flattener — `geom/svg/flattenSvg.ts`

`flattenElementToRings(el: Element, ctm: Mat2x3): Pair[][]` — for one drawable element, produce closed
polygon rings in a target coordinate frame (`ctm` = composed transform):

- `rect`/`circle`/`ellipse`/`polygon` → direct point lists (circle/ellipse sampled at `N` steps).
- `path` → `parsePathD` → walk commands, accumulating points per subpath; cubic/quadratic flattened by
  De Casteljau at `FLATTEN_STEPS`; `A` via center-parameterization (endpoint→center conversion) sampled
  by sweep angle. Each `Z` (or a new `M`) closes a subpath ring.
- Every emitted point is mapped through `ctm`.

`svgAssetRings(asset: SvgAsset): Pair[][]` — `DOMParser` the `normalizedContent`, compute the root
`viewBox → 0..width × 0..height` matrix (translate(−minX,−minY) then scale(width/vbW, height/vbH)),
walk the tree composing each element's `transform` (parsed by a small `parseTransformList`), and concat
all elements' rings. Result: rings in the SVG's OBJECT-LOCAL frame (the same `0..width × 0..height`
space rect/ellipse local outlines live in), ready for `toWorld`.

### Component 3: boolean integration — `operandWorldGeom` SVG branch

`src/engine/geom/boolean.ts`. Add, after the boolean/group branches:

```ts
// SVG asset operand: the UNION of its filled shapes, mapped to world coords. Faceted (no provenance).
const svg = svgAssetOf(project, obj); // returns the SvgAsset or undefined
if (svg) {
  const localRings = svgAssetRings(svg);          // object-local (0..w x 0..h) frame
  const state = sampleObject(obj, time);
  const { anchorX, anchorY } = resolveAnchor(obj, state, undefined); // svg uses no shapeType box
  const world = localRings
    .map((r) => r.map(([x, y]) => { const w = toWorld(project, obj, anchorX, anchorY, { x, y }, time); return [w.x, w.y] as Pair; }))
    .filter((r) => r.length >= 3)
    .map((r) => [...r, r[0]]);                     // close GeoJSON-style
  if (world.length === 0) return [];
  return world.length === 1 ? [world[0]] : pc.union([world[0]], ...world.slice(1).map((r) => [r]));
}
```

(`svgAssetOf` mirrors `assetOf` but for `kind === 'svg'`. The SVG branch sits in `operandWorldGeom`, so
it flows through `booleanResultGeom`'s flat-geom path with NO provenance — faceted, consistent with
groups. `operandCubicsWorld` already returns `[]` for a non-vector asset, so no guard needed there.)

### Component 4: authoring eligibility + style guard

Keep `vectorLeavesOf` (store) and `hasVectorLeaf` (Inspector) returning ONLY vector leaves — they are
the STYLE source and must never yield an SVG object. Instead:

- **Eligibility (widen, separately):** an object is a boolean operand if `vectorLeavesOf(o).length > 0`
  OR it is a DIRECT SVG-asset object (`!o.isGroup && asset.kind === 'svg'`). In the store the `eligible`
  filter becomes `vectorLeavesOf(o).length > 0 || isSvgOperand(o)`; `Inspector.canBool` mirrors it. A
  live boolean's `operandIds` then include the SVG object. (v1: a DIRECT SVG object only — an SVG
  buried inside a GROUP operand is deferred, since `collectVectorLeaves` collects vector leaves only;
  see Deferred.)
- **Style guard (CRITICAL — both sites):** the live-boolean style pick AND the destructive style pick
  BOTH do `topLeaf = eligible.flatMap(vectorLeavesOf).sort(byZ desc)[0]` then `topAsset = … as
  VectorAsset; style: { ...topAsset.style }`. Since `vectorLeavesOf` stays vector-only, `topLeaf` is
  always a vector leaf OR `undefined` (an all-SVG selection). Guard BOTH sites identically: when
  `topLeaf` is `undefined`, build the result asset WITHOUT a `style` override so `createVectorAsset`
  applies `DEFAULT_VECTOR_STYLE` (an SVG asset has no `VectorStyle` to inherit). The current code casts
  `as VectorAsset` and reads `.style` unconditionally at both sites — that must become
  `topLeaf ? { ...(topAsset).style } : DEFAULT_VECTOR_STYLE` (or omit `style`).

An SVG operand in a LIVE boolean is render-hidden like any operand (it's in the `consumed` set, which
is keyed purely on `operandIds`, no asset-kind gating). A destructive SVG operand is removed + its
asset pruned with the existing share/instance protection.

## Edge cases

- **viewBox absent:** `importSvg.resolveDimensions` guarantees a `viewBox` on the stored asset, so the
  mapping always exists.
- **Empty / unsupported-only SVG** (e.g. only `<text>`): `svgAssetRings` → `[]` → the operand
  contributes nothing → handled by the `< 2 geoms` degenerate path.
- **Even-odd holes** (a donut): v1 unions all subpaths as positive → the hole fills. Documented; a
  follow-up can honor `fill-rule` by classifying subpath containment.
- **Self-intersecting / degenerate rings:** `polygon-clipping` tolerates them in the union; a ring with
  `< 3` points is dropped.
- **Parser robustness:** `parsePathD` must never throw on malformed `d` — on an unparseable token it
  stops that subpath and returns what it has (a `try/catch` at `svgAssetRings` falls back to skipping
  the element, never corrupting the whole operand).
- **Live + export parity:** identical code path (`operandWorldGeom` → `svgAssetRings`) for editor
  render, `computeFrame`, and `renderSvgDocument`; the runtime bundle must be regenerated (frame.ts
  bundles the engine).

## Files touched

- `src/engine/geom/svg/parsePathD.ts` (new) + test
- `src/engine/geom/svg/flattenSvg.ts` (new: `flattenElementToRings`, `svgAssetRings`, `parseTransformList`) + test
- `src/engine/geom/boolean.ts` — `svgAssetOf` + the SVG branch in `operandWorldGeom`
- `src/engine/geom/boolean.test.ts` — an SVG-asset operand clips correctly
- `src/ui/store/store.ts`, `src/ui/components/Inspector/Inspector.tsx` — eligibility predicates
- `src/runtime/runtimeSource.generated.ts` — regenerated (engine change is bundled)
- An e2e exercising an SVG object in a boolean

## Testing

- **`parsePathD` (unit):** M/L/H/V/C/S/Q/T/A/Z, abs+rel, S/T reflection, Z-close; malformed `d` returns
  a partial list without throwing.
- **`flattenSvg` (unit):** a `<rect>` → 4 corner points at the right coords; a `<circle>` → N points on
  the circle; a `<path>` cubic → flattened points whose midpoint lies on the curve; a `transform` +
  viewBox maps points correctly; `svgAssetRings` over a 2-shape SVG → 2 rings (or a merged ring after
  union at the boolean layer).
- **Engine (unit):** an SVG asset whose markup is a single `<rect>` used as a boolean operand →
  `resolveBooleanRings(intersect(svgObj, coveringRect))` equals that rect's region; a 2-circle SVG
  unioned/intersected behaves as the merged silhouette; an empty/`<text>`-only SVG → degenerate `[]`.
- **Authoring (unit):** an SVG object + a rect are boolean-eligible (`canBool`); a live boolean from
  {svg, rect} stores both `operandIds`.
- **E2E:** import a simple SVG, place it, select it + a rect, Subtract → the SVG silhouette cuts the
  rect.
- **Parity:** non-SVG booleans byte-identical (the SVG branch only fires for `kind === 'svg'`).

## Open / deferred

- **An SVG object inside a GROUP operand** (v1 supports a DIRECT SVG operand only; `collectVectorLeaves`
  collects vector leaves, so an SVG group member contributes nothing until its branch is added).
- **Even-odd / nonzero holes** (donut SVGs fill solid in v1). The engine + e2e tests deliberately avoid
  donut SVGs; a donut filling solid is a known v1 limitation, not a bug to file.
- **Curve preservation** for SVG operands (flattened/faceted in v1; would need provenance through the
  parser, like the group/nested curve task).
- **Stroke geometry, `<use>`/`<text>`/clip-path/mask**, percentage units.
- Performance: `svgAssetRings` re-parses the markup each frame; a parse cache keyed on the asset id +
  flatten resolution is a cheap follow-up if profiling warrants (mirrors the 3d decision discipline).
