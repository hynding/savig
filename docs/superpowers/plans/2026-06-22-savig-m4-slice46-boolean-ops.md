# Boolean Path Ops (Slice 46) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Select ≥2 vector shapes and combine them with Union / Subtract / Intersect / Exclude, producing one new (possibly compound, holed) path object.

**Architecture:** A pure engine (`geom/boolean.ts`) bakes each object's flattened outline through its full object+group transform chain into world space, feeds the resulting polygons to the `polygon-clipping` library, and returns closed result rings as world-space `PathData[]`. A small data-model addition (`VectorAsset.compoundRings`) lets one path object carry holes/disjoint pieces, rendered with `fill-rule="evenodd"` in both the editor Stage and the export runtime. A store action (`booleanOp`) wraps the engine, builds the result object, destructively replaces the sources (undoable), and is wired to Inspector buttons.

**Tech Stack:** TypeScript, React 18, Zustand, Vitest, Playwright, pnpm. New dep: `polygon-clipping@0.15.7`.

## Global Constraints

- **Package manager: pnpm** (lockfile `pnpm-lock.yaml`). Use `pnpm add` / `pnpm test`.
- **New runtime dep allowed this slice:** `polygon-clipping` (MIT, ships its own TS types). Pin it. No other new deps.
- **Preview == export:** any change to how a path's `d`/fill-rule is produced MUST be applied to BOTH the editor Stage (`Stage.tsx`) and the export runtime (`renderDocument.ts`); share the serialization through `engine` helpers.
- **Engine purity:** `src/engine/**` must not import from `src/ui/**` or `src/services/**`. Use the engine-level `resolveAnchor` (`sample.ts`), not the UI `resolveObjectAnchor`.
- **TDD:** write the failing test first, watch it fail, implement minimally, watch it pass, commit.
- **Run a single test file:** `pnpm test src/path/to/file.test.ts` (vitest). Run the whole suite with `pnpm test` before any merge.
- **v1 limitations (do NOT implement):** curve-fitting the result back to beziers; animating compound results; node-editing compound rings; groups/SVG-asset objects as operands; non-destructive live boolean trees.

---

### Task 1: Add the `polygon-clipping` dep and export `mapPoint`

**Files:**
- Modify: `package.json` (via `pnpm add`)
- Modify: `src/engine/groupTransform.ts:49` (export the existing private `mapPoint`)
- Test: `src/engine/groupTransform.test.ts`

**Interfaces:**
- Produces: `export function mapPoint(t: { x:number;y:number;scaleX:number;scaleY:number;rotation:number }, ax:number, ay:number, px:number, py:number): { x:number; y:number }` — already implemented at `groupTransform.ts:49`; only the `export` keyword is added.

- [ ] **Step 1: Install the dependency**

Run: `pnpm add polygon-clipping@0.15.7`
Expected: `package.json` dependencies now include `"polygon-clipping": "0.15.7"`; `pnpm-lock.yaml` updated; no peer-dep errors.

- [ ] **Step 2: Verify the import + types resolve**

Run: `node -e "const pc=require('polygon-clipping'); console.log(typeof pc.union, typeof pc.difference, typeof pc.intersection, typeof pc.xor)"`
Expected: `function function function function`

- [ ] **Step 3: Write the failing test for the `mapPoint` export**

Add to `src/engine/groupTransform.test.ts`:

