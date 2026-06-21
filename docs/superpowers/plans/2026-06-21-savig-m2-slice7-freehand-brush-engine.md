# M2 Slice 7 — Freehand Brush (Plan A: Engine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the pure geometry that turns raw freehand drag samples into a smooth, editable `PathData` stroke.

**Architecture:** Two pure modules. `engine/geom/simplify.ts` does Ramer–Douglas–Peucker point reduction (reusable, sibling to `arcLength.ts`). `engine/brush.ts` maps a 0..1 smoothing control to concrete params (`brushParams`) and orchestrates dedupe → simplify → Catmull-Rom→bezier into an open `PathData` (`strokeToPath`). No other engine file changes; the result flows through the existing path pipeline (Slice 6 architecture), so there is no render-seam, export, runtime, or persistence change. Stays at project version 4.

**Tech Stack:** TypeScript (strict), Vitest. Pure functions only — no React, no DOM.

## Global Constraints

- TypeScript strict mode; no `any`.
- Pure/deterministic engine modules (they are the preview==export "parity oracle").
- `PathPoint = { x: number; y: number }`; `PathNode = { anchor: PathPoint; in?: PathPoint; out?: PathPoint }` (handles are OFFSETS from the anchor; a node is "smooth" when `in == -out`); `PathData = { nodes: PathNode[]; closed: boolean }` — all from `src/engine/types.ts`.
- Use `0 - v` (never `-v`) when negating a coordinate component, so a zero stays `+0` not `-0` (Vitest `toEqual` distinguishes them; this bit prior slices).
- Run the full test file after each task: `pnpm vitest run <file>`.
- Commit after each task.

---

### Task 1: RDP point simplification — `engine/geom/simplify.ts`

**Files:**
- Create: `src/engine/geom/simplify.ts`
- Test: `src/engine/geom/simplify.test.ts`

**Interfaces:**
- Consumes: `PathPoint` from `../types`.
- Produces: `simplify(points: PathPoint[], epsilon: number): PathPoint[]` — returns a subset of `points` (first and last always kept) whose polyline stays within `epsilon` perpendicular distance of the original. `epsilon <= 0` or `points.length <= 2` returns a copy unchanged.

- [ ] **Step 1: Write the failing test**

```ts
// src/engine/geom/simplify.test.ts
import { describe, it, expect } from 'vitest';
import { simplify } from './simplify';

describe('simplify (RDP)', () => {
  it('drops a collinear midpoint', () => {
    const pts = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }];
    expect(simplify(pts, 1)).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
  });

  it('keeps a point that deviates beyond epsilon', () => {
    const pts = [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }];
    expect(simplify(pts, 1)).toEqual(pts);
  });

  it('always preserves the endpoints', () => {
    const pts = [{ x: 0, y: 0 }, { x: 1, y: 0.1 }, { x: 2, y: 0 }];
    const out = simplify(pts, 1);
    expect(out[0]).toEqual({ x: 0, y: 0 });
    expect(out[out.length - 1]).toEqual({ x: 2, y: 0 });
  });

  it('larger epsilon yields no more points than a smaller one', () => {
    const pts = [
      { x: 0, y: 0 }, { x: 1, y: 0.4 }, { x: 2, y: -0.3 }, { x: 3, y: 0.6 },
      { x: 4, y: 0.1 }, { x: 5, y: 0 },
    ];
    expect(simplify(pts, 2).length).toBeLessThanOrEqual(simplify(pts, 0.2).length);
  });

  it('returns a copy unchanged for <= 2 points or epsilon <= 0', () => {
    const two = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    expect(simplify(two, 5)).toEqual(two);
    const many = [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }];
    expect(simplify(many, 0)).toEqual(many);
    expect(simplify(many, 0)).not.toBe(many); // copy, not the same array
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/engine/geom/simplify.test.ts`
Expected: FAIL — `simplify` is not exported / file missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/engine/geom/simplify.ts
import type { PathPoint } from '../types';

// Perpendicular distance from p to the infinite line through a-b. When a == b,
// the "line" degenerates to a point and we return the point distance.
function perpDistance(p: PathPoint, a: PathPoint, b: PathPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs(dx * (a.y - p.y) - dy * (a.x - p.x)) / len;
}

