# SVG-Asset Objects as Boolean Operands — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an SVG-asset object be a boolean operand — its filled shapes' UNION (in world coords) joins the clip, derived deterministically from the markup (no browser SVG APIs), so editor render, `computeFrame`, and export agree.

**Architecture:** Three pure-JS layers: (1) `parsePathD` — SVG path `d` → absolute command list; (2) `flattenSvg` — elements → world-frame polygon rings (shapes + path flattening + transform/viewBox composition), exposing `svgAssetRings(asset)`; (3) an `operandWorldGeom` SVG branch unioning those rings. Faceted (no curve provenance), like groups.

**Tech Stack:** TypeScript (strict), polygon-clipping, DOMParser (jsdom + browser), Vitest, Playwright. No new dependency (in-house parser, matching the project's dep-lean stance).

## Global Constraints

- **Pure-JS, jsdom-safe:** no `getPointAtLength`/`getTotalLength`/`SVGGeometryElement` APIs (unavailable in jsdom and untestable). DOMParser is fine (jsdom provides it).
- **v1 elements:** `<path> <rect> <circle> <ellipse> <polygon>` + `<g transform>` nesting. `<polyline>/<line>` ignored (no fill area).
- **v1 `d` commands:** `M m L l H h V v C c S s Q q T t A a Z z` (absolute + relative).
- **Faceted:** curves flattened (De Casteljau / arc sampling), no provenance. The SVG operand = the UNION of all its filled shapes (merged silhouette).
- **Fail-safe:** `parsePathD` never throws on malformed `d` (returns a partial list); `svgAssetRings` skips an unparseable element rather than corrupting the operand.
- **Parity:** non-SVG booleans byte-identical (the SVG branch fires only for `kind === 'svg'`).
- **Runtime bundle regenerated** (the engine change is bundled via `frame.ts`).

---

### Task 1: SVG path `d` parser — `parsePathD`

**Files:**
- Create: `src/engine/geom/svg/parsePathD.ts`
- Test: `src/engine/geom/svg/parsePathD.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type PathCommand =
    | { type: 'M' | 'L'; x: number; y: number }
    | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
    | { type: 'Q'; x1: number; y1: number; x: number; y: number }
    | { type: 'A'; rx: number; ry: number; rot: number; large: boolean; sweep: boolean; x: number; y: number }
    | { type: 'Z' };
  export function parsePathD(d: string): PathCommand[];
  ```
  All coordinates ABSOLUTE. `H/V` fold into an `L`; `S` expands to `C` (reflect previous C/S control); `T` expands to `Q` (reflect previous Q/T control); relative commands fold against the running point; each `Z` emits `{type:'Z'}` and resets the running point to the subpath start.

**Algorithm (specify; implement against the tests):**
1. Tokenize: a scanner that emits command letters (`/[MmLlHhVvCcSsQqTtAaZz]/`) and numbers (a number regex handling signs, decimals, exponents, and implicit separators, e.g. `-1.5e3`, `.5.5` → `.5`,`.5`, flag chars in `A` are single-digit 0/1).
2. Maintain `cur` (current point), `start` (subpath start), `prevC` (last cubic control reflection point), `prevQ` (last quad control reflection point). A repeated command letter implies repetition (e.g. `L 1 2 3 4` = two L's); an `M` followed by more pairs implies subsequent `L`s.
3. Emit absolute `PathCommand`s per the type mapping above. On malformed input (NaN / missing args), stop and return the commands accumulated so far.

- [ ] **Step 1: Write the failing tests**

`src/engine/geom/svg/parsePathD.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parsePathD } from './parsePathD';

describe('parsePathD', () => {
  it('absolute M L with implicit repeat', () => {
    expect(parsePathD('M0 0 L10 0 10 10')).toEqual([
      { type: 'M', x: 0, y: 0 }, { type: 'L', x: 10, y: 0 }, { type: 'L', x: 10, y: 10 },
    ]);
  });
  it('relative m l fold against the running point', () => {
    expect(parsePathD('m5 5 l5 0')).toEqual([
      { type: 'M', x: 5, y: 5 }, { type: 'L', x: 10, y: 5 },
    ]);
  });
  it('H/V fold to absolute L', () => {
    expect(parsePathD('M0 0 H10 V20')).toEqual([
      { type: 'M', x: 0, y: 0 }, { type: 'L', x: 10, y: 0 }, { type: 'L', x: 10, y: 20 },
    ]);
  });
  it('S reflects the previous cubic control point into a C', () => {
    const out = parsePathD('M0 0 C0 10 10 10 10 0 S20 -10 20 0');
    expect(out[2]).toEqual({ type: 'C', x1: 10, y1: -10, x2: 20, y2: -10, x: 20, y: 0 });
  });
  it('Z closes and resets the running point to the subpath start', () => {
    const out = parsePathD('M2 2 L8 2 Z l1 0');
    expect(out[2]).toEqual({ type: 'Z' });
    expect(out[3]).toEqual({ type: 'L', x: 3, y: 2 }); // relative to (2,2), not (8,2)
  });
  it('A passes flags + endpoint through (absolute)', () => {
    const out = parsePathD('M0 0 A5 5 0 0 1 10 0');
    expect(out[1]).toEqual({ type: 'A', rx: 5, ry: 5, rot: 0, large: false, sweep: true, x: 10, y: 0 });
  });
  it('A flags may be packed with no separators (large=1, sweep=1)', () => {
    // the two flags are single 0/1 chars; "11" must scan as large=1 then sweep=1, not the number 11
    const out = parsePathD('M0 0 a5 5 0 11 10 0');
    expect(out[1]).toEqual({ type: 'A', rx: 5, ry: 5, rot: 0, large: true, sweep: true, x: 10, y: 0 });
  });
  it('exponent + no-separator coordinates scan correctly', () => {
    expect(parsePathD('M0 0 L-1.5e1.5')).toEqual([
      { type: 'M', x: 0, y: 0 }, { type: 'L', x: -15, y: 0.5 }, // "-1.5e1" then ".5"
    ]);
  });
  it('malformed d returns the partial list without throwing', () => {
    expect(() => parsePathD('M0 0 L10 garbage')).not.toThrow();
    expect(parsePathD('M0 0 L10 garbage')[0]).toEqual({ type: 'M', x: 0, y: 0 });
  });
});
```

- [ ] **Step 2: Run to verify they fail** — Run: `pnpm vitest run src/engine/geom/svg/parsePathD.test.ts` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement `parsePathD`** per the algorithm above (tokenizer + absolute folding + S/T/H/V expansion + Z reset + fail-safe).
- [ ] **Step 4: Run to verify they pass** — Run: `pnpm vitest run src/engine/geom/svg/parsePathD.test.ts` — Expected: PASS.
- [ ] **Step 5: Typecheck** — `pnpm tsc --noEmit`.
- [ ] **Step 6: Commit** — `git add src/engine/geom/svg/parsePathD.ts src/engine/geom/svg/parsePathD.test.ts && git commit -m "feat(svg): SVG path d parser (absolute command list)"`

---

### Task 2: Flattener — shapes, path flattening, transforms, `svgAssetRings`

**Files:**
- Create: `src/engine/geom/svg/flattenSvg.ts`
- Test: `src/engine/geom/svg/flattenSvg.test.ts`

**Interfaces:**
- Consumes: `parsePathD` (Task 1); `DOMParser`; `SvgAsset` (from `../../types`).
- Produces:
  ```ts
  export type Mat2x3 = [number, number, number, number, number, number]; // [a,b,c,d,e,f]
  export function parseTransformList(s: string | null): Mat2x3;            // identity for null/empty
  export function flattenElementToRings(el: Element, ctm: Mat2x3): [number, number][][];
  export function svgAssetRings(asset: SvgAsset): [number, number][][];    // object-local (0..w x 0..h)
  ```

**Algorithm:**
- `parseTransformList`: parse `matrix(...) translate(...) scale(...) rotate(...) skewX(...) skewY(...)` left-to-right, composing each into the accumulator (`compose(A,B)` = standard 2×3 multiply). `rotate(a cx cy)` = translate(cx,cy)·rotate(a)·translate(−cx,−cy).
- `flattenElementToRings(el, ctm)` by `el.tagName`:
  - `rect` → 4 corners from x/y/width/height (ignore rx/ry in v1) → one ring.
  - `circle` → `N=SVG_CIRCLE_STEPS` points on (cx,cy,r). `ellipse` → on (cx,cy,rx,ry).
  - `polygon` → the `points` list as one ring.
  - `path` → `parsePathD(d)`; walk commands accumulating points per subpath; `C` via cubic De Casteljau at `FLATTEN_STEPS` (`B(t)=(1−t)³P0+3(1−t)²tP1+3(1−t)t²P2+t³P3`); `Q` via quadratic De Casteljau; `A` via the **SVG spec endpoint→center parameterization** (F.6.5: compute cx,cy,θ1,Δθ from rx,ry,φ,flags,endpoints; sample by sweep angle at `ARC_STEPS`); `M`/`Z` start/close a subpath ring. Skip subpaths with `< 3` points.
  - default (`g`, `text`, `line`, `polyline`, unknown) → `[]` (the caller recurses into `g`).
  - Every point mapped through `ctm` (`apply(ctm,[x,y])`).
- `svgAssetRings(asset)`: `DOMParser().parseFromString(asset.normalizedContent, 'image/svg+xml')`; root viewBox `"minX minY vbW vbH"` → base matrix `scale(width/vbW, height/vbH) · translate(−minX,−minY)`; recursively walk children, composing `ctm = compose(parentCtm, parseTransformList(el.getAttribute('transform')))`, collecting `flattenElementToRings(el, ctm)` for drawables and recursing into `g`. Wrap each element in `try/catch` → skip on error. Return all rings (object-local coords).

- [ ] **Step 1: Write the failing tests**

`src/engine/geom/svg/flattenSvg.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseTransformList, flattenElementToRings, svgAssetRings } from './flattenSvg';
import type { SvgAsset } from '../../types';

const el = (markup: string): Element =>
  new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`, 'image/svg+xml').documentElement.firstElementChild!;
const ID: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];