```ts
import { groupTransformPrefix, parentGroupOf, bakeGroupIntoChild, unbakeGroupFromChild, isRenderHidden, mapPoint } from './groupTransform';

describe('mapPoint (exported)', () => {
  it('translates a point by a pure-translate transform', () => {
    const p = mapPoint({ x: 10, y: 20, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } as any, 0, 0, 3, 4);
    expect(p).toEqual({ x: 13, y: 24 });
  });
  it('rotates 90° about the anchor', () => {
    const p = mapPoint({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 90, opacity: 1 } as any, 0, 0, 1, 0);
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(1, 6);
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `pnpm test src/engine/groupTransform.test.ts`
Expected: FAIL — `mapPoint` is not exported (`"mapPoint" is not exported by ... groupTransform.ts`).

- [ ] **Step 5: Export `mapPoint`**

In `src/engine/groupTransform.ts`, change line 49 from `function mapPoint(` to `export function mapPoint(`. No other change.

- [ ] **Step 6: Run it to verify it passes**

Run: `pnpm test src/engine/groupTransform.test.ts`
Expected: PASS (all tests, including the two new ones).

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml src/engine/groupTransform.ts src/engine/groupTransform.test.ts
git commit -m "build(slice46): add polygon-clipping dep; export mapPoint for world-baking"
```

---

### Task 2: Boolean engine — world-bake + clip → result rings

**Files:**
- Create: `src/engine/geom/boolean.ts`
- Create: `src/engine/geom/boolean.test.ts`
- Modify: `src/engine/index.ts` (add `export * from './geom/boolean';`)

**Interfaces:**
- Consumes: `mapPoint` (Task 1); `sampleObject`, `resolveAnchor` (`engine/sample.ts`); `parentGroupOf` (`engine/groupTransform.ts`); `flattenPath` (`engine/geom/arcLength.ts`); `pathBounds`, `samplePath` (`engine/path.ts` / `engine/sample.ts`); types `Project`, `SceneObject`, `VectorAsset`, `PathData`, `PathPoint`.
- Produces:
  - `export type BoolOp = 'union' | 'subtract' | 'intersect' | 'exclude';`
  - `export function objectToWorldPolygon(project: Project, obj: SceneObject, time: number): [number, number][][]` — a polygon-clipping `Polygon` (array of `[x,y]` rings; first ring = outer) in world coords; `[]` if the object has no usable geometry.
  - `export function ringArea(ring: PathPoint[]): number` — signed shoelace area.
  - `export function booleanOp(project: Project, objs: SceneObject[], op: BoolOp, time: number): PathData[]` — closed-ring result `PathData[]` in WORLD space; `[]` when the result is empty/degenerate.

- [ ] **Step 1: Write failing tests**

Create `src/engine/geom/boolean.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { booleanOp, objectToWorldPolygon, ringArea } from './boolean';
import { createProject, createSceneObject, createVectorAsset } from '../project';
import type { PathData, Project, SceneObject, VectorAsset } from '../types';

// A closed square path (local coords) from (0,0) to (s,s).
function squarePath(s: number): PathData {
  return { closed: true, nodes: [
    { anchor: { x: 0, y: 0 } }, { anchor: { x: s, y: 0 } },
    { anchor: { x: s, y: s } }, { anchor: { x: 0, y: s } },
  ] };
}

// Build a project from a list of [object, asset] pairs.
function proj(...pairs: [SceneObject, VectorAsset][]): Project {
  return { ...createProject(), objects: pairs.map((p) => p[0]), assets: pairs.map((p) => p[1]) };
}

// A path object placed at world (tx,ty) with the given local path; anchorMode 'fraction'.
function pathObj(id: string, zOrder: number, path: PathData, tx: number, ty: number): [SceneObject, VectorAsset] {
  const asset = createVectorAsset('path', { id: `${id}-a`, path });
  const obj = createSceneObject(asset.id, {
    id, zOrder, anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5,
    base: { x: tx, y: ty, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
  });
  return [obj, asset];
}

describe('ringArea', () => {
  it('is positive/negative by winding and equals the area magnitude', () => {
    const sq = [ { x:0,y:0 }, { x:10,y:0 }, { x:10,y:10 }, { x:0,y:10 } ];
    expect(Math.abs(ringArea(sq))).toBeCloseTo(100, 6);
  });
});

describe('objectToWorldPolygon', () => {
  it('bakes a path object through its translation into world coords', () => {
    const [o, a] = pathObj('o', 0, squarePath(10), 100, 50);
    const poly = objectToWorldPolygon(proj([o, a]), o, 0);
    const xs = poly[0].map((p) => p[0]);
    const ys = poly[0].map((p) => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(100, 4);
    expect(Math.max(...xs)).toBeCloseTo(110, 4);
    expect(Math.min(...ys)).toBeCloseTo(50, 4);
    expect(Math.max(...ys)).toBeCloseTo(60, 4);
  });
});

describe('booleanOp', () => {
  it('union of two overlapping squares -> one ring spanning the union bbox', () => {
    const A = pathObj('a', 0, squarePath(10), 0, 0);    // 0..10
    const B = pathObj('b', 1, squarePath(10), 5, 5);    // 5..15
    const out = booleanOp(proj(A, B), [A[0], B[0]], 'union', 0);
    expect(out.length).toBe(1);
    const xs = out[0].nodes.map((n) => n.anchor.x);
    expect(Math.min(...xs)).toBeCloseTo(0, 4);
    expect(Math.max(...xs)).toBeCloseTo(15, 4);
  });

  it('interior subtract -> 2 rings (outer + hole)', () => {
    const big = pathObj('big', 0, squarePath(30), 0, 0);     // bottom-most
    const small = pathObj('small', 1, squarePath(10), 10, 10); // fully interior, upper
    const out = booleanOp(proj(big, small), [big[0], small[0]], 'subtract', 0);
    expect(out.length).toBe(2);
  });

  it('intersect of overlap -> one ring at the overlap bbox', () => {
    const A = pathObj('a', 0, squarePath(10), 0, 0);   // 0..10
    const B = pathObj('b', 1, squarePath(10), 5, 0);   // 5..15
    const out = booleanOp(proj(A, B), [A[0], B[0]], 'intersect', 0);
    expect(out.length).toBe(1);
    const xs = out[0].nodes.map((n) => n.anchor.x);
    expect(Math.min(...xs)).toBeCloseTo(5, 4);
    expect(Math.max(...xs)).toBeCloseTo(10, 4);
  });

  it('intersect of disjoint shapes -> empty', () => {
    const A = pathObj('a', 0, squarePath(10), 0, 0);
    const B = pathObj('b', 1, squarePath(10), 100, 100);
    expect(booleanOp(proj(A, B), [A[0], B[0]], 'intersect', 0)).toEqual([]);
  });

  it('disjoint union -> 2 rings', () => {
    const A = pathObj('a', 0, squarePath(10), 0, 0);
    const B = pathObj('b', 1, squarePath(10), 100, 100);
    const out = booleanOp(proj(A, B), [A[0], B[0]], 'union', 0);
    expect(out.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/engine/geom/boolean.test.ts`
Expected: FAIL — `Cannot find module './boolean'`.

- [ ] **Step 3: Implement the engine**

Create `src/engine/geom/boolean.ts`:

```ts
import polygonClipping from 'polygon-clipping';
import type { Project, SceneObject, VectorAsset, PathData, PathPoint } from '../types';

// Local structural aliases for polygon-clipping geometry — avoid depending on the
// lib's exported type NAMES (they vary by version). A Pair is [x,y]; a Ring is closed
// (first==last); a Polygon is [outer, ...holes]; ops return MultiPolygon = Polygon[].
type Pair = [number, number];
type PcRing = Pair[];
type PcPolygon = PcRing[];
type PcMultiPolygon = PcPolygon[];
import { sampleObject, resolveAnchor } from '../sample';
import { parentGroupOf, mapPoint } from '../groupTransform';
import { samplePath } from '../sample';
import { flattenPath } from './arcLength';
import { pathBounds } from '../path';

export type BoolOp = 'union' | 'subtract' | 'intersect' | 'exclude';

const ELLIPSE_STEPS = 64;

/** Signed shoelace area of a ring of points. */
export function ringArea(ring: PathPoint[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function assetOf(project: Project, obj: SceneObject): VectorAsset | undefined {
  const a = project.assets.find((x) => x.id === obj.assetId);
  return a && a.kind === 'vector' ? a : undefined;
}

// Local-frame closed outline(s) for a vector object at `time`. One ring for
// path/rect/ellipse (boolean operands are single-region shapes in v1).
function localOutline(obj: SceneObject, asset: VectorAsset, time: number): PathPoint[] | null {
  const state = sampleObject(obj, time);
  if (asset.shapeType === 'path') {
    const path = (obj.shapeTrack && obj.shapeTrack.length > 0 ? samplePath(obj.shapeTrack, time) : state.path) ?? asset.path;
    if (!path || path.nodes.length < 2) return null;
    const pts = flattenPath(path).pts;
    // flattenPath of a closed path ends back at the start; drop the dup for a clean ring.
    if (pts.length > 1) {
      const f = pts[0]; const l = pts[pts.length - 1];
      if (Math.abs(f.x - l.x) < 1e-9 && Math.abs(f.y - l.y) < 1e-9) pts.pop();
    }
    return pts.length >= 3 ? pts.map((p) => ({ x: p.x, y: p.y })) : null;
  }
  const g = state.geometry ?? {};
  if (asset.shapeType === 'rect') {
    const w = Math.max(0, g.width ?? 0); const h = Math.max(0, g.height ?? 0);
    if (w === 0 || h === 0) return null;
    return [ { x:0,y:0 }, { x:w,y:0 }, { x:w,y:h }, { x:0,y:h } ];
  }
  // ellipse: center (rx,ry), radii (rx,ry) — matches geometryToSvgAttrs.
  const rx = Math.max(0, g.radiusX ?? 0); const ry = Math.max(0, g.radiusY ?? 0);
  if (rx === 0 || ry === 0) return null;
  const out: PathPoint[] = [];
  for (let i = 0; i < ELLIPSE_STEPS; i++) {
    const t = (i / ELLIPSE_STEPS) * 2 * Math.PI;
    out.push({ x: rx + rx * Math.cos(t), y: ry + ry * Math.sin(t) });
  }
  return out;
}

/** Map a local point through the object's transform then up its group-ancestor chain. */
function toWorld(project: Project, obj: SceneObject, ax: number, ay: number, p: PathPoint, time: number): PathPoint {
  let q = mapPoint(sampleObject(obj, time), ax, ay, p.x, p.y);
  let cur = parentGroupOf(project, obj);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    q = mapPoint(sampleObject(cur, time), cur.anchorX, cur.anchorY, q.x, q.y);
    cur = parentGroupOf(project, cur);
  }
  return q;
}

/** A polygon-clipping Polygon (array of [x,y] rings) in world coords for one object. */
export function objectToWorldPolygon(project: Project, obj: SceneObject, time: number): PcPolygon {
  const asset = assetOf(project, obj);
  if (!asset) return [];
  const local = localOutline(obj, asset, time);
  if (!local) return [];
  const box = asset.shapeType === 'path'
    ? pathBounds((obj.shapeTrack && obj.shapeTrack.length > 0 ? samplePath(obj.shapeTrack, time) : sampleObject(obj, time).path) ?? asset.path ?? { nodes: [], closed: false })
    : undefined;
  const { anchorX, anchorY } = resolveAnchor(obj, sampleObject(obj, time), asset.shapeType, box);
  const ring: [number, number][] = local.map((p) => {
    const w = toWorld(project, obj, anchorX, anchorY, p, time);
    return [w.x, w.y];
  });
  // close GeoJSON-style for polygon-clipping
  ring.push([ring[0][0], ring[0][1]]);
  return [ring];
}

function ringToPathData(ring: PcRing): PathData {
  // polygon-clipping rings are closed (first==last); drop the dup, emit corner nodes.
  const pts = ring.slice(0, ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? -1 : ring.length);
  return { closed: true, nodes: pts.map(([x, y]) => ({ anchor: { x, y } })) };
}

export function booleanOp(project: Project, objs: SceneObject[], op: BoolOp, time: number): PathData[] {
  const geoms: PcPolygon[] = objs
    .slice()
    .sort((a, b) => a.zOrder - b.zOrder) // bottom-most first
    .map((o) => objectToWorldPolygon(project, o, time))
    .filter((g) => g.length > 0);
  if (geoms.length < 2) return [];

  // `as any` at the call boundary: polygon-clipping's own arg/return types vary by
  // version; our structural Pc* aliases are runtime-compatible. Result handled as PcMultiPolygon.
  const clip = polygonClipping as any;
  const head = geoms[0];
  const rest = geoms.slice(1);
  let result: PcMultiPolygon;
  if (op === 'union') result = clip.union(head, ...rest);
  else if (op === 'intersect') result = clip.intersection(head, ...rest);
  else if (op === 'exclude') result = clip.xor(head, ...rest);
  else result = clip.difference(head, ...rest); // subtract upper from bottom-most

  // Flatten MultiPolygon (Polygon[] -> Ring[]) to a flat ring list; even-odd fill handles holes.
  const rings: PathData[] = [];
  for (const poly of result) for (const ring of poly) {
    const pd = ringToPathData(ring);
    if (pd.nodes.length >= 3) rings.push(pd);
  }
  return rings;
}
```

- [ ] **Step 4: Wire the engine export**

In `src/engine/index.ts`, add after the `geom/simplify` line: `export * from './geom/boolean';`

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm test src/engine/geom/boolean.test.ts`
Expected: PASS (all cases). The local `Pc*` aliases + `as any` call boundary mean no dependency on the lib's exported type names. If the default import errors at type-check (it shouldn't under `moduleResolution: bundler`), fall back to `import * as polygonClipping from 'polygon-clipping'`.

- [ ] **Step 6: Commit**

```bash
git add src/engine/geom/boolean.ts src/engine/geom/boolean.test.ts src/engine/index.ts
git commit -m "feat(slice46): boolean engine — world-bake outlines + polygon-clipping union/subtract/intersect/exclude"
```

---

### Task 3: `compoundRings` model + shared render serialization

**Files:**
- Modify: `src/engine/types.ts` (add `compoundRings?: PathData[]` to `VectorAsset`)
- Modify: `src/engine/path.ts` (add `pathToDRings`)
- Test: `src/engine/path.test.ts`

**Interfaces:**
- Produces: `export function pathToDRings(primary: PathData, rings?: PathData[]): string` — concatenates `pathToD(primary)` with each ring's `pathToD`, space-joined; identical to `pathToD(primary)` when `rings` is empty/undefined.
- Produces (type): `VectorAsset.compoundRings?: PathData[]`.

- [ ] **Step 1: Write the failing test**

Add to `src/engine/path.test.ts`:

```ts
import { pathToD, pathToDRings } from './path';

describe('pathToDRings', () => {
  const ring = (s: number, off: number): PathData => ({ closed: true, nodes: [
    { anchor: { x: off, y: off } }, { anchor: { x: off + s, y: off } },
    { anchor: { x: off + s, y: off + s } }, { anchor: { x: off, y: off + s } },
  ] });
  it('equals pathToD(primary) when there are no extra rings', () => {
    const p = ring(10, 0);
    expect(pathToDRings(p, [])).toBe(pathToD(p));
    expect(pathToDRings(p)).toBe(pathToD(p));
  });
  it('concatenates each ring as its own subpath', () => {
    const p = ring(10, 0); const hole = ring(4, 3);
    const d = pathToDRings(p, [hole]);
    expect(d).toBe(`${pathToD(p)} ${pathToD(hole)}`);
    expect((d.match(/M /g) || []).length).toBe(2); // two subpaths
  });
});
```

(Ensure `PathData` is imported in `path.test.ts`; add to its imports if missing.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/engine/path.test.ts`
Expected: FAIL — `pathToDRings` is not exported.

- [ ] **Step 3: Implement**

In `src/engine/path.ts`, after `pathToD` (line 40), add:

```ts
// Serialize a primary path plus optional extra closed rings (boolean-op compound
// results) as one `d` — each ring an independent M…Z subpath. Render with
// fill-rule:evenodd so interior rings cut holes. The SINGLE definition shared by
// the editor Stage and the export runtime (preview == export).
export function pathToDRings(primary: PathData, rings?: PathData[]): string {
  const base = pathToD(primary);
  if (!rings || rings.length === 0) return base;
  return [base, ...rings.map(pathToD)].filter((d) => d.length > 0).join(' ');
}
```

In `src/engine/types.ts`, inside `VectorAsset`, after the `path?: PathData;` field, add:

```ts
  /** Extra closed rings rendered together with `path` using fill-rule:evenodd —
   *  boolean-op results with holes/disjoint pieces (slice 46). Render/export/
   *  transform-only in v1: node-editing and morph operate on the primary `path`. */
  compoundRings?: PathData[];
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test src/engine/path.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/path.ts src/engine/path.test.ts src/engine/types.ts
git commit -m "feat(slice46): compoundRings model + pathToDRings shared serializer"
```

---

### Task 4: Compound bounds + export runtime rendering

**Files:**
- Modify: `src/engine/path.ts` (add `pathBoundsRings`)
- Modify: `src/engine/renderShape.ts:63` (`renderShapeToSvg` gains `compoundRings` + emits `fill-rule`)
- Modify: `src/services/export/renderDocument.ts:68-80` (pass `asset.compoundRings`)
- Test: `src/engine/path.test.ts`, `src/engine/renderShape.test.ts`, `src/services/export/renderDocument.test.ts`

**Interfaces:**
- Consumes: `pathToDRings` (Task 3); `VectorAsset.compoundRings` (Task 3).
- Produces: `export function pathBoundsRings(primary: PathData, rings?: PathData[]): { x:number;y:number;width:number;height:number }` — bbox spanning the primary path and all rings.
- Produces (changed signature): `renderShapeToSvg(shapeType, geometry, style, path?, idScope?, gradientPaint?, dashOffset?, compoundRings?: PathData[])` — when `shapeType==='path'` and `compoundRings` is non-empty, `d` uses `pathToDRings` and a `fill-rule="evenodd"` attribute is added.

- [ ] **Step 1: Write failing tests**

Add to `src/engine/path.test.ts`:

```ts
import { pathBounds, pathBoundsRings } from './path';

describe('pathBoundsRings', () => {
  it('spans the primary and all extra rings', () => {
    const primary: PathData = { closed: true, nodes: [
      { anchor:{x:0,y:0} }, { anchor:{x:10,y:0} }, { anchor:{x:10,y:10} }, { anchor:{x:0,y:10} } ] };
    const far: PathData = { closed: true, nodes: [
      { anchor:{x:20,y:20} }, { anchor:{x:30,y:20} }, { anchor:{x:30,y:30} }, { anchor:{x:20,y:30} } ] };
    const b = pathBoundsRings(primary, [far]);
    expect(b.x).toBeCloseTo(0); expect(b.y).toBeCloseTo(0);
    expect(b.width).toBeCloseTo(30); expect(b.height).toBeCloseTo(30);
  });
  it('equals pathBounds(primary) with no rings', () => {
    const p: PathData = { closed: true, nodes: [ { anchor:{x:0,y:0} }, { anchor:{x:5,y:0} }, { anchor:{x:5,y:5} } ] };
    expect(pathBoundsRings(p)).toEqual(pathBounds(p));
  });
});
```

Add to `src/engine/renderShape.test.ts`:

```ts
it('renders compound rings as extra subpaths with fill-rule evenodd', () => {
  const primary = { closed: true, nodes: [ { anchor:{x:0,y:0} }, { anchor:{x:30,y:0} }, { anchor:{x:30,y:30} }, { anchor:{x:0,y:30} } ] };
  const hole = { closed: true, nodes: [ { anchor:{x:10,y:10} }, { anchor:{x:20,y:10} }, { anchor:{x:20,y:20} }, { anchor:{x:10,y:20} } ] };
  const svg = renderShapeToSvg('path', {}, { fill:'#000', stroke:'none', strokeWidth:1 }, primary, undefined, undefined, undefined, [hole]);
  expect(svg).toContain('fill-rule="evenodd"');
  expect((svg.match(/M /g) || []).length).toBe(2);
});
it('omits fill-rule when there are no compound rings', () => {
  const primary = { closed: true, nodes: [ { anchor:{x:0,y:0} }, { anchor:{x:5,y:0} }, { anchor:{x:5,y:5} } ] };
  const svg = renderShapeToSvg('path', {}, { fill:'#000', stroke:'none', strokeWidth:1 }, primary);
  expect(svg).not.toContain('fill-rule');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test src/engine/path.test.ts src/engine/renderShape.test.ts`
Expected: FAIL — `pathBoundsRings` not exported; `renderShapeToSvg` ignores the 8th arg / no `fill-rule`.

- [ ] **Step 3: Implement `pathBoundsRings`**

In `src/engine/path.ts`, after `pathBounds` (line 109), add:

```ts
// Bounds spanning a primary path and any compound rings (boolean-op results).
export function pathBoundsRings(
  primary: PathData,
  rings?: PathData[],
): { x: number; y: number; width: number; height: number } {
  const boxes = [pathBounds(primary), ...(rings ?? []).map(pathBounds)].filter((b) => b.width > 0 || b.height > 0);
  if (boxes.length === 0) return pathBounds(primary);
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.width));
  const maxY = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
```

- [ ] **Step 4: Implement the `renderShapeToSvg` change**

In `src/engine/renderShape.ts`, update the signature and the path branch:

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
): string {
  if (shapeType === 'path') {
    if (!path || path.nodes.length === 0) return '';
    const hasRings = !!compoundRings && compoundRings.length > 0;
    const attrs: Record<string, string> = {
      d: hasRings ? pathToDRings(path, compoundRings) : pathToD(path),
      ...(hasRings ? { 'fill-rule': 'evenodd' } : {}),
      ...styleToSvgAttrs(style, idScope, gradientPaint, dashOffset),
    };
    const attrStr = Object.entries(attrs).map(([k, v]) => `${k}="${escapeAttr(v)}"`).join(' ');
    return `<path ${attrStr}/>`;
  }
  // ... unchanged rect/ellipse branch ...
```

Add `pathToDRings` to the existing `import { pathToD } from './path';` line → `import { pathToD, pathToDRings } from './path';`.

- [ ] **Step 5: Pass compoundRings from the export runtime**

In `src/services/export/renderDocument.ts`, update the `renderShapeToSvg(...)` call (lines 72-80) to add the 8th argument:

```ts
        let shape = renderShapeToSvg(
          asset.shapeType,
          state.geometry ?? {},
          asset.style,
          framePath,
          obj.id,
          { fill: !!fillGrad, stroke: !!strokeGrad },
          state.strokeDashoffset,
          asset.shapeType === 'path' ? asset.compoundRings : undefined,
        );
```

- [ ] **Step 6: Add an export-runtime test**

Add to `src/services/export/renderDocument.test.ts` a case asserting a path asset with `compoundRings` produces a `<path>` whose `d` has two subpaths and `fill-rule="evenodd"`. Mirror the file's existing project-construction helper; if it builds projects inline, construct a vector path asset with `compoundRings: [ringPathData]` and one object referencing it, render at t=0, and assert `expect(svg).toContain('fill-rule="evenodd"')` and `expect((svg.match(/M /g)||[]).length).toBeGreaterThanOrEqual(2)`.

- [ ] **Step 7: Run to verify they pass**

Run: `pnpm test src/engine/path.test.ts src/engine/renderShape.test.ts src/services/export/renderDocument.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/engine/path.ts src/engine/path.test.ts src/engine/renderShape.ts src/engine/renderShape.test.ts src/services/export/renderDocument.ts src/services/export/renderDocument.test.ts
git commit -m "feat(slice46): compound-ring bounds + export-runtime evenodd rendering"
```

---

### Task 5: Editor Stage renders compound rings

**Files:**
- Modify: `src/engine/gradientHandles.ts:14` (`shapeLocalBBox` gains an optional `compoundRings` arg)
- Modify: `src/ui/components/Stage/snapping.ts:135` (`resolveObjectAnchor` passes `asset.compoundRings` into `shapeLocalBBox`)
- Modify: `src/ui/components/Stage/Stage.tsx:1440-1454` (the `asset.shapeType === 'path'` `<path>` element)
- Test: `src/ui/components/Stage/snapping.test.ts` (objectAABB) + `src/engine/gradientHandles.test.ts` (shapeLocalBBox default unchanged)

**Interfaces:**
- Consumes: `pathToDRings` (Task 3), `pathBoundsRings` (Task 4), `VectorAsset.compoundRings` (Task 3).
- Produces (changed signature): `shapeLocalBBox(shapeType, geometry, path?, compoundRings?: PathData[])` — for `shapeType==='path'` returns `pathBoundsRings(path, compoundRings)`; rect/ellipse unchanged; existing 3-arg callers (gradient handles) behave identically.

**Why `shapeLocalBBox`, not `objectAABB` directly:** `objectAABB` derives its local box from `resolveObjectAnchor` → `shapeLocalBBox` (engine, `gradientHandles.ts`). Threading `compoundRings` through that one optional param is the minimal correct change and keeps gradient-handle callers untouched.

- [ ] **Step 1: Write a failing test for objectAABB**

Add to the test file covering `objectAABB` (`src/ui/components/Stage/snapping.test.ts`; create it if absent, importing `objectAABB` from `./snapping`):

```ts
it('objectAABB spans a path asset compound rings', () => {
  const asset = createVectorAsset('path', {
    id: 'a',
    path: { closed: true, nodes: [ {anchor:{x:0,y:0}}, {anchor:{x:10,y:0}}, {anchor:{x:10,y:10}}, {anchor:{x:0,y:10}} ] },
    compoundRings: [ { closed: true, nodes: [ {anchor:{x:20,y:20}}, {anchor:{x:30,y:20}}, {anchor:{x:30,y:30}}, {anchor:{x:20,y:30}} ] } ],
  });
  const obj = createSceneObject('a', { anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5, base: { x:0,y:0,scaleX:1,scaleY:1,rotation:0,opacity:1 } });
  const box = objectAABB(obj, asset, 0)!;
  expect(box.maxX - box.minX).toBeCloseTo(30, 4);
  expect(box.maxY - box.minY).toBeCloseTo(30, 4);
});
```

(`AABB` is `{ minX, minY, maxX, maxY }` — `snapping.ts:7` — so the assertions above are correct as written.)

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/ui/components/Stage/snapping.test.ts`
Expected: FAIL — bbox spans only the primary path (width 10, not 30).

- [ ] **Step 3: Thread compoundRings through shapeLocalBBox + resolveObjectAnchor**

In `src/engine/gradientHandles.ts`, update `shapeLocalBBox` (add `pathBoundsRings` to the existing `import { pathBounds } from './path';` → `import { pathBounds, pathBoundsRings } from './path';`):

```ts
export function shapeLocalBBox(
  shapeType: VectorShapeType,
  geometry: ResolvedGeometry,
  path?: PathData,
  compoundRings?: PathData[],
): LocalRect {
  if (shapeType === 'rect') {
    return { x: 0, y: 0, width: geometry.width ?? 0, height: geometry.height ?? 0 };
  }
  if (shapeType === 'ellipse') {
    return { x: 0, y: 0, width: 2 * (geometry.radiusX ?? 0), height: 2 * (geometry.radiusY ?? 0) };
  }
  return pathBoundsRings(path ?? EMPTY_PATH, compoundRings);
}
```

In `src/ui/components/Stage/snapping.ts`, in `resolveObjectAnchor`, pass the asset's compound rings:

```ts
    const bbox = shapeLocalBBox(asset.shapeType, state.geometry ?? {}, sampledPath, asset.kind === 'vector' ? asset.compoundRings : undefined);
```

(The anchor resolution on the next line stays on the primary `sampledPath` — pivot on the primary ring is fine; only the extent spans the rings.)

- [ ] **Step 4: Run to verify it passes (incl. gradient-handles regression)**

Run: `pnpm test src/ui/components/Stage/snapping.test.ts src/engine/gradientHandles.test.ts`
Expected: PASS — the new objectAABB test passes AND the existing `shapeLocalBBox` tests still pass (the 4th arg is optional; 3-arg behavior unchanged).

- [ ] **Step 5: Render compound rings in the Stage `<path>`**

In `src/ui/components/Stage/Stage.tsx`, in the `asset.shapeType === 'path'` branch (around line 1440), change the `<path>` `d` and add `fillRule`:

```tsx
                    <path
                      d={
                        o.shapeTrack && o.shapeTrack.length > 0
                          ? pathToD(samplePath(o.shapeTrack, time))
                          : asset.path
                            ? pathToDRings(asset.path, asset.compoundRings)
                            : ''
                      }
                      fillRule={asset.compoundRings && asset.compoundRings.length > 0 ? 'evenodd' : undefined}
                      fill={fillGrad ? paintRef(`savig-grad-${o.id}-fill`) : asset.style.fill}
                      stroke={strokeGrad ? paintRef(`savig-grad-${o.id}-stroke`) : asset.style.stroke}
                      strokeWidth={asset.style.strokeWidth}
                      strokeLinecap={asset.style.strokeLinecap}
                      strokeLinejoin={asset.style.strokeLinejoin}
                      {...dashProps}
                    />
```

Add `pathToDRings` to Stage's `engine` import (the long destructured import at `Stage.tsx:3`).

- [ ] **Step 6: Run the Stage/app test + typecheck**

Run: `pnpm test src/ui/components/Stage && pnpm exec tsc --noEmit`
Expected: PASS / no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/engine/gradientHandles.ts src/ui/components/Stage/Stage.tsx src/ui/components/Stage/snapping.ts src/ui/components/Stage/snapping.test.ts
git commit -m "feat(slice46): editor Stage renders compound rings (evenodd) + objectAABB spans them"
```

---

### Task 6: Store `booleanOp` action (destructive replace, undoable)

**Files:**
- Modify: `src/ui/store/store.ts` (add `booleanOp` to the interface near line 219 and implement it near the grouping actions ~line 1211)
- Test: `src/ui/store/store.test.ts` (or the store test file used for grouping)

**Interfaces:**
- Consumes: `booleanOp` (engine, Task 2), `pathBounds`/`pathBoundsRings` (engine), `createVectorAsset`, `createSceneObject`, `nextZOrder` (store-local), `ringArea` (engine, Task 2).
- Produces: `booleanOp(op: BoolOp): void` on the editor store.

- [ ] **Step 1: Write failing tests**

Add to the store test file:

```ts
it('booleanOp union replaces two sources with one selected result', () => {
  const s = freshStoreWithTwoOverlappingPaths(); // helper: two path objects 0..10 and 5..15, both selected
  const before = s.getState().history.present.objects.length;
  s.getState().booleanOp('union');
  const proj = s.getState().history.present;
  expect(proj.objects.length).toBe(before - 1); // 2 sources -> 1 result
  const sel = s.getState().selectedObjectId!;
  expect(proj.objects.find((o) => o.id === sel)).toBeTruthy();
});

it('booleanOp is undoable (restores the sources)', () => {
  const s = freshStoreWithTwoOverlappingPaths();
  const before = s.getState().history.present.objects.map((o) => o.id).sort();
  s.getState().booleanOp('union');
  s.getState().undo();
  const after = s.getState().history.present.objects.map((o) => o.id).sort();
  expect(after).toEqual(before);
});

it('booleanOp interior subtract attaches a compound ring (hole) to the result', () => {
  const s = freshStoreWithBigAndInteriorSmall(); // big 0..30 (lower z), small 10..20 (upper), both selected
  s.getState().booleanOp('subtract');
  const proj = s.getState().history.present;
  const result = proj.objects.find((o) => o.id === s.getState().selectedObjectId)!;
  const asset = proj.assets.find((a) => a.id === result.assetId)! as any;
  expect(asset.compoundRings && asset.compoundRings.length).toBe(1);
});

it('booleanOp no-ops with fewer than 2 eligible (e.g. a group selected)', () => {
  const s = freshStoreWithOnePathAndOneGroupSelected();
  const before = s.getState().history.present.objects.length;
  s.getState().booleanOp('union');
  expect(s.getState().history.present.objects.length).toBe(before); // unchanged
});
```

(Build the `freshStore…` helpers from the patterns already in this test file — they typically call the store's `addVectorPath`/`commit` then set `selectedObjectIds`. Reuse whatever factory the grouping tests use.)

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm test src/ui/store/store.test.ts`
Expected: FAIL — `booleanOp` is not a function.

- [ ] **Step 3: Add the interface declaration**

In `src/ui/store/store.ts`, near the grouping actions in the state interface (around line 219), add:

```ts
  booleanOp(op: import('../../engine').BoolOp): void;
```

(Or add `BoolOp` to the file's existing top-of-file `engine` import and use `booleanOp(op: BoolOp): void;`.)

- [ ] **Step 4: Implement the action**

In `src/ui/store/store.ts`, add near `groupSelected` (~line 1211). Add `booleanOp as booleanOpEngine, ringArea` to the existing `import { ... } from '../../engine'` block (alias the engine fn to avoid shadowing the store action of the same name); `pathBounds`, `DEFAULT_TRANSFORM`, `createVectorAsset`, `createSceneObject`, and the `SceneObject`/`VectorAsset`/`PathData` types are already imported. The store's playhead time is `get().time`:

```ts
  booleanOp(op) {
    const project = get().history.present;
    const ids = get().selectedObjectIds;
    const objs = ids
      .map((id) => project.objects.find((o) => o.id === id))
      .filter((o): o is SceneObject => !!o);
    const eligible = objs.filter((o) => {
      const a = project.assets.find((x) => x.id === o.assetId);
      return !o.isGroup && a?.kind === 'vector';
    });
    if (eligible.length < 2) return; // gate: never a silent partial op

    const rings = booleanOpEngine(project, eligible, op, get().time); // world space
    if (rings.length === 0) return; // empty/degenerate -> no-op

    // primary = largest-area ring; the rest become compound rings (holes/disjoint pieces).
    const sorted = rings.slice().sort((a, b) => Math.abs(ringArea(b.nodes.map((n) => n.anchor))) - Math.abs(ringArea(a.nodes.map((n) => n.anchor))));
    const box = sorted.reduce(
      (acc, r) => {
        const b = pathBounds(r);
        return { minX: Math.min(acc.minX, b.x), minY: Math.min(acc.minY, b.y), maxX: Math.max(acc.maxX, b.x + b.width), maxY: Math.max(acc.maxY, b.y + b.height) };
      },
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
    const shift = (p: PathData): PathData => ({ closed: p.closed, nodes: p.nodes.map((n) => ({ anchor: { x: n.anchor.x - box.minX, y: n.anchor.y - box.minY } })) });
    const primary = shift(sorted[0]);
    const compoundRings = sorted.slice(1).map(shift);

    // inherit the topmost source's style
    const topMost = eligible.slice().sort((a, b) => b.zOrder - a.zOrder)[0];
    const topAsset = project.assets.find((x) => x.id === topMost.assetId) as VectorAsset;

    const asset = createVectorAsset('path', {
      path: primary,
      ...(compoundRings.length > 0 ? { compoundRings } : {}),
      style: { ...topAsset.style },
    });
    const obj = createSceneObject(asset.id, {
      name: `${op[0].toUpperCase()}${op.slice(1)} ${nextZOrder(project.objects) + 1}`,
      zOrder: nextZOrder(project.objects),
      anchorMode: 'fraction',
      anchorX: 0.5,
      anchorY: 0.5,
      base: { ...DEFAULT_TRANSFORM, x: box.minX, y: box.minY },
    });

    const removed = new Set(eligible.map((o) => o.id));
    get().commit({
      ...project,
      assets: [...project.assets, asset],
      objects: [...project.objects.filter((o) => !removed.has(o.id)), obj],
    });
    set({ selectedObjectId: obj.id, selectedObjectIds: [obj.id], selectedKeyframe: null, selectedNodeIndex: null });
  },
```

(Confirm `currentTime`, `DEFAULT_TRANSFORM`, and `SceneObject`/`VectorAsset`/`PathData` are already in scope in `store.ts` — they are used by neighboring actions. If `currentTime` is named differently in the store, use that name.)

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm test src/ui/store/store.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(slice46): store booleanOp — destructive replace, compound result, undoable"
```

---

### Task 7: Inspector buttons + eligibility gating

**Files:**
- Modify: `src/ui/components/Inspector/Inspector.tsx:147-177` (the `selectedIds.length > 1` panel)
- Test: `src/ui/components/Inspector/Inspector.test.tsx` (or App-level test for the multi-select panel)

**Interfaces:**
- Consumes: `booleanOp` store action (Task 6).
- Produces: four buttons (Union / Subtract / Intersect / Exclude) in the multi-select panel, `disabled` unless ≥2 eligible (vector, non-group) objects are selected.

- [ ] **Step 1: Write a failing test**

Add to the Inspector test:

```ts
it('shows boolean-op buttons enabled when 2 vector paths are selected', () => {
  renderInspectorWithTwoSelectedPaths(); // reuse the existing multi-select render helper
  expect(screen.getByRole('button', { name: /union/i })).toBeEnabled();
  expect(screen.getByRole('button', { name: /subtract/i })).toBeEnabled();
});
it('disables boolean-op buttons when a group is among the selection', () => {
  renderInspectorWithPathAndGroupSelected();
  expect(screen.getByRole('button', { name: /union/i })).toBeDisabled();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test src/ui/components/Inspector/Inspector.test.tsx`
Expected: FAIL — no Union button.

- [ ] **Step 3: Implement**

In `src/ui/components/Inspector/Inspector.tsx`, add `booleanOp` to the destructured `useEditor.getState()` actions. Inside the `selectedIds.length > 1` block, after computing `movableCount`, add:

```tsx
    const eligibleForBool = selectedIds.filter((id) => {
      const o = objects.find((obj) => obj.id === id);
      if (!o || o.isGroup) return false;
      const a = assets.find((x) => x.id === o.assetId);
      return a?.kind === 'vector';
    }).length;
    const canBool = eligibleForBool >= 2;
```

(Confirm `assets` is available in this component; if not, read it from the store like `objects` is. Inspect the top of the component for the existing `useEditor` selectors.)

Then add a new row before or after the Group row:

```tsx
        <div className={styles.row}>
          <button disabled={!canBool} onClick={() => booleanOp('union')}>Union</button>
          <button disabled={!canBool} onClick={() => booleanOp('subtract')}>Subtract</button>
          <button disabled={!canBool} onClick={() => booleanOp('intersect')}>Intersect</button>
          <button disabled={!canBool} onClick={() => booleanOp('exclude')}>Exclude</button>
        </div>
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test src/ui/components/Inspector/Inspector.test.tsx && pnpm exec tsc --noEmit`
Expected: PASS / no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/Inspector/Inspector.tsx src/ui/components/Inspector/Inspector.test.tsx
git commit -m "feat(slice46): Inspector boolean-op buttons with eligibility gating"
```

---

### Task 8: End-to-end test (draw → subtract → annulus)

**Files:**
- Create or extend: `e2e/` Playwright spec (match the existing e2e directory/naming — e.g. `e2e/boolean-ops.spec.ts`)

**Interfaces:**
- Consumes: the full feature (Tasks 1-7).

- [ ] **Step 1: Write the e2e test**

Mirror an existing e2e spec's setup (app launch, drawing helpers). The scenario:
1. Draw a large shape, then a smaller shape fully inside it.
2. Select both (marquee or shift-click).
3. Click Subtract.
4. Assert: object count dropped to one; the resulting `<path>` has `fill-rule="evenodd"` and a `d` containing two `M` subpaths (outer + hole).

```ts
import { test, expect } from '@playwright/test';
// ...launch + draw helpers per the existing e2e specs...
test('subtract produces an annulus (compound path with a hole)', async ({ page }) => {
  // draw big rect/path, draw interior small one, select both
  // click Subtract
  await page.getByRole('button', { name: /subtract/i }).click();
  const path = page.locator('[data-savig-object] path').first();
  await expect(path).toHaveAttribute('fill-rule', 'evenodd');
  const d = await path.getAttribute('d');
  expect((d!.match(/M /g) || []).length).toBeGreaterThanOrEqual(2);
});
```

- [ ] **Step 2: Run the e2e test**

Run: `pnpm exec playwright test e2e/boolean-ops.spec.ts`
Expected: PASS. (If the project runs e2e via a different command, use the one in `package.json` scripts.)

- [ ] **Step 3: Commit**

```bash
git add e2e/boolean-ops.spec.ts
git commit -m "test(slice46): e2e draw -> subtract -> annulus (compound hole)"
```

---

### Task 9: Full-suite gate + merge

- [ ] **Step 1: Run the full unit suite + typecheck + lint**

Run: `pnpm test && pnpm exec tsc --noEmit && pnpm lint`
Expected: all green.

- [ ] **Step 2: Code-review loop**

Run a `feature-dev:code-reviewer` pass over the slice diff; resolve every Critical/Important finding and re-review until none remain (per the project's review-loop convention).

- [ ] **Step 3: Merge to main (`--no-ff`)**

```bash
git checkout main && git merge --no-ff <slice-branch> -m "Merge slice46: boolean path ops (union/subtract/intersect/exclude)"
```

(If work was done directly on `main`, skip the merge; the review loop in Step 2 still gates.)

---

## Self-Review

**Spec coverage:**
- Clipper = polygon-clipping dep → Task 1. ✓
- World-bake + flatten + clip engine → Task 2 (`objectToWorldPolygon`, `booleanOp`, ellipse/rect outlines, subtract = bottom-most). ✓
- Compound-path model + evenodd render (editor + export) → Tasks 3-5. ✓
- Bounds span rings → Task 4 (`pathBoundsRings`) + Task 5 (objectAABB). ✓
- Destructive replace, undoable, style-inherit-topmost, top z-order, select result → Task 6. ✓
- Eligibility (≥2, vector, non-group) → Task 6 (store guard) + Task 7 (button gating). ✓
- Subtract semantics (upper from bottom-most) → Task 2 (`difference(geoms[0], ...rest)` after sort-by-zOrder asc). ✓
- Empty result no-op → Task 2 returns `[]`, Task 6 returns early. ✓
- Tests: engine/render/store/e2e → Tasks 2,3,4,5,6,7,8. ✓
- Keyboard shortcuts → intentionally deferred (buttons-only v1; spec §3 allowed this). Noted, no task. ✓

**Placeholder scan:** No TBD/TODO; all code steps include full code. The few "confirm X is in scope / match the existing helper" notes are verification instructions against named files/lines, not missing content. ✓

**Type consistency:** `BoolOp` defined in Task 2, consumed in Tasks 6-7. `booleanOp` (engine) aliased `booleanOpEngine` in the store to avoid colliding with the store action `booleanOp` (Task 6). `compoundRings` field name consistent across Tasks 3-7. `pathToDRings`/`pathBoundsRings` names consistent Tasks 3-5. `renderShapeToSvg` 8th param `compoundRings` consistent Tasks 4-5. ✓