// Ramer–Douglas–Peucker. Returns a subset of `points` (endpoints always kept)
// whose polyline stays within `epsilon` of the original. `epsilon <= 0` or a
// 2-or-fewer-point input is returned as a shallow copy, unchanged.
export function simplify(points: PathPoint[], epsilon: number): PathPoint[] {
  if (points.length <= 2 || epsilon <= 0) return points.slice();
  const a = points[0];
  const b = points[points.length - 1];
  let maxDist = 0;
  let idx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDistance(points[i], a, b);
    if (d > maxDist) {
      maxDist = d;
      idx = i;
    }
  }
  if (maxDist > epsilon) {
    const left = simplify(points.slice(0, idx + 1), epsilon);
    const right = simplify(points.slice(idx), epsilon);
    // `right` repeats the split point that ends `left`; drop the duplicate.
    return left.slice(0, -1).concat(right);
  }
  return [a, b];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/engine/geom/simplify.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/geom/simplify.ts src/engine/geom/simplify.test.ts
git commit -m "feat(brush): RDP point simplification (engine/geom/simplify)"
```

---

### Task 2: Smoothing params + stroke-to-path — `engine/brush.ts`

**Files:**
- Create: `src/engine/brush.ts`
- Test: `src/engine/brush.test.ts`

**Interfaces:**
- Consumes: `PathData`, `PathNode`, `PathPoint` from `./types`; `simplify` from `./geom/simplify`.
- Produces:
  - `interface BrushParams { tolerance: number; smoothing: number }`
  - `brushParams(smoothing: number): BrushParams` — clamps `smoothing` to [0,1]; `tolerance = 1 + s*7` (px), `smoothing = s`. Monotonic in `s`.
  - `strokeToPath(points: PathPoint[], opts: BrushParams): PathData` — open path. Dedupes near-coincident input; `< 2` distinct points → `{ nodes: [], closed: false }`; exactly 2 → straight 2-node corner path; else one smooth node per simplified point (Catmull-Rom → bezier offsets, scaled `k = opts.smoothing * 2` so the default 0.5 == standard Catmull-Rom; `k == 0` → corner nodes with no handles).

- [ ] **Step 1: Write the failing test**

```ts
// src/engine/brush.test.ts
import { describe, it, expect } from 'vitest';
import { brushParams, strokeToPath } from './brush';

describe('brushParams', () => {
  it('clamps to [0,1] and is monotonic in tolerance', () => {
    expect(brushParams(-1).tolerance).toBe(brushParams(0).tolerance);
    expect(brushParams(2).tolerance).toBe(brushParams(1).tolerance);
    expect(brushParams(1).tolerance).toBeGreaterThan(brushParams(0).tolerance);
    expect(brushParams(0).tolerance).toBeGreaterThan(0); // always some cleanup
  });
});

