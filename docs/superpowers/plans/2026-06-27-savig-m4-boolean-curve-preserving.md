# Curve-Preserving Boolean Results (v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Boolean ops on leaf vector operands preserve original bezier/ellipse curvature on untouched edges; only intersection seams become corners.

**Architecture:** Represent each leaf operand's world outline as cubic-bezier segments; flatten to rings for `polygon-clipping` (unchanged clip); then for each output ring, classify every vertex by **projecting it onto the source cubics** (recovering its parameter `t`), group maximal same-segment runs into curve segments (De Casteljau split, reversed when winding flips), and assemble nodes with `in`/`out` handles. New geometry lives in `src/engine/geom/boolean-curves.ts`; `boolean.ts` orchestrates. Group/SVG operands and animated results are out of scope (keep today's behavior).

**Tech Stack:** TypeScript (strict), `polygon-clipping` 0.15.7, Vitest, Playwright. Pure-function engine modules; no new dependencies.

## Global Constraints

- **No new dependencies.** Provenance is built on the existing `polygon-clipping` 0.15.7.
- **`booleanOp(project, objs, op, time): PathData[]` signature is unchanged.** Store / Inspector / keyboard callers are untouched.
- **`PathNode.in`/`out` are offsets relative to the anchor** (engine/types.ts); emit handles as offsets. The store's `shift()` (anchors-only) stays correct — do not change it.
- **Segment classification rule** must match `pathToD`/`pathBounds`/`flattenPoints`: a path segment is a cubic iff `prev.out || cur.in`; otherwise straight. Control points: `c1 = anchor(prev) + prev.out`, `c2 = anchor(cur) + cur.in`.
- **Leaf operands only.** Group operands keep today's faceted union (`operandWorldGeom`); their output vertices must reconstruct as corners (no curves).
- **Parity-safe fallback:** any ring whose reconstruction throws or yields < 3 nodes falls back to today's corner-only `ringToPathData` for that ring. Never fail the whole op.
- **Ellipse kappa constant:** `0.5522847498`.
- **Reuse existing density:** `FLATTEN_STEPS = 16` (from `arcLength.ts`) per segment for the clip-input flatten.

---

### Task 1: Cubic primitives (eval, reverse, range-split, projection)

**Files:**
- Create: `src/engine/geom/boolean-curves.ts`
- Test: `src/engine/geom/boolean-curves.test.ts`

**Interfaces:**
- Consumes: `PathPoint` from `../types`.
- Produces:
  - `interface Cubic { p0: PathPoint; c1: PathPoint; c2: PathPoint; p3: PathPoint }`
  - `function evalCubic(c: Cubic, t: number): PathPoint`
  - `function reverseCubic(c: Cubic): Cubic`
  - `function splitCubicRange(c: Cubic, t0: number, t1: number): Cubic` — sub-cubic over `[t0,t1]`; if `t0 > t1`, returns the sub-cubic over `[t1,t0]` **reversed** (traversal-ordered).
  - `function projectToCubic(c: Cubic, p: PathPoint): { t: number; dist: number }` — nearest point on the cubic to `p`.
  - `function isStraightCubic(c: Cubic): boolean` — true when both control points lie on the p0→p3 line (within epsilon), i.e. a degenerate/line segment.

- [ ] **Step 1: Write the failing test**

```ts
// src/engine/geom/boolean-curves.test.ts
import { describe, it, expect } from 'vitest';
import {
  evalCubic,
  reverseCubic,
  splitCubicRange,
  projectToCubic,
  isStraightCubic,
  type Cubic,
} from './boolean-curves';

const near = (a: { x: number; y: number }, b: { x: number; y: number }, eps = 1e-6) =>
  Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;

// A quarter-circle-ish cubic from (1,0) to (0,1) with kappa handles.
const K = 0.5522847498;
const quarter: Cubic = { p0: { x: 1, y: 0 }, c1: { x: 1, y: K }, c2: { x: K, y: 1 }, p3: { x: 0, y: 1 } };
const line: Cubic = { p0: { x: 0, y: 0 }, c1: { x: 1, y: 1 }, c2: { x: 2, y: 2 }, p3: { x: 3, y: 3 } };

describe('cubic primitives', () => {
  it('evalCubic hits endpoints and midpoint', () => {
    expect(near(evalCubic(quarter, 0), { x: 1, y: 0 })).toBe(true);
    expect(near(evalCubic(quarter, 1), { x: 0, y: 1 })).toBe(true);
    const mid = evalCubic(quarter, 0.5);
    expect(mid.x).toBeGreaterThan(0.5);
    expect(mid.y).toBeGreaterThan(0.5);
  });

  it('reverseCubic swaps endpoints and handles', () => {
    const r = reverseCubic(quarter);
    expect(near(r.p0, quarter.p3)).toBe(true);
    expect(near(r.p3, quarter.p0)).toBe(true);
    expect(near(r.c1, quarter.c2)).toBe(true);
    expect(near(r.c2, quarter.c1)).toBe(true);
  });

  it('splitCubicRange [0,1] is identity geometry', () => {
    const s = splitCubicRange(quarter, 0, 1);
    expect(near(evalCubic(s, 0), { x: 1, y: 0 })).toBe(true);
    expect(near(evalCubic(s, 1), { x: 0, y: 1 })).toBe(true);
    expect(near(evalCubic(s, 0.5), evalCubic(quarter, 0.5))).toBe(true);
  });

  it('splitCubicRange sub-range matches the parent curve', () => {
    const s = splitCubicRange(quarter, 0.25, 0.75);
    expect(near(evalCubic(s, 0), evalCubic(quarter, 0.25))).toBe(true);
    expect(near(evalCubic(s, 1), evalCubic(quarter, 0.75))).toBe(true);
    expect(near(evalCubic(s, 0.5), evalCubic(quarter, 0.5))).toBe(true);
  });

  it('splitCubicRange reversed range yields a reversed sub-cubic', () => {
    const s = splitCubicRange(quarter, 0.75, 0.25);
    expect(near(evalCubic(s, 0), evalCubic(quarter, 0.75))).toBe(true);
    expect(near(evalCubic(s, 1), evalCubic(quarter, 0.25))).toBe(true);
  });

  it('projectToCubic recovers the parameter of an on-curve point', () => {
    const target = evalCubic(quarter, 0.4);
    const { t, dist } = projectToCubic(quarter, target);
    expect(dist).toBeLessThan(1e-4);
    expect(Math.abs(t - 0.4)).toBeLessThan(1e-2);
  });

  it('projectToCubic reports a large distance for an off-curve point', () => {
    const { dist } = projectToCubic(quarter, { x: 5, y: 5 });
    expect(dist).toBeGreaterThan(1);
  });

  it('isStraightCubic detects collinear control points', () => {
    expect(isStraightCubic(line)).toBe(true);
    expect(isStraightCubic(quarter)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/engine/geom/boolean-curves.test.ts`