describe('flattenSvg', () => {
  it('rect -> 4 corners', () => {
    const rings = flattenElementToRings(el('<rect x="2" y="3" width="10" height="4"/>'), ID);
    expect(rings).toHaveLength(1);
    const xs = rings[0].map((p) => p[0]); const ys = rings[0].map((p) => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(2); expect(Math.max(...xs)).toBeCloseTo(12);
    expect(Math.min(...ys)).toBeCloseTo(3); expect(Math.max(...ys)).toBeCloseTo(7);
  });
  it('circle -> points on the circle', () => {
    const rings = flattenElementToRings(el('<circle cx="0" cy="0" r="10"/>'), ID);
    for (const [x, y] of rings[0]) expect(Math.hypot(x, y)).toBeCloseTo(10, 4);
  });
  it('translate transform shifts points', () => {
    const m = parseTransformList('translate(5 7)');
    const rings = flattenElementToRings(el('<rect x="0" y="0" width="2" height="2"/>'), m);
    expect(Math.min(...rings[0].map((p) => p[0]))).toBeCloseTo(5);
    expect(Math.min(...rings[0].map((p) => p[1]))).toBeCloseTo(7);
  });
  it('path cubic flattens with a midpoint on the curve', () => {
    // a simple cubic bump; the t=0.5 De Casteljau midpoint of M0 0 C0 10 10 10 10 0 is (5,7.5)
    const rings = flattenElementToRings(el('<path d="M0 0 C0 10 10 10 10 0 Z"/>'), ID);
    const near = rings[0].some((p) => Math.abs(p[0] - 5) < 0.6 && Math.abs(p[1] - 7.5) < 0.6);
    expect(near).toBe(true);
  });
  it('svgAssetRings maps viewBox -> width/height and returns one ring per shape', () => {
    const asset: SvgAsset = { id: 's', kind: 'svg', name: 's', viewBox: '0 0 10 10', width: 20, height: 20,
      normalizedContent: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect x="0" y="0" width="10" height="10"/></svg>' };
    const rings = svgAssetRings(asset);
    expect(rings).toHaveLength(1);
    // viewBox 10 -> render box 20 => the rect spans 0..20 in object-local coords
    expect(Math.max(...rings[0].map((p) => p[0]))).toBeCloseTo(20, 3);
  });
  it('svgAssetRings skips unsupported-only markup without throwing', () => {
    const asset: SvgAsset = { id: 't', kind: 'svg', name: 't', viewBox: '0 0 10 10', width: 10, height: 10,
      normalizedContent: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text x="0" y="5">hi</text></svg>' };
    expect(svgAssetRings(asset)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `pnpm vitest run src/engine/geom/svg/flattenSvg.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `parseTransformList`, `apply`/`compose`, `flattenElementToRings`, `svgAssetRings` per the algorithm. Constants `SVG_CIRCLE_STEPS=64`, `FLATTEN_STEPS=16`, `ARC_STEPS=16`.
- [ ] **Step 4: Run to verify they pass** — Expected: PASS.
- [ ] **Step 5: Typecheck** — `pnpm tsc --noEmit`.
- [ ] **Step 6: Commit** — `git add src/engine/geom/svg/ && git commit -m "feat(svg): flatten SVG markup to world-frame polygon rings"`

---

### Task 3: `operandWorldGeom` SVG branch

**Files:**
- Modify: `src/engine/geom/boolean.ts` (add `svgAssetOf` + an SVG branch in `operandWorldGeom`)
- Test: `src/engine/geom/boolean.test.ts`

**Interfaces:**
- Consumes: `svgAssetRings` (Task 2), `toWorld`, `resolveAnchor`, `sampleObject`, `pc.union`.
- Produces: `operandWorldGeom` returns world geometry for an SVG-asset operand; `resolveBooleanRings`/`booleanOp` then clip it (faceted).

- [ ] **Step 1: Write the failing test**

Append to `src/engine/geom/boolean.test.ts`:

```ts
describe('boolean operand: an SVG-asset object', () => {
  function svgRectAsset(id: string, side: number) {
    return { id, kind: 'svg' as const, name: id, viewBox: `0 0 ${side} ${side}`, width: side, height: side,
      normalizedContent: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}"><rect x="0" y="0" width="${side}" height="${side}"/></svg>` };
  }
  it('an SVG rect operand intersects with a covering rect to its own region', () => {
    const svgAsset = svgRectAsset('svg-a', 20);
    // REAL SVG-object anchor model (matches store.addObject): absolute anchor at width/2,height/2, NO
    // anchorMode. Placed at a non-origin base so toWorld is genuinely exercised (not a no-op at 0,0).
    const svgObj = createSceneObject('svg-a', { id: 'svgobj', zOrder: 0, anchorX: 10, anchorY: 10, base: { x: 30, y: 30, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
    // svg rect world extent: local 0..20, placed at (30,30) => world x 30..50.
    const cover = rectObj('cover', 1, 60, 60, 20, 20); // (20,20)..(80,80) covers the svg's 30..50 box
    const boolAsset = createVectorAsset('path', { id: 'b-a', path: { nodes: [], closed: false } });
    const boolObj = createSceneObject('b-a', { id: 'boolobj', zOrder: 2, boolean: { op: 'intersect', operandIds: ['svgobj', 'cover'] } });
    const project = { ...createProject(), objects: [svgObj, cover[0], boolObj], assets: [svgAsset, cover[1], boolAsset] };
    const rings = resolveBooleanRings(project, boolObj, 0);
    expect(rings.length).toBeGreaterThan(0);
    const xs = rings.flatMap((r) => r.nodes.map((n) => n.anchor.x));
    expect(Math.min(...xs)).toBeCloseTo(30, 2); // the SVG rect's WORLD extent (placed at base 30,30)
    expect(Math.max(...xs)).toBeCloseTo(50, 2);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm vitest run src/engine/geom/boolean.test.ts -t "an SVG-asset object"` — Expected: FAIL (`< 2 geoms` → `[]`, the SVG contributes nothing).
- [ ] **Step 3: Implement** `svgAssetOf` + the SVG branch in `operandWorldGeom` (as in the spec's Component 3): the branch sits after the boolean/group branches, before the leaf branch.
- [ ] **Step 4: Run to verify it passes + full boolean suite** — `pnpm vitest run src/engine/geom/boolean.test.ts` — Expected: PASS (new test + parity).
- [ ] **Step 5: Typecheck** — `pnpm tsc --noEmit`.
- [ ] **Step 6: Commit** — `git add src/engine/geom/boolean.ts src/engine/geom/boolean.test.ts && git commit -m "feat(boolean): SVG-asset objects as boolean operands (union of filled shapes)"`

---

### Task 4: Regenerate the runtime bundle

**Files:** Modify (generated): `src/runtime/runtimeSource.generated.ts`

- [ ] **Step 1: Regenerate** — `pnpm build:runtime` (writes the bundle with the SVG-aware engine).
- [ ] **Step 2: Confirm only the bundle changed + typecheck** — `git status --porcelain` (only the generated file) then `pnpm tsc --noEmit`.
- [ ] **Step 3: Runtime + export suites** — `pnpm vitest run src/runtime src/services/export` — Expected: PASS.
- [ ] **Step 4: Commit** — `git add src/runtime/runtimeSource.generated.ts && git commit -m "build(runtime): regenerate bundle for SVG boolean operands"`

---

### Task 5: Authoring eligibility (store + Inspector)

**Files:**
- Modify: `src/ui/store/store.ts` (the `eligible` filter + the live AND destructive `topLeaf`/`topAsset` style picks; add `isSvgOperand`), `src/ui/components/Inspector/Inspector.tsx` (`eligibleForBool` count)
- Test: `src/ui/store/store.test.ts`, `src/ui/components/Inspector/Inspector.test.tsx`

**Interfaces:**
- Consumes: the existing `eligible` filter + `vectorLeavesOf` (store) / `hasVectorLeaf` (Inspector). Produces: a DIRECT SVG-asset object counts as a boolean operand; STYLE comes from the topmost VECTOR leaf, defaulting to `DEFAULT_VECTOR_STYLE` when the selection is all-SVG.

**IMPORTANT — keep `vectorLeavesOf`/`hasVectorLeaf` VECTOR-ONLY** (they are the STYLE source). Widen only the ELIGIBILITY check, and guard the style pick at BOTH the live AND destructive sites. There are THREE `topAsset.style` reads: the live pick (~store.ts:1830) and the destructive pick (~store.ts:1884). An SVG `topLeaf` would be an `SvgAsset` with no `.style` → `{...undefined}` = an invalid empty style (a silent correctness bug, not a crash). Because `vectorLeavesOf` stays vector-only, `flatMap(vectorLeavesOf)` never yields an SVG, so `topLeaf` is a vector leaf OR `undefined` (all-SVG) — guard both sites with the same `topLeaf ? … : default` pattern.

- [ ] **Step 1: Write the failing tests**
  - Inspector: a `{svgObject, rect}` selection is `canBool`-eligible.
  - Store (live): a live boolean from `{svgObject, rect}` stores both `operandIds`; the result asset's `style.fill` equals the RECT's (topmost vector leaf), NOT empty.
  - Store (destructive): a destructive Subtract of `{rect, svgObject}` bakes a result whose `style.fill` equals the rect's (proves the destructive style site is guarded / still vector-sourced).
  - Store (all-SVG): a boolean from `{svgObjectA, svgObjectB}` produces a result with `DEFAULT_VECTOR_STYLE` (no vector leaf → default, no `{...undefined}` empty style).
  - Build the SVG asset inline using the REAL anchor model (`anchorX: side/2, anchorY: side/2`, NO `anchorMode`, like `addObject`), and place it at a non-origin `base.x/base.y` so `toWorld` is exercised.
- [ ] **Step 2: Run to verify they fail** — the SVG object is currently not eligible; an all-SVG selection would read `undefined.style`.
- [ ] **Step 3: Implement**
  - Eligibility: add `isSvgOperand(o) = !o.isGroup && project.assets.find((a) => a.id === o.assetId)?.kind === 'svg'`. Change the store `eligible` filter to `vectorLeavesOf(o).length > 0 || isSvgOperand(o)`; mirror in `Inspector`'s `eligibleForBool` count (a non-group SVG object counts).
  - Style guard at BOTH sites: `const topLeaf = eligible.flatMap(vectorLeavesOf).slice().sort((a, b) => b.zOrder - a.zOrder)[0];` then build the asset with `style: topLeaf ? { ...(project.assets.find((x) => x.id === topLeaf.assetId) as VectorAsset).style } : { ...DEFAULT_VECTOR_STYLE }` (import `DEFAULT_VECTOR_STYLE` from the engine).
  - Leave `vectorLeavesOf`/`hasVectorLeaf` returning vector leaves ONLY — do NOT widen them to include SVG.
- [ ] **Step 4: Run to verify they pass + the store/Inspector suites** — Expected: PASS (incl. parity for vector-only selections — `topLeaf` is still the vector leaf, style unchanged).
- [ ] **Step 5: Typecheck + lint** — `pnpm tsc --noEmit && pnpm eslint src/ui/store/store.ts src/ui/components/Inspector/Inspector.tsx`.
- [ ] **Step 6: Commit** — `git commit -m "feat(boolean): SVG-asset objects are boolean-eligible operands"`

---

### Task 6: E2E

**Files:** Create `e2e/boolean-svg-operand.spec.ts`

- [ ] **Step 1: Write the e2e** — import a simple single-`<path>` (or `<rect>`) SVG via the import flow, place it, draw a rect, select both, Subtract → assert the result `[data-savig-object]` path reflects the SVG silhouette cutting the rect (a compound/altered `d`, distinct from the bare rect). Mirror `e2e/boolean-ops.spec.ts`'s harness.
- [ ] **Step 2: Run** — `pnpm exec playwright test e2e/boolean-svg-operand.spec.ts` (kill stale vite first).
- [ ] **Step 3: Commit** — `git commit -m "test(e2e): SVG-asset object as a boolean operand"`

---

## Notes for the executor

- **Tasks 1 & 2 are the bulk and the risk.** Implement strictly TDD — the parser/flattener correctness is fully covered by isolated unit tests. The SVG arc (`A`) uses the endpoint→center conversion from the SVG 1.1 spec appendix F.6.5; if arcs prove fiddly, the `A` path can ship after M/L/C/Q/Z (most icons use cubics) with arcs as a fast follow — but keep them in v1 unless blocked.
- **Faceted only** — do NOT attempt curve provenance for SVG operands (separate task). The SVG branch lives in `operandWorldGeom` (flat geom), so it naturally carries no provenance.
- **Even-odd holes fill solid in v1** (documented). Do not add containment classification.
- **Regenerate the bundle (Task 4)** after Tasks 1-3 — the engine is bundled into the runtime.
- If the team prefers a vetted micro-dependency for `d` parsing over the in-house parser, that is a deviation to raise with the human before Task 1 (the plan assumes in-house, matching the project's dep-lean stance).