describe('strokeToPath', () => {
  const line = (n: number) => Array.from({ length: n }, (_, i) => ({ x: i, y: 0 }));

  it('returns an empty open path for fewer than 2 distinct points', () => {
    expect(strokeToPath([], brushParams(0.5))).toEqual({ nodes: [], closed: false });
    expect(strokeToPath([{ x: 1, y: 1 }, { x: 1, y: 1 }], brushParams(0.5)))
      .toEqual({ nodes: [], closed: false });
  });

  it('collapses a straight drag to a 2-node corner path', () => {
    const path = strokeToPath(line(10), brushParams(0.5));
    expect(path.closed).toBe(false);
    expect(path.nodes).toHaveLength(2);
    expect(path.nodes[0].in).toBeUndefined();
    expect(path.nodes[0].out).toBeUndefined();
  });

  it('produces smooth nodes (in == -out) on a curved stroke at default smoothing', () => {
    const pts = [
      { x: 0, y: 0 }, { x: 10, y: 20 }, { x: 20, y: 0 }, { x: 30, y: 20 }, { x: 40, y: 0 },
    ];
    const path = strokeToPath(pts, brushParams(0.5));
    expect(path.closed).toBe(false);
    expect(path.nodes.length).toBeGreaterThanOrEqual(3);
    const mid = path.nodes[1];
    expect(mid.in).toBeDefined();
    expect(mid.out).toBeDefined();
    expect(mid.in!.x).toBeCloseTo(0 - mid.out!.x);
    expect(mid.in!.y).toBeCloseTo(0 - mid.out!.y);
  });

  it('emits corner nodes (no handles) when smoothing is 0', () => {
    const pts = [
      { x: 0, y: 0 }, { x: 10, y: 20 }, { x: 20, y: 0 }, { x: 30, y: 20 }, { x: 40, y: 0 },
    ];
    const path = strokeToPath(pts, brushParams(0));
    for (const n of path.nodes) {
      expect(n.in).toBeUndefined();
      expect(n.out).toBeUndefined();
    }
  });

  it('is deterministic', () => {
    const pts = [{ x: 0, y: 0 }, { x: 5, y: 9 }, { x: 12, y: 3 }, { x: 20, y: 14 }];
    expect(strokeToPath(pts, brushParams(0.6))).toEqual(strokeToPath(pts, brushParams(0.6)));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/engine/brush.test.ts`
Expected: FAIL — `brushParams`/`strokeToPath` not exported / file missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/engine/brush.ts
import type { PathData, PathNode, PathPoint } from './types';
import { simplify } from './geom/simplify';

export interface BrushParams {
  /** RDP epsilon (px). */
  tolerance: number;
  /** Catmull-Rom handle scale (0 = corner polyline, 0.5 = default, 1 = strong). */
  smoothing: number;
}

// Map the 0..1 `brushSmoothing` UI control to concrete pipeline params. Monotonic:
// higher smoothing => larger RDP tolerance (fewer points) and longer CR handles.
export function brushParams(smoothing: number): BrushParams {
  const s = Math.min(1, Math.max(0, smoothing));
  return { tolerance: 1 + s * 7, smoothing: s };
}

const DEDUPE_EPS = 0.01;

function dedupe(points: PathPoint[]): PathPoint[] {
  const out: PathPoint[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > DEDUPE_EPS) out.push(p);
  }
  return out;
}

// Build an open, smooth vector stroke from raw drag samples (stage-space). The
// single source of stroke geometry: the same PathData previews, commits, and exports.
export function strokeToPath(points: PathPoint[], opts: BrushParams): PathData {
  const pts = simplify(dedupe(points), opts.tolerance);
  if (pts.length < 2) return { nodes: [], closed: false };
  if (pts.length === 2) {
    return { nodes: [{ anchor: pts[0] }, { anchor: pts[1] }], closed: false };
  }
  // Catmull-Rom tangent at P[i] is (P[i+1] - P[i-1]) / 6 for the cubic-bezier
  // conversion; scale by k so default smoothing (0.5) reproduces standard CR.
  const k = opts.smoothing * 2;
  const nodes: PathNode[] = pts.map((p, i) => {
    const node: PathNode = { anchor: { x: p.x, y: p.y } };
    if (k > 0) {
      const prev = pts[i - 1] ?? p; // one-sided tangent at the ends
      const next = pts[i + 1] ?? p;
      const tx = ((next.x - prev.x) / 6) * k;
      const ty = ((next.y - prev.y) / 6) * k;
      node.out = { x: tx, y: ty };
      node.in = { x: 0 - tx, y: 0 - ty };
    }
    return node;
  });
  return { nodes, closed: false };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/engine/brush.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/brush.ts src/engine/brush.test.ts
git commit -m "feat(brush): brushParams + strokeToPath (Catmull-Rom smooth-fit)"
```

---

### Task 3: Barrel re-export

**Files:**
- Modify: `src/engine/index.ts` (it already does `export * from './primitives';` and `export * from './geom/arcLength';`)

**Interfaces:**
- Produces: `simplify`, `brushParams`, `strokeToPath`, `BrushParams` importable from `'../../../engine'` (the path Stage/store use).

- [ ] **Step 1: Add the failing test**

```ts
// append to src/engine/index.test.ts
import { strokeToPath, brushParams, simplify } from './index';

it('re-exports the brush + simplify API', () => {
  expect(typeof simplify).toBe('function');
  expect(typeof brushParams).toBe('function');
  expect(typeof strokeToPath).toBe('function');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/engine/index.test.ts`
Expected: FAIL — names not exported from the barrel.

- [ ] **Step 3: Add the exports**

Add these two lines to `src/engine/index.ts` next to the existing `export *` lines:

```ts
export * from './brush';
export * from './geom/simplify';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/engine/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Full engine gate + commit**

```bash
pnpm vitest run src/engine
pnpm exec tsc --noEmit
git add src/engine/index.ts src/engine/index.test.ts
git commit -m "feat(brush): re-export brush + simplify from engine barrel"
```

Expected: all engine tests green; typecheck clean.

---

## Self-Review (done while writing — recorded for the implementer)

- **Spec §4 (pipeline):** Task 1 = RDP simplify; Task 2 = dedupe + Catmull-Rom smooth-fit + `brushParams`. Covered.
- **Spec §4 degenerate guards:** 0/1 distinct → empty; 2 → straight corner path. Covered by `strokeToPath` tests.
- **Spec §6 (`brushParams` pure helper, monotonic):** Covered by Task 2.
- **Type consistency:** `BrushParams { tolerance, smoothing }` defined in Task 2 and consumed verbatim by `strokeToPath`; Plan B's Stage commit calls `strokeToPath(points, brushParams(brushSmoothing))`.
- **No placeholders:** every step has real code/commands.
- **Out of scope here (Plan B):** `ToolMode`/tool-option state, `addVectorPath` style seed, Stage capture, palette/shortcut/options UI, e2e.