Expected: FAIL — module `./boolean-curves` not found / exports undefined.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/engine/geom/boolean-curves.ts
import type { PathPoint } from '../types';

export interface Cubic {
  p0: PathPoint;
  c1: PathPoint;
  c2: PathPoint;
  p3: PathPoint;
}

const lerp = (a: PathPoint, b: PathPoint, t: number): PathPoint => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

export function evalCubic(c: Cubic, t: number): PathPoint {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return {
    x: a * c.p0.x + b * c.c1.x + d * c.c2.x + e * c.p3.x,
    y: a * c.p0.y + b * c.c1.y + d * c.c2.y + e * c.p3.y,
  };
}

export function reverseCubic(c: Cubic): Cubic {
  return { p0: c.p3, c1: c.c2, c2: c.c1, p3: c.p0 };
}

/** De Casteljau split at `t`, returning the LEFT [0,t] sub-cubic. */
function splitLeft(c: Cubic, t: number): Cubic {
  const ab = lerp(c.p0, c.c1, t);
  const bc = lerp(c.c1, c.c2, t);
  const cd = lerp(c.c2, c.p3, t);
  const abc = lerp(ab, bc, t);
  const bcd = lerp(bc, cd, t);
  const p = lerp(abc, bcd, t);
  return { p0: c.p0, c1: ab, c2: abc, p3: p };
}

/** De Casteljau split at `t`, returning the RIGHT [t,1] sub-cubic. */
function splitRight(c: Cubic, t: number): Cubic {
  const ab = lerp(c.p0, c.c1, t);
  const bc = lerp(c.c1, c.c2, t);
  const cd = lerp(c.c2, c.p3, t);
  const abc = lerp(ab, bc, t);
  const bcd = lerp(bc, cd, t);
  const p = lerp(abc, bcd, t);
  return { p0: p, c1: bcd, c2: cd, p3: c.p3 };
}

/** Sub-cubic over [t0,t1]; if t0 > t1 the result is reversed (traversal-ordered). */
export function splitCubicRange(c: Cubic, t0: number, t1: number): Cubic {
  const lo = Math.min(t0, t1);
  const hi = Math.max(t0, t1);
  // Take right of lo, then left of the remapped hi.
  const right = splitRight(c, lo);
  const remapped = hi >= 1 ? 1 : (hi - lo) / (1 - lo);
  const sub = splitLeft(right, Math.min(1, Math.max(0, remapped)));
  return t0 <= t1 ? sub : reverseCubic(sub);
}

export function projectToCubic(c: Cubic, p: PathPoint): { t: number; dist: number } {
  const d2 = (q: PathPoint) => (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
  // Coarse seed.
  const SEED = 24;
  let bestT = 0;
  let bestD = Infinity;
  for (let i = 0; i <= SEED; i++) {
    const t = i / SEED;
    const dd = d2(evalCubic(c, t));
    if (dd < bestD) {
      bestD = dd;
      bestT = t;
    }
  }
  // Bisection refine around the seed.
  let lo = Math.max(0, bestT - 1 / SEED);
  let hi = Math.min(1, bestT + 1 / SEED);
  for (let i = 0; i < 30; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (d2(evalCubic(c, m1)) < d2(evalCubic(c, m2))) hi = m2;
    else lo = m1;
  }
  const t = (lo + hi) / 2;
  return { t, dist: Math.sqrt(d2(evalCubic(c, t))) };
}

export function isStraightCubic(c: Cubic, eps = 1e-6): boolean {
  const vx = c.p3.x - c.p0.x;
  const vy = c.p3.y - c.p0.y;
  const len = Math.hypot(vx, vy);
  if (len < eps) return true; // degenerate point
  // Perpendicular distance of each control point from the p0->p3 line.
  const cross = (q: PathPoint) => Math.abs((q.x - c.p0.x) * vy - (q.y - c.p0.y) * vx) / len;
  return cross(c.c1) < eps && cross(c.c2) < eps;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/engine/geom/boolean-curves.test.ts`
Expected: PASS (8 assertions across the describe block).

- [ ] **Step 5: Commit**

```bash
git add src/engine/geom/boolean-curves.ts src/engine/geom/boolean-curves.test.ts
git commit -m "feat(boolean): cubic primitives (eval/reverse/range-split/project) for curve preservation"
```

---

### Task 2: Leaf operand → world-space cubic segments

**Files:**
- Modify: `src/engine/geom/boolean.ts` (add `operandCubicsWorld`, near `objectToWorldPolygon`)
- Test: `src/engine/geom/boolean.test.ts`

**Interfaces:**
- Consumes: `Cubic` from `./boolean-curves`; existing `assetOf`, `localOutline` infrastructure, `toWorld`, `resolveAnchor`, `effectivePath`, `pathBounds`, `sampleObject` (already in `boolean.ts`).
- Produces:
  - `function operandCubicsWorld(project: Project, obj: SceneObject, time: number): Cubic[]` — ordered closed loop of world-space cubics for a **leaf vector** operand (path/rect/ellipse). Returns `[]` for groups, non-vector, or degenerate geometry. Zero-length segments are skipped.
  - `const KAPPA = 0.5522847498`

**Notes for implementer:** This mirrors `objectToWorldPolygon` but emits cubics instead of a flat ring. Build LOCAL cubics first (in the operand's local frame), then map all four control points of each cubic through the existing `toWorld(project, obj, anchorX, anchorY, point, time)`. Affine maps preserve cubics, so this is exact.

- [ ] **Step 1: Write the failing test**

```ts
// append to src/engine/geom/boolean.test.ts
import { operandCubicsWorld } from './boolean';
import { evalCubic } from './boolean-curves';

// Use whatever project/object factory the existing tests in this file already use.
// These helpers are illustrative names; match them to the file's existing setup.
describe('operandCubicsWorld', () => {
  it('rect -> 4 straight cubics spanning the world rect', () => {
    const { project, obj } = makeRectOperand({ x: 10, y: 20, width: 30, height: 40 }); // existing helper style
    const cubics = operandCubicsWorld(project, obj, 0);
    expect(cubics).toHaveLength(4);
    // Each corner of the world rect appears as some cubic endpoint.
    const corners = cubics.map((c) => c.p0);
    const hasCorner = (x: number, y: number) =>
      corners.some((p) => Math.abs(p.x - x) < 1e-6 && Math.abs(p.y - y) < 1e-6);
    expect(hasCorner(10, 20)).toBe(true);
    expect(hasCorner(40, 20)).toBe(true);
    expect(hasCorner(40, 60)).toBe(true);
    expect(hasCorner(10, 60)).toBe(true);
  });

  it('ellipse -> 4 curved cubics whose midpoints lie on the ellipse', () => {
    const { project, obj } = makeEllipseOperand({ cx: 50, cy: 50, rx: 20, ry: 10 });
    const cubics = operandCubicsWorld(project, obj, 0);
    expect(cubics).toHaveLength(4);
    for (const c of cubics) {
      const m = evalCubic(c, 0.5);
      // On the ellipse: ((x-cx)/rx)^2 + ((y-cy)/ry)^2 ~= 1 (kappa approx within ~0.1%).
      const v = ((m.x - 50) / 20) ** 2 + ((m.y - 50) / 10) ** 2;
      expect(Math.abs(v - 1)).toBeLessThan(0.02);
    }
  });

  it('group operand -> [] (faceted path kept for groups in v1)', () => {
    const { project, group } = makeGroupOperand();
    expect(operandCubicsWorld(project, group, 0)).toEqual([]);
  });
});
```

> Implementer: replace `makeRectOperand` / `makeEllipseOperand` / `makeGroupOperand` with the project/object construction style already used at the top of `boolean.test.ts`. Do not invent a new fixture system; reuse the file's existing one.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/engine/geom/boolean.test.ts -t operandCubicsWorld`
Expected: FAIL — `operandCubicsWorld` is not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/engine/geom/boolean.ts — add imports
import type { Cubic } from './boolean-curves';

export const KAPPA = 0.5522847498;

// Local-frame cubic segments (closed loop) for a leaf vector object at `time`.
// null when the object has no usable geometry.
function localCubics(obj: SceneObject, asset: VectorAsset, time: number): Cubic[] | null {
  const straight = (a: PathPoint, b: PathPoint): Cubic => ({ p0: a, c1: a, c2: b, p3: b });

  if (asset.shapeType === 'rect') {
    const g = sampleObject(obj, time).geometry ?? {};
    const w = Math.max(0, g.width ?? 0);
    const h = Math.max(0, g.height ?? 0);
    if (w === 0 || h === 0) return null;
    const c = [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ];
    return [straight(c[0], c[1]), straight(c[1], c[2]), straight(c[2], c[3]), straight(c[3], c[0])];
  }

  if (asset.shapeType === 'ellipse') {
    const g = sampleObject(obj, time).geometry ?? {};
    const rx = Math.max(0, g.radiusX ?? 0);
    const ry = Math.max(0, g.radiusY ?? 0);
    if (rx === 0 || ry === 0) return null;
    const cx = rx;
    const cy = ry; // center matches localOutline's (rx,ry) convention
    const A0 = { x: cx + rx, y: cy };
    const A1 = { x: cx, y: cy + ry };
    const A2 = { x: cx - rx, y: cy };
    const A3 = { x: cx, y: cy - ry };
    const kx = KAPPA * rx;
    const ky = KAPPA * ry;
    return [
      { p0: A0, c1: { x: A0.x, y: A0.y + ky }, c2: { x: A1.x + kx, y: A1.y }, p3: A1 },
      { p0: A1, c1: { x: A1.x - kx, y: A1.y }, c2: { x: A2.x, y: A2.y + ky }, p3: A2 },
      { p0: A2, c1: { x: A2.x, y: A2.y - ky }, c2: { x: A3.x - kx, y: A3.y }, p3: A3 },
      { p0: A3, c1: { x: A3.x + kx, y: A3.y }, c2: { x: A0.x, y: A0.y - ky }, p3: A0 },
    ];
  }

  // path: build a cubic per consecutive node pair (plus closing), using the
  // pathToD/flattenPoints rule: cubic iff prev.out || cur.in.
  const path = effectivePath(obj, asset, time);
  const nodes = path.nodes;
  if (nodes.length < 2) return null;
  const add = (a: PathPoint, off?: PathPoint): PathPoint =>
    off ? { x: a.x + off.x, y: a.y + off.y } : a;
  const segOf = (prev: PathNode, cur: PathNode): Cubic => {
    if (prev.out || cur.in) {
      return { p0: prev.anchor, c1: add(prev.anchor, prev.out), c2: add(cur.anchor, cur.in), p3: cur.anchor };
    }
    return straight(prev.anchor, cur.anchor);
  };
  const out: Cubic[] = [];
  const push = (s: Cubic) => {
    if (Math.hypot(s.p3.x - s.p0.x, s.p3.y - s.p0.y) > 1e-9 || s.p0 !== s.p3) out.push(s);
  };
  for (let i = 1; i < nodes.length; i++) push(segOf(nodes[i - 1], nodes[i]));
  if (path.closed && nodes.length > 1) push(segOf(nodes[nodes.length - 1], nodes[0]));
  return out.length >= 2 ? out : null;
}

/** World-space cubic segments for a LEAF vector operand. [] for groups/non-vector/degenerate. */
export function operandCubicsWorld(project: Project, obj: SceneObject, time: number): Cubic[] {
  if (obj.isGroup) return [];
  const asset = assetOf(project, obj);
  if (!asset) return [];
  const local = localCubics(obj, asset, time);
  if (!local) return [];
  const state = sampleObject(obj, time);
  const box = asset.shapeType === 'path' ? pathBounds(effectivePath(obj, asset, time)) : undefined;
  const { anchorX, anchorY } = resolveAnchor(obj, state, asset.shapeType, box);
  const w = (p: PathPoint): PathPoint => toWorld(project, obj, anchorX, anchorY, p, time);
  return local.map((c) => ({ p0: w(c.p0), c1: w(c.c1), c2: w(c.c2), p3: w(c.p3) }));
}
```

> Implementer: `PathNode` may need adding to the `boolean.ts` type import from `../types`. The zero-length filter intentionally keeps degenerate straight cubics only when endpoints differ.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/engine/geom/boolean.test.ts -t operandCubicsWorld`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/geom/boolean.ts src/engine/geom/boolean.test.ts
git commit -m "feat(boolean): world-space cubic segments for leaf operands (rect/ellipse/path)"
```

---

### Task 3: Flatten cubics → clip-input ring

**Files:**
- Modify: `src/engine/geom/boolean-curves.ts`
- Test: `src/engine/geom/boolean-curves.test.ts`

**Interfaces:**
- Consumes: `Cubic`, `evalCubic`.
- Produces:
  - `function cubicsToRing(cubics: Cubic[], steps?: number): [number, number][]` — a closed `polygon-clipping` ring (first point repeated at end) sampling each cubic at `steps` (default 16) points. Returns `[]` for empty input.

**Note:** This is the clip-input geometry. Provenance is NOT carried on the samples — it is recovered later by projection (Task 4). Default `steps` mirrors `FLATTEN_STEPS = 16`.

- [ ] **Step 1: Write the failing test**

```ts
// append to src/engine/geom/boolean-curves.test.ts
import { cubicsToRing } from './boolean-curves';

describe('cubicsToRing', () => {
  it('produces a closed ring with the expected vertex count', () => {
    const c1: Cubic = { p0: { x: 0, y: 0 }, c1: { x: 0, y: 0 }, c2: { x: 10, y: 0 }, p3: { x: 10, y: 0 } };
    const c2: Cubic = { p0: { x: 10, y: 0 }, c1: { x: 10, y: 0 }, c2: { x: 0, y: 0 }, p3: { x: 0, y: 0 } };
    const ring = cubicsToRing([c1, c2], 4);
    // 2 cubics * 4 steps = 8 sampled points, plus closing duplicate.
    expect(ring.length).toBe(9);
    expect(ring[0]).toEqual(ring[ring.length - 1]); // closed
    expect(ring[0]).toEqual([0, 0]);
  });

  it('returns [] for empty input', () => {
    expect(cubicsToRing([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/engine/geom/boolean-curves.test.ts -t cubicsToRing`
Expected: FAIL — `cubicsToRing` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/engine/geom/boolean-curves.ts
const DEFAULT_STEPS = 16;

export function cubicsToRing(cubics: Cubic[], steps = DEFAULT_STEPS): [number, number][] {
  if (cubics.length === 0) return [];
  const ring: [number, number][] = [];
  for (const c of cubics) {
    // sample t in [0, 1) per segment; the next segment's t=0 supplies the shared node
    for (let s = 0; s < steps; s++) {
      const p = evalCubic(c, s / steps);
      ring.push([p.x, p.y]);
    }
  }
  ring.push([ring[0][0], ring[0][1]]); // close
  return ring;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/engine/geom/boolean-curves.test.ts -t cubicsToRing`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/geom/boolean-curves.ts src/engine/geom/boolean-curves.test.ts
git commit -m "feat(boolean): flatten cubic segments to a polygon-clipping ring"
```

---

### Task 4: Classify a vertex by projection onto operand cubics

**Files:**
- Modify: `src/engine/geom/boolean-curves.ts`
- Test: `src/engine/geom/boolean-curves.test.ts`

**Interfaces:**
- Consumes: `Cubic`, `projectToCubic`.
- Produces:
  - `interface OperandCubics { opIdx: number; segs: Cubic[] }`
  - `interface VertProvenance { opIdx: number; segIdx: number; t: number }`
  - `function classifyVertex(operands: OperandCubics[], p: PathPoint, tol: number): VertProvenance | null` — nearest source cubic across all operands; provenance if within `tol`, else `null` (genuine intersection corner).

- [ ] **Step 1: Write the failing test**

```ts
// append to src/engine/geom/boolean-curves.test.ts
import { classifyVertex, type OperandCubics } from './boolean-curves';

describe('classifyVertex', () => {
  const seg: Cubic = { p0: { x: 0, y: 0 }, c1: { x: 0, y: 0 }, c2: { x: 10, y: 0 }, p3: { x: 10, y: 0 } };
  const operands: OperandCubics[] = [{ opIdx: 0, segs: [seg] }];

  it('returns provenance for an on-curve point', () => {
    const pr = classifyVertex(operands, { x: 5, y: 0 }, 0.01);
    expect(pr).not.toBeNull();
    expect(pr!.opIdx).toBe(0);
    expect(pr!.segIdx).toBe(0);
    expect(Math.abs(pr!.t - 0.5)).toBeLessThan(0.02);
  });

  it('returns null for an off-curve (intersection) point', () => {
    expect(classifyVertex(operands, { x: 5, y: 5 }, 0.01)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/engine/geom/boolean-curves.test.ts -t classifyVertex`
Expected: FAIL — `classifyVertex` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/engine/geom/boolean-curves.ts
export interface OperandCubics {
  opIdx: number;
  segs: Cubic[];
}

export interface VertProvenance {
  opIdx: number;
  segIdx: number;
  t: number;
}

export function classifyVertex(
  operands: OperandCubics[],
  p: PathPoint,
  tol: number,
): VertProvenance | null {
  let best: VertProvenance | null = null;
  let bestDist = tol;
  for (const op of operands) {
    for (let segIdx = 0; segIdx < op.segs.length; segIdx++) {
      const { t, dist } = projectToCubic(op.segs[segIdx], p);
      if (dist < bestDist) {
        bestDist = dist;
        best = { opIdx: op.opIdx, segIdx, t };
      }
    }
  }
  return best;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/engine/geom/boolean-curves.test.ts -t classifyVertex`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/geom/boolean-curves.ts src/engine/geom/boolean-curves.test.ts
git commit -m "feat(boolean): classify clipped vertices by projection onto operand cubics"
```

---

### Task 5: Output segments → PathData (nodes with handles)

**Files:**
- Modify: `src/engine/geom/boolean-curves.ts`
- Test: `src/engine/geom/boolean-curves.test.ts`

**Interfaces:**
- Consumes: `Cubic`, `isStraightCubic`; `PathData`, `PathNode` from `../types`.
- Produces:
  - `type OutSeg = { kind: 'line'; a: PathPoint; b: PathPoint } | { kind: 'cubic'; c: Cubic }`
  - `function segmentsToPathData(segs: OutSeg[]): PathData` — closed path; consecutive segments share their joint anchor; a `cubic` contributes `out` to its start node and `in` to its end node (offsets); a `line` contributes none. A straight cubic is treated like a line (no handles).

**Note:** Segments form a closed loop: `segs[i].end === segs[i+1].start`, and the last segment's end === the first segment's start. The function emits one node per joint.

- [ ] **Step 1: Write the failing test**

```ts
// append to src/engine/geom/boolean-curves.test.ts
import { segmentsToPathData, type OutSeg } from './boolean-curves';

describe('segmentsToPathData', () => {
  it('all-line loop -> corner nodes, no handles', () => {
    const segs: OutSeg[] = [
      { kind: 'line', a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
      { kind: 'line', a: { x: 10, y: 0 }, b: { x: 10, y: 10 } },
      { kind: 'line', a: { x: 10, y: 10 }, b: { x: 0, y: 0 } },
    ];
    const pd = segmentsToPathData(segs);
    expect(pd.closed).toBe(true);
    expect(pd.nodes).toHaveLength(3);
    expect(pd.nodes.every((n) => !n.in && !n.out)).toBe(true);
    expect(pd.nodes[0].anchor).toEqual({ x: 0, y: 0 });
  });

  it('cubic segment contributes out to start node and in to end node', () => {
    const c: Cubic = { p0: { x: 0, y: 0 }, c1: { x: 0, y: 5 }, c2: { x: 5, y: 10 }, p3: { x: 10, y: 10 } };
    const segs: OutSeg[] = [
      { kind: 'cubic', c },
      { kind: 'line', a: { x: 10, y: 10 }, b: { x: 0, y: 0 } },
    ];
    const pd = segmentsToPathData(segs);
    expect(pd.nodes).toHaveLength(2);
    // start node at (0,0): out = c1 - p0 = (0,5)
    expect(pd.nodes[0].out).toEqual({ x: 0, y: 5 });
    expect(pd.nodes[0].in).toBeUndefined();
    // end node at (10,10): in = c2 - p3 = (-5,0)
    expect(pd.nodes[1].in).toEqual({ x: -5, y: 0 });
    expect(pd.nodes[1].out).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/engine/geom/boolean-curves.test.ts -t segmentsToPathData`
Expected: FAIL — `segmentsToPathData` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/engine/geom/boolean-curves.ts — add import
import type { PathData, PathNode } from '../types';

export type OutSeg =
  | { kind: 'line'; a: PathPoint; b: PathPoint }
  | { kind: 'cubic'; c: Cubic };

const segStart = (s: OutSeg): PathPoint => (s.kind === 'line' ? s.a : s.c.p0);
const segEnd = (s: OutSeg): PathPoint => (s.kind === 'line' ? s.b : s.c.p3);

export function segmentsToPathData(segs: OutSeg[]): PathData {
  const n = segs.length;
  const nodes: PathNode[] = [];
  for (let i = 0; i < n; i++) {
    const cur = segs[i];
    const prev = segs[(i + 1) % n]; // segment ENDING at this node
    void prev;
    // Node i sits at the start of segs[i]; it receives `out` from segs[i] and
    // `in` from segs[i-1].
    const incoming = segs[(i - 1 + n) % n];
    const anchor = segStart(cur);
    const node: PathNode = { anchor };

    // out handle from the current (outgoing) segment
    if (cur.kind === 'cubic' && !isStraightCubic(cur.c)) {
      node.out = { x: cur.c.c1.x - anchor.x, y: cur.c.c1.y - anchor.y };
    }
    // in handle from the incoming segment (its end is this anchor)
    if (incoming.kind === 'cubic' && !isStraightCubic(incoming.c)) {
      const end = segEnd(incoming);
      node.in = { x: incoming.c.c2.x - end.x, y: incoming.c.c2.y - end.y };
    }
    nodes.push(node);
  }
  return { closed: true, nodes };
}
```

> Implementer: remove the unused `prev`/`void prev` scaffold; it documents the joint relationship — the real lookups are `cur` (outgoing) and `incoming` (segs[i-1]).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/engine/geom/boolean-curves.test.ts -t segmentsToPathData`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/geom/boolean-curves.ts src/engine/geom/boolean-curves.test.ts
git commit -m "feat(boolean): assemble output segments into PathData nodes with handles"
```

---

### Task 6: Reconstruct one clipped ring into curved segments

**Files:**
- Modify: `src/engine/geom/boolean-curves.ts`
- Test: `src/engine/geom/boolean-curves.test.ts`

**Interfaces:**
- Consumes: `OperandCubics`, `classifyVertex`, `splitCubicRange`, `evalCubic`, `OutSeg`, `segmentsToPathData`.
- Produces:
  - `function reconstructRing(ring: [number, number][], operands: OperandCubics[], tol: number): PathData | null` — converts one clipped, closed ring (first==last) into curved `PathData`; `null` if the result would be degenerate (caller falls back to faceted).

**Algorithm:**
1. Drop the trailing closing duplicate; let `V` be the unique vertices.
2. Classify each vertex via `classifyVertex` → array `prov[i]: VertProvenance | null`.
3. **Verbatim case:** if every `prov[i]` is non-null and shares the SAME `opIdx`, and there is no provenance "break" (see below) other than wrap-around, emit the operand's original `segs` directly as `cubic` OutSegs.
4. **General case:** rotate so index 0 starts a new run (a vertex whose previous vertex has different `(opIdx,segIdx)` or is null). Walk, grouping maximal runs of equal `(opIdx,segIdx)`. For each run produce one `OutSeg`:
   - source cubic straight → `{ kind:'line', a: V[start], b: V[end] }`
   - else → `{ kind:'cubic', c: splitCubicRange(seg, tStart, tEnd) }` where `tStart`/`tEnd` are the projected `t` of the run's first/last vertex (handles winding/reversal automatically).
   A `null`-provenance vertex is its own zero-length break that forces a line to the next vertex.
5. Stitch line gaps: between the end of one run and the start of the next, if endpoints differ, insert a `line` OutSeg so the loop stays closed.
6. `segmentsToPathData(segs)`; return `null` if `< 3` nodes.

- [ ] **Step 1: Write the failing test**

```ts
// append to src/engine/geom/boolean-curves.test.ts
import { reconstructRing } from './boolean-curves';
import { cubicsToRing } from './boolean-curves';

describe('reconstructRing', () => {
  const K = 0.5522847498;
  // Unit circle as 4 kappa quadrants centered at origin, radius 1.
  const circle: Cubic[] = [
    { p0: { x: 1, y: 0 }, c1: { x: 1, y: K }, c2: { x: K, y: 1 }, p3: { x: 0, y: 1 } },
    { p0: { x: 0, y: 1 }, c1: { x: -K, y: 1 }, c2: { x: -1, y: K }, p3: { x: -1, y: 0 } },
    { p0: { x: -1, y: 0 }, c1: { x: -1, y: -K }, c2: { x: -K, y: -1 }, p3: { x: 0, y: -1 } },
    { p0: { x: 0, y: -1 }, c1: { x: K, y: -1 }, c2: { x: 1, y: -K }, p3: { x: 1, y: 0 } },
  ];

  it('verbatim: an untouched circle ring round-trips to ~4 curved nodes', () => {
    const ring = cubicsToRing(circle, 16);
    const pd = reconstructRing(ring, [{ opIdx: 0, segs: circle }], 0.05);
    expect(pd).not.toBeNull();
    expect(pd!.nodes.length).toBeLessThanOrEqual(4);
    expect(pd!.nodes.some((n) => n.in || n.out)).toBe(true); // curved
  });

  it('all-corner ring (no provenance) -> null (caller faceted-fallbacks)', () => {
    const ring: [number, number][] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 0],
    ];
    // operands far away -> nothing matches within tol
    const pd = reconstructRing(ring, [{ opIdx: 0, segs: circle }], 0.001);
    // 3 corner nodes is still valid geometry; assert it is corners-only, not null.
    expect(pd).not.toBeNull();
    expect(pd!.nodes.every((n) => !n.in && !n.out)).toBe(true);
  });
});
```

> Implementer: tune the verbatim threshold so the first test yields ≤ 4 nodes. If the general walk also collapses the untouched circle to the same 4 curved nodes, the explicit verbatim branch is an optimization, not a correctness requirement — keep it for fidelity on disjoint-union rings.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/engine/geom/boolean-curves.test.ts -t reconstructRing`
Expected: FAIL — `reconstructRing` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/engine/geom/boolean-curves.ts
export function reconstructRing(
  ring: [number, number][],
  operands: OperandCubics[],
  tol: number,
): PathData | null {
  if (ring.length < 4) {
    // 3 unique verts + close at minimum
    const verts = stripClose(ring);
    if (verts.length < 3) return null;
    return cornersOnly(verts);
  }
  const verts = stripClose(ring);
  if (verts.length < 3) return null;
  const prov = verts.map((v) => classifyVertex(operands, { x: v[0], y: v[1] }, tol));

  // Verbatim: all same opIdx, none null.
  const firstOp = prov[0]?.opIdx;
  const verbatim =
    firstOp !== undefined && prov.every((p) => p !== null && p.opIdx === firstOp);
  if (verbatim) {
    const segs: OutSeg[] = operands
      .find((o) => o.opIdx === firstOp)!
      .segs.map((c) => ({ kind: 'cubic', c }));
    const pd = segmentsToPathData(segs);
    return pd.nodes.length >= 3 ? pd : cornersOnly(verts);
  }

  // General: group maximal runs of equal (opIdx,segIdx); null breaks a run.
  const sameRun = (i: number, j: number): boolean => {
    const a = prov[i];
    const b = prov[j];
    return !!a && !!b && a.opIdx === b.opIdx && a.segIdx === b.segIdx;
  };
  const n = verts.length;
  // rotate start to a run boundary
  let start = 0;
  for (let i = 0; i < n; i++) {
    if (!sameRun((i - 1 + n) % n, i)) {
      start = i;
      break;
    }
  }
  const pt = (i: number): PathPoint => ({ x: verts[i][0], y: verts[i][1] });
  const segOfProv = (p: VertProvenance): Cubic => operands.find((o) => o.opIdx === p.opIdx)!.segs[p.segIdx];

  const segs: OutSeg[] = [];
  let i = 0;
  while (i < n) {
    const idx = (start + i) % n;
    const p = prov[idx];
    if (!p) {
      // corner vertex -> line to next vertex
      const nextIdx = (start + i + 1) % n;
      segs.push({ kind: 'line', a: pt(idx), b: pt(nextIdx) });
      i += 1;
      continue;
    }
    // extend the run while provenance segment matches
    let j = i;
    while (j + 1 < n && sameRun((start + j) % n, (start + j + 1) % n)) j += 1;
    const aIdx = (start + i) % n;
    const bIdx = (start + j) % n;
    const cubic = segOfProv(p);
    if (isStraightCubic(cubic)) {
      segs.push({ kind: 'line', a: pt(aIdx), b: pt(bIdx) });
    } else {
      const tA = p.t;
      const tB = prov[bIdx]!.t;
      segs.push({ kind: 'cubic', c: splitCubicRange(cubic, tA, tB) });
    }
    // stitch a line from this run's end to the next vertex if there is a gap
    const nextIdx = (start + j + 1) % n;
    if (j + 1 < n) {
      const e = pt(bIdx);
      const s = pt(nextIdx);
      if (Math.hypot(s.x - e.x, s.y - e.y) > 1e-9) {
        segs.push({ kind: 'line', a: e, b: s });
      }
    }
    i = j + 1;
  }

  // close the loop: ensure last seg end meets first seg start
  if (segs.length >= 2) {
    const lastEnd = segEnd(segs[segs.length - 1]);
    const firstStart = segStart(segs[0]);
    if (Math.hypot(firstStart.x - lastEnd.x, firstStart.y - lastEnd.y) > 1e-9) {
      segs.push({ kind: 'line', a: lastEnd, b: firstStart });
    }
  }

  const pd = segmentsToPathData(segs);
  return pd.nodes.length >= 3 ? pd : cornersOnly(verts);
}

function stripClose(ring: [number, number][]): [number, number][] {
  if (ring.length > 1) {
    const f = ring[0];
    const l = ring[ring.length - 1];
    if (f[0] === l[0] && f[1] === l[1]) return ring.slice(0, -1);
  }
  return ring;
}

function cornersOnly(verts: [number, number][]): PathData {
  return { closed: true, nodes: verts.map(([x, y]) => ({ anchor: { x, y } })) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/engine/geom/boolean-curves.test.ts -t reconstructRing`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/geom/boolean-curves.ts src/engine/geom/boolean-curves.test.ts
git commit -m "feat(boolean): reconstruct a clipped ring into curved segments (verbatim + general)"
```

---

### Task 7: Wire curve preservation into `booleanOp`

**Files:**
- Modify: `src/engine/geom/boolean.ts` (`booleanOp`, and `operandWorldGeom` usage)
- Test: `src/engine/geom/boolean.test.ts`

**Interfaces:**
- Consumes: `operandCubicsWorld`, `cubicsToRing`, `reconstructRing`, `OperandCubics`, `ringToPathData` (existing fallback).
- Produces: unchanged `booleanOp(...)` signature; results now carry handles for curved leaf operands.

**Plan for `booleanOp`:**
- For each operand (sorted bottom-most first, as today), compute leaf cubics:
  - leaf with cubics → record `OperandCubics { opIdx, segs }`, and its clip geom = `[cubicsToRing(segs)]`.
  - group / no cubics → clip geom = `operandWorldGeom(...)` (today's flat union); contributes **no** entry to `operands` (its vertices won't project-match → corners).
- Run the same pc op on the collected geoms.
- For each result ring: `reconstructRing(ring, operands, tol)`; if it returns `null`, fall back to `ringToPathData(ring)`. `tol` = `max(1e-4, bboxDiag * 1e-4)` where `bboxDiag` is the diagonal of the union of operand world bounds.
- Wrap each ring's reconstruction in try/catch; on throw, use `ringToPathData(ring)` (parity-safe).

- [ ] **Step 1: Write the failing test**

```ts
// append to src/engine/geom/boolean.test.ts
describe('booleanOp curve preservation', () => {
  it('union of two disjoint circles preserves curves (few curved nodes per ring)', () => {
    const { project, objs } = makeTwoDisjointCircles(); // existing-style fixture
    const rings = booleanOp(project, objs, 'union', 0);
    expect(rings.length).toBe(2);
    for (const r of rings) {
      expect(r.nodes.length).toBeLessThanOrEqual(6);
      expect(r.nodes.some((n) => n.in || n.out)).toBe(true);
    }
  });

  it('rect intersect rect stays corners-only (parity)', () => {
    const { project, objs } = makeTwoOverlappingRects();
    const rings = booleanOp(project, objs, 'intersect', 0);
    expect(rings.length).toBe(1);
    expect(rings[0].nodes.every((n) => !n.in && !n.out)).toBe(true);
  });

  it('circle subtracted from rect: rect corners + a curved bite', () => {
    const { project, objs } = makeCircleBiteFromRect();
    const rings = booleanOp(project, objs, 'subtract', 0);
    expect(rings.length).toBeGreaterThanOrEqual(1);
    const curved = rings.flatMap((r) => r.nodes).some((n) => n.in || n.out);
    expect(curved).toBe(true);
  });

  it('degenerate operand geometry does not throw', () => {
    const { project, objs } = makeDegenerateOperandPair();
    expect(() => booleanOp(project, objs, 'union', 0)).not.toThrow();
  });
});
```

> Implementer: build the four fixtures with the construction style already used in `boolean.test.ts`. `makeTwoDisjointCircles` = two ellipse operands with equal radii, far apart. `makeCircleBiteFromRect` = a rect with an ellipse overlapping one edge, `subtract` with the ellipse on top (higher zOrder).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/engine/geom/boolean.test.ts -t "curve preservation"`
Expected: FAIL — results are corner-only (no `in`/`out`).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/engine/geom/boolean.ts — imports
import { cubicsToRing, reconstructRing, type OperandCubics } from './boolean-curves';

export function booleanOp(project: Project, objs: SceneObject[], op: BoolOp, time: number): PathData[] {
  const sorted = objs.slice().sort((a, b) => a.zOrder - b.zOrder); // bottom-most first

  const operands: OperandCubics[] = [];
  const geoms: (PcPolygon | PcMultiPolygon)[] = [];
  let opIdx = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const fold = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  for (const o of sorted) {
    const cubics = operandCubicsWorld(project, o, time);
    if (cubics.length >= 2) {
      const id = opIdx++;
      operands.push({ opIdx: id, segs: cubics });
      const ring = cubicsToRing(cubics);
      if (ring.length > 0) {
        for (const [x, y] of ring) fold(x, y);
        geoms.push([ring]);
      }
    } else {
      const g = operandWorldGeom(project, o, time); // group / fallback flat union
      if (g.length > 0) geoms.push(g);
    }
  }
  if (geoms.length < 2) return [];

  const head = geoms[0];
  const rest = geoms.slice(1);
  let result: PcMultiPolygon;
  if (op === 'union') result = pc.union(head, ...rest);
  else if (op === 'intersect') result = pc.intersection(head, ...rest);
  else if (op === 'exclude') result = pc.xor(head, ...rest);
  else result = pc.difference(head, ...rest);

  const diag = Number.isFinite(minX) ? Math.hypot(maxX - minX, maxY - minY) : 0;
  const tol = Math.max(1e-4, diag * 1e-4);

  const out: PathData[] = [];
  for (const poly of result) {
    for (const ring of poly) {
      let pd: PathData | null = null;
      try {
        pd = operands.length > 0 ? reconstructRing(ring, operands, tol) : null;
      } catch {
        pd = null;
      }
      const final = pd ?? ringToPathData(ring);
      if (final.nodes.length >= 3) out.push(final);
    }
  }
  return out;
}
```

> Implementer: `ring` here is a `PcRing` (`[number,number][]`); `reconstructRing` accepts exactly that. Keep `operandWorldGeom`, `objectToWorldPolygon`, `ringToPathData`, `localOutline` as-is — they remain the group/fallback path.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/engine/geom/boolean.test.ts -t "curve preservation"`
Expected: PASS.

- [ ] **Step 5: Run the full boolean suite to catch parity regressions**

Run: `pnpm vitest run src/engine/geom/boolean.test.ts`
Expected: PASS except possibly pre-existing **ellipse** assertions that hard-coded faceted node counts — those are updated in Task 8.

- [ ] **Step 6: Commit**

```bash
git add src/engine/geom/boolean.ts src/engine/geom/boolean.test.ts
git commit -m "feat(boolean): curve-preserving results for leaf operands (groups keep faceted)"
```

---

### Task 8: Update existing expectations, full suite, and e2e smoke

**Files:**
- Modify: `src/engine/geom/boolean.test.ts` (pre-existing ellipse-result assertions)
- Modify: `e2e/boolean-ops.spec.ts`

**Interfaces:**
- Consumes: everything above. No new production exports.

- [ ] **Step 1: Identify ellipse-result assertions that changed**

Run: `pnpm vitest run src/engine/geom/boolean.test.ts`
Read each failure. Any failure asserting a specific node COUNT or specific anchor list for an **ellipse-involving** result is an intended change (faceted → curved). Rect-only assertions should still pass; if a rect assertion fails, that is a real regression — STOP and fix the implementation, do not edit the test.

- [ ] **Step 2: Update the ellipse assertions to the curved expectation**

For each intended failure, replace the faceted expectation with curve-aware checks, e.g.:

```ts
// before: expect(result[0].nodes).toHaveLength(64+something)
// after:
expect(result[0].nodes.length).toBeLessThanOrEqual(8);
expect(result[0].nodes.some((n) => n.in || n.out)).toBe(true);
```

Keep any assertion about ring COUNT (number of disjoint regions / holes) unchanged — topology is unchanged, only node density/curvature changed.

- [ ] **Step 3: Run the full unit suite**

Run: `pnpm vitest run`
Expected: PASS (all unit tests green).

- [ ] **Step 4: Add an e2e smoke check for curved boolean output**

In `e2e/boolean-ops.spec.ts`, add a test that creates an ellipse + a rect, selects both, runs `subtract`, and asserts the resulting object renders a path whose `d` attribute contains a cubic command (`C`) — i.e. curvature survived to the DOM. Scope selectors to `section[aria-label="Stage"]` (per the project's e2e selector-collision lesson).

```ts
test('boolean subtract preserves curves in the rendered path', async ({ page }) => {
  // ... existing setup helpers in this spec to add an ellipse and a rect, select both ...
  // run subtract (toolbar button or Cmd/Ctrl+Shift+S)
  const stage = page.locator('section[aria-label="Stage"]');
  const resultPath = stage.locator('[data-savig-object] path').last();
  await expect(resultPath).toHaveAttribute('d', /[Cc]/);
});
```

> Implementer: reuse this spec's existing object-creation/selection helpers; do not invent new ones. If the spec lacks an ellipse helper, add one mirroring the existing rect helper.

- [ ] **Step 5: Run e2e**

First kill any stale Vite (project lesson), then:

Run: `pnpm e2e e2e/boolean-ops.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/engine/geom/boolean.test.ts e2e/boolean-ops.spec.ts
git commit -m "test(boolean): update ellipse expectations to curved results + e2e curve smoke"
```

---

## Self-Review

**Spec coverage:**
- Outline→cubics (path/rect/ellipse, world transform, kappa, skip zero-length) → Task 2. ✓
- Provenance flatten / clip input (FLATTEN_STEPS) → Task 3. ✓
- Projection match-back (routine + bbox-relative tolerance) → Tasks 1 (`projectToCubic`) + 4 (`classifyVertex`, tol) + 7 (tol from bbox diagonal). ✓
- De Casteljau split + direction-aware reverse → Task 1 (`splitCubicRange`). ✓
- Verbatim no-corner ring (rebuild from original segments) → Task 6. ✓
- General run-walk + straight-segment corners + tangent-correct seams → Tasks 5 + 6. ✓
- Per-ring parity-safe fallback → Task 7 (try/catch + `null` → `ringToPathData`). ✓
- Group operands stay faceted → Task 7 (no `OperandCubics` entry for groups). ✓
- `pathBounds` unchanged (already handles extent) → no task needed (confirmed in spec). ✓
- `shift()`/`ringArea` unchanged → no task needed. ✓
- Tests: parity (rect), curve cases, verbatim, holes/subtract, degenerate-no-throw, e2e smoke → Tasks 7 + 8. ✓

**Placeholder scan:** No TBD/TODO. Fixture helper NAMES in tests are intentionally deferred to the file's existing style and flagged with an implementer note each time (not generic "add a test" placeholders — full assertion bodies are provided).

**Type consistency:** `Cubic`, `OperandCubics { opIdx, segs }`, `VertProvenance { opIdx, segIdx, t }`, `OutSeg`, `operandCubicsWorld`, `cubicsToRing`, `classifyVertex`, `segmentsToPathData`, `reconstructRing` are named identically across Tasks 1-7. `splitCubicRange` (not `splitCubic`) used consistently. `booleanOp` signature unchanged.

## Notes / Risks carried from spec
- Projection tolerance is the one empirical knob; per-ring fallback bounds the blast radius.
- The verbatim branch is fidelity insurance for disjoint-union rings; if the general walk already collapses untouched loops cleanly, it is redundant but harmless.
- Ellipse kappa ~0.06% radial error (invisible).
