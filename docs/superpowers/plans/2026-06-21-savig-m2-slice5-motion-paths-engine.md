# Motion Paths — Plan A (Engine & Pipeline) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve a scene object's followed position (and optional tangent rotation) along a drawn guide path per-frame through the existing transform pipeline, with preview == export parity, while leaving objects without a motion path byte-identical.

**Architecture:** Extract the arc-length core (flatten / cumulative length / point-at-length) currently private to `engine/morph/resample.ts` into a shared pure `engine/geom/arcLength.ts`. A new pure `engine/motion.ts` adds `pointAtFraction`/`tangentAngleDeg` on top of it. `sampleObject` gains a motion-path override that rewrites `x`/`y` (and `rotation` when `orient`) from the followed point; the override is gated on an optional `motionPath` field with a non-empty `progress` track. Because `computeFrame` already derives the wrapper transform from `state.x/y/rotation`, the runtime needs no new field — only a bundle regen.

**Tech Stack:** TypeScript (strict), Vitest. Pure engine under `src/engine/`. Runtime bundle via `node scripts/build-runtime.mjs` (`pnpm build:runtime`).

## Global Constraints

- **Engine stays pure** — no React/DOM under `src/engine/`. The render core lifts verbatim into the export runtime.
- **Optional field only** → **no migration, no `CURRENT_VERSION` bump** (project version stays `4`). Absent `motionPath` (or an empty `progress` track) behaves exactly as today.
- **Position override is gated**: the override applies only when `motionPath` exists AND `motionPath.progress.length > 0`. It rewrites `x`/`y` always, and `rotation` only when `orient === true`. Scale, opacity, geometry, and color are never touched by motion paths.
- **Guide coordinates are stage-space**, the same space as `base.x`/`base.y`.
- **Arc-length extraction is behavior-preserving**: `resample`'s output must stay byte-identical (its existing tests in `src/engine/morph/resample.test.ts` are the guard).
- **Preview == export parity** through the shared pure `sampleObject` → unchanged `buildTransform`/`applyFrameToNodes`. Regenerate the runtime bundle when engine code changes.
- **TDD**: failing test → minimal impl → green → commit.
- Run unit tests with `pnpm vitest run <path>`; typecheck `pnpm typecheck`; lint `pnpm lint`; full build `pnpm build`.

---

## File Structure

- `src/engine/geom/arcLength.ts` — NEW: `Flattened`, `flattenPath`, `pointAtLength` (extracted from `resample.ts`).
- `src/engine/morph/resample.ts` — MODIFY: re-import the extracted helpers; keep output byte-identical.
- `src/engine/motion.ts` — NEW: `pointAtFraction`, `tangentAngleDeg`.
- `src/engine/types.ts` — MODIFY: `MotionPath` interface + `SceneObject.motionPath?`.
- `src/engine/sample.ts` — MODIFY: `sampleObject` motion-path override.
- `src/engine/duration.ts` — MODIFY: `computeProjectDuration` folds in `motionPath.progress`.
- `src/engine/index.ts` — MODIFY: re-export `motion.ts` and `geom/arcLength.ts`.
- Tests: `src/engine/geom/arcLength.test.ts`, `src/engine/motion.test.ts`, `src/engine/sample.test.ts`, `src/engine/duration.test.ts`, `src/runtime/frame.test.ts`.

---

## Task A1: Extract `engine/geom/arcLength.ts` (behavior-preserving)

**Files:**
- Create: `src/engine/geom/arcLength.ts`
- Modify: `src/engine/morph/resample.ts`
- Modify: `src/engine/index.ts`
- Test: `src/engine/geom/arcLength.test.ts`

**Interfaces:**
- Produces: `interface Flattened { pts: PathPoint[]; cum: number[]; total: number }`
- Produces: `flattenPath(path: PathData): Flattened`
- Produces: `pointAtLength(flat: Flattened, target: number): PathPoint`

- [ ] **Step 1: Write the failing tests**

Create `src/engine/geom/arcLength.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { flattenPath, pointAtLength } from './arcLength';
import type { PathData } from '../types';

const line: PathData = { nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }], closed: false };
const square: PathData = {
  nodes: [
    { anchor: { x: 0, y: 0 } },
    { anchor: { x: 10, y: 0 } },
    { anchor: { x: 10, y: 10 } },
    { anchor: { x: 0, y: 10 } },
  ],
  closed: true,
};

describe('flattenPath', () => {
  it('reports total arc length and a monotone cumulative array', () => {
    const f = flattenPath(line);
    expect(f.total).toBeCloseTo(10, 9);
    expect(f.cum[0]).toBe(0);
    expect(f.cum[f.cum.length - 1]).toBeCloseTo(10, 9);
    expect(f.pts[0]).toEqual({ x: 0, y: 0 });
  });
  it('includes the closing segment for a closed path', () => {
    const f = flattenPath(square);
    expect(f.total).toBeCloseTo(40, 9); // perimeter incl. close
  });
  it('empty path -> zero-length flatten', () => {
    const f = flattenPath({ nodes: [], closed: false });
    expect(f.pts).toEqual([]);
    expect(f.total).toBe(0);
  });
});

describe('pointAtLength', () => {
  it('clamps below 0 and above total', () => {
    const f = flattenPath(line);
    expect(pointAtLength(f, -5)).toEqual({ x: 0, y: 0 });
    expect(pointAtLength(f, 999)).toEqual({ x: 10, y: 0 });
  });
  it('interpolates within a segment by arc length', () => {
    const f = flattenPath(line);
    expect(pointAtLength(f, 2.5)).toEqual({ x: 2.5, y: 0 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/engine/geom/arcLength.test.ts`
Expected: FAIL — `./arcLength` does not exist.

- [ ] **Step 3: Create the extracted module**

Create `src/engine/geom/arcLength.ts` (lifts `add`/`dist`/`lerpPoint`/`cubicAt`/`flatten`/`pointAtLength` from `resample.ts`, exposing `flattenPath`/`pointAtLength`/`Flattened`):

```ts
import type { PathData, PathNode, PathPoint } from '../types';

export const FLATTEN_STEPS = 16;

export interface Flattened {
  /** Fine polyline along the rendered curve. */
  pts: PathPoint[];
  /** Cumulative arc length; cum[i] is the length up to pts[i]. cum[last] === total. */
  cum: number[];
  /** Total arc length. */
  total: number;
}

function add(anchor: PathPoint, offset: PathPoint | undefined): PathPoint {
  return offset ? { x: anchor.x + offset.x, y: anchor.y + offset.y } : anchor;
}

function dist(a: PathPoint, b: PathPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function lerpPoint(a: PathPoint, b: PathPoint, t: number): PathPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function cubicAt(p0: PathPoint, c1: PathPoint, c2: PathPoint, p3: PathPoint, u: number): PathPoint {
  const v = 1 - u;
  const a = v * v * v;
  const b = 3 * v * v * u;
  const c = 3 * v * u * u;
  const d = u * u * u;
  return {
    x: a * p0.x + b * c1.x + c * c2.x + d * p3.x,
    y: a * p0.y + b * c1.y + c * c2.y + d * p3.y,
  };
}

// Flatten to a fine polyline along the actually-rendered curve, using the SAME L/C
// classification as pathToD's segment(): cubic iff prev.out || cur.in.
function flattenPoints(path: PathData): PathPoint[] {
  const { nodes, closed } = path;
  if (nodes.length === 0) return [];
  const pts: PathPoint[] = [{ x: nodes[0].anchor.x, y: nodes[0].anchor.y }];
  const pushSegment = (prev: PathNode, cur: PathNode) => {
    if (prev.out || cur.in) {
      const c1 = add(prev.anchor, prev.out);
      const c2 = add(cur.anchor, cur.in);
      for (let s = 1; s <= FLATTEN_STEPS; s++) {
        pts.push(cubicAt(prev.anchor, c1, c2, cur.anchor, s / FLATTEN_STEPS));
      }
    } else {
      pts.push({ x: cur.anchor.x, y: cur.anchor.y });
    }
  };
  for (let i = 1; i < nodes.length; i++) pushSegment(nodes[i - 1], nodes[i]);
  if (closed && nodes.length > 1) pushSegment(nodes[nodes.length - 1], nodes[0]);
  return pts;
}

export function flattenPath(path: PathData): Flattened {
  const pts = flattenPoints(path);
  if (pts.length === 0) return { pts, cum: [], total: 0 };
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  return { pts, cum, total: cum[cum.length - 1] };
}

export function pointAtLength(flat: Flattened, target: number): PathPoint {
  const { pts, cum, total } = flat;
  if (pts.length === 0) return { x: 0, y: 0 };
  if (target <= 0) return { x: pts[0].x, y: pts[0].y };
  if (target >= total) return { x: pts[pts.length - 1].x, y: pts[pts.length - 1].y };
  let j = 1;
  while (j < cum.length && cum[j] < target) j++;
  const segLen = cum[j] - cum[j - 1];
  const t = segLen === 0 ? 0 : (target - cum[j - 1]) / segLen;
  return lerpPoint(pts[j - 1], pts[j], t);
}
```

- [ ] **Step 4: Refactor `resample.ts` to use the extracted core (byte-identical)**

Replace the top of `src/engine/morph/resample.ts` (the `add`/`dist`/`lerpPoint`/`cubicAt`/`flatten`/`pointAtLength` helpers and `FLATTEN_STEPS`) so it imports from the new module and keeps only `SAMPLE_COUNT` and the public `resample`:

```ts
import type { PathData, PathNode } from '../types';
import { flattenPath, pointAtLength } from '../geom/arcLength';

export const SAMPLE_COUNT = 64;

// Resample to `n` points evenly spaced by arc length, lying on the rendered curve.
export function resample(path: PathData, n: number = SAMPLE_COUNT): PathNode[] {
  const flat = flattenPath(path);
  if (flat.pts.length === 0) {
    return Array.from({ length: n }, () => ({ anchor: { x: 0, y: 0 } }));
  }
  const total = flat.total;
  if (total === 0) {
    const p = flat.pts[0];
    return Array.from({ length: n }, () => ({ anchor: { x: p.x, y: p.y } }));
  }
  const out: PathNode[] = [];
  for (let i = 0; i < n; i++) {
    // n <= 1 (degenerate request) samples the start point only — avoids 0/0 on the
    // open-path i/(n-1) divisor.
    const frac = n <= 1 ? 0 : path.closed ? i / n : i / (n - 1);
    out.push({ anchor: pointAtLength(flat, frac * total) });
  }
  return out;
}
```

(`FLATTEN_STEPS` now lives in `arcLength.ts`; if anything else imported it from `resample.ts`, re-point that import — grep `FLATTEN_STEPS` to confirm; only `resample.ts` used it.)

- [ ] **Step 5: Re-export from the barrel**

In `src/engine/index.ts`, add (near the other engine re-exports):

```ts
export * from './geom/arcLength';
```

- [ ] **Step 6: Run the new tests AND the resample guard**

Run: `pnpm vitest run src/engine/geom/arcLength.test.ts src/engine/morph/resample.test.ts && pnpm typecheck`
Expected: PASS — `resample.test.ts` is byte-identical-output proof the extraction preserved behavior.

- [ ] **Step 7: Commit**

```bash
git add src/engine/geom/arcLength.ts src/engine/geom/arcLength.test.ts src/engine/morph/resample.ts src/engine/index.ts
git commit -m "refactor(geom): extract shared arc-length core (flattenPath/pointAtLength) from resample"
```

---

## Task A2: `engine/motion.ts` — point & tangent at fraction

**Files:**
- Create: `src/engine/motion.ts`
- Modify: `src/engine/index.ts`
- Test: `src/engine/motion.test.ts`

**Interfaces:**
- Consumes: `flattenPath`, `pointAtLength` (A1).
- Produces: `pointAtFraction(path: PathData, frac: number): PathPoint`
- Produces: `tangentAngleDeg(path: PathData, frac: number): number`

- [ ] **Step 1: Write the failing tests**

Create `src/engine/motion.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { pointAtFraction, tangentAngleDeg } from './motion';
import type { PathData } from './types';

const horiz: PathData = { nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }], closed: false };
const vert: PathData = { nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 0, y: 100 } }], closed: false };

describe('pointAtFraction', () => {
  it('maps frac 0 / 0.5 / 1 to start / middle / end by arc length', () => {
    expect(pointAtFraction(horiz, 0)).toEqual({ x: 0, y: 0 });
    expect(pointAtFraction(horiz, 0.5)).toEqual({ x: 50, y: 0 });
    expect(pointAtFraction(horiz, 1)).toEqual({ x: 100, y: 0 });
  });
  it('clamps frac outside [0,1]', () => {
    expect(pointAtFraction(horiz, -2)).toEqual({ x: 0, y: 0 });
    expect(pointAtFraction(horiz, 9)).toEqual({ x: 100, y: 0 });
  });
  it('guards empty / zero-length paths', () => {
    expect(pointAtFraction({ nodes: [], closed: false }, 0.5)).toEqual({ x: 0, y: 0 });
    const dot: PathData = { nodes: [{ anchor: { x: 5, y: 5 } }, { anchor: { x: 5, y: 5 } }], closed: false };
    expect(pointAtFraction(dot, 0.5)).toEqual({ x: 5, y: 5 });
  });
  it('does not mutate the input', () => {
    const before = JSON.stringify(horiz);
    pointAtFraction(horiz, 0.5);
    expect(JSON.stringify(horiz)).toBe(before);
  });
});

describe('tangentAngleDeg', () => {
  it('is 0 along +x and 90 along +y', () => {
    expect(tangentAngleDeg(horiz, 0.5)).toBeCloseTo(0, 6);
    expect(tangentAngleDeg(vert, 0.5)).toBeCloseTo(90, 6);
  });
  it('uses a one-sided difference at the endpoints (still 0 on a straight path)', () => {
    expect(tangentAngleDeg(horiz, 0)).toBeCloseTo(0, 6);
    expect(tangentAngleDeg(horiz, 1)).toBeCloseTo(0, 6);
  });
  it('degenerate path -> 0', () => {
    expect(tangentAngleDeg({ nodes: [], closed: false }, 0.5)).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/engine/motion.test.ts`
Expected: FAIL — `./motion` does not exist.

- [ ] **Step 3: Create `motion.ts`**

Create `src/engine/motion.ts`:

```ts
import { flattenPath, pointAtLength, type Flattened } from './geom/arcLength';
import type { PathData, PathPoint } from './types';

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

// Point on the guide at a normalized [0,1] arc-length fraction. Degenerate guards
// mirror resample: empty -> origin, zero-length -> the start point.
export function pointAtFraction(path: PathData, frac: number): PathPoint {
  const flat = flattenPath(path);
  return pointFromFlat(flat, frac);
}

function pointFromFlat(flat: Flattened, frac: number): PathPoint {
  if (flat.pts.length === 0) return { x: 0, y: 0 };
  if (flat.total === 0) return { x: flat.pts[0].x, y: flat.pts[0].y };
  return pointAtLength(flat, clamp01(frac) * flat.total);
}

// Tangent direction (degrees, atan2) at a normalized fraction, via a small central
// finite difference in arc-length space; one-sided at the ends. Degenerate -> 0.
export function tangentAngleDeg(path: PathData, frac: number): number {
  const flat = flattenPath(path);
  if (flat.pts.length < 2 || flat.total === 0) return 0;
  const f = clamp01(frac);
  const eps = 1e-3; // fraction of the curve used as the finite-difference step
  const lo = Math.max(0, f - eps);
  const hi = Math.min(1, f + eps);
  const a = pointFromFlat(flat, lo);
  const b = pointFromFlat(flat, hi);
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}
```

- [ ] **Step 4: Re-export from the barrel**

In `src/engine/index.ts`, add:

```ts
export * from './motion';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/engine/motion.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/engine/motion.ts src/engine/motion.test.ts src/engine/index.ts
git commit -m "feat(motion): pointAtFraction + tangentAngleDeg over the shared arc-length core"
```

---

## Task A3: `MotionPath` type + `sampleObject` override

**Files:**
- Modify: `src/engine/types.ts` (`MotionPath`, `SceneObject.motionPath?`)
- Modify: `src/engine/sample.ts` (`sampleObject` override)
- Test: `src/engine/sample.test.ts`

**Interfaces:**
- Consumes: `pointAtFraction`, `tangentAngleDeg` (A2); `interpolate` (existing).
- Produces: `interface MotionPath { path: PathData; orient: boolean; progress: Keyframe[] }`
- Produces: `SceneObject.motionPath?: MotionPath`

- [ ] **Step 1: Write the failing test**

Add to `src/engine/sample.test.ts` (it imports `createKeyframe, createProject, createSceneObject` from `./project`):

```ts
import { pointAtFraction, tangentAngleDeg } from './motion';
import type { MotionPath } from './types';

describe('sampleObject motion path', () => {
  const guide = { nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }], closed: false };
  const progress = [createKeyframe(0, 0), createKeyframe(2, 1)];

  it('overrides x/y from the followed point and ignores the x/y tracks', () => {
    const obj = createSceneObject('a', {
      tracks: { x: [createKeyframe(0, 999)] }, // must be ignored
      motionPath: { path: guide, orient: false, progress } as MotionPath,
    });
    const s = sampleObject(obj, 1); // frac 0.5 -> x 50
    expect(s.x).toBe(50);
    expect(s.y).toBe(0);
    expect(s.x).toBe(pointAtFraction(guide, 0.5).x);
  });

  it('orients rotation to the tangent plus base.rotation when orient is true', () => {
    const vert = { nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 0, y: 100 } }], closed: false };
    const obj = createSceneObject('a', {
      base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 10, opacity: 1 },
      motionPath: { path: vert, orient: true, progress } as MotionPath,
    });
    const s = sampleObject(obj, 1);
    expect(s.rotation).toBeCloseTo(tangentAngleDeg(vert, 0.5) + 10, 4); // 90 + 10
  });

  it('does nothing when the progress track is empty', () => {
    const obj = createSceneObject('a', {
      base: { x: 7, y: 8, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
      motionPath: { path: guide, orient: true, progress: [] } as MotionPath,
    });
    const s = sampleObject(obj, 1);
    expect(s.x).toBe(7);
    expect(s.y).toBe(8);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/engine/sample.test.ts`
Expected: FAIL — `motionPath` is not a field / no override applied.

- [ ] **Step 3: Add the types**

In `src/engine/types.ts`, after the `ShapeKeyframe` interface (and before `VectorStyle`), add:

```ts
/**
 * A motion path: the object follows `path` over the timeline, paced by `progress`
 * (a normalized 0..1 arc-length position with per-keyframe easing). Guide coordinates
 * are stage-space (same as base.x/base.y). `orient` rotates the object to the path
 * tangent. Optional on SceneObject; absent or empty `progress` = no follow.
 */
export interface MotionPath {
  path: PathData;
  orient: boolean;
  progress: Keyframe[];
}
```

In `interface SceneObject`, after `colorTracks?`:

```ts
  /** When present with a non-empty progress track, the object follows this guide:
   *  x/y come from the path (overriding the x/y tracks), rotation from the tangent
   *  when orient is true. Absent -> ordinary transform. */
  motionPath?: MotionPath;
```

- [ ] **Step 4: Add the override to `sampleObject`**

In `src/engine/sample.ts`, add the import:

```ts
import { pointAtFraction, tangentAngleDeg } from './motion';
```

In `sampleObject`, immediately before `return state;`, add the override (after the color block):

```ts
  const mp = obj.motionPath;
  if (mp && mp.progress.length > 0) {
    const frac = interpolate(mp.progress, time);
    const p = pointAtFraction(mp.path, frac);
    state.x = p.x;
    state.y = p.y;
    if (mp.orient) {
      state.rotation = tangentAngleDeg(mp.path, frac) + obj.base.rotation;
    }
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/engine/sample.test.ts && pnpm typecheck`
Expected: PASS — existing `sampleObject` tests unchanged (no `motionPath` ⇒ no override).

- [ ] **Step 6: Commit**

```bash
git add src/engine/types.ts src/engine/sample.ts src/engine/sample.test.ts
git commit -m "feat(motion): MotionPath type + sampleObject follows the guide (x/y, orient rotation)"
```

---

## Task A4: `computeProjectDuration` includes the progress track

**Files:**
- Modify: `src/engine/duration.ts`
- Test: `src/engine/duration.test.ts`

**Interfaces:**
- Consumes: `SceneObject.motionPath` (A3).

- [ ] **Step 1: Write the failing test**

Add to `src/engine/duration.test.ts`:

```ts
it('extends the duration to a motion-path progress keyframe past the prior end', () => {
  const obj = createSceneObject('a', {
    motionPath: {
      path: { nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 1, y: 0 } }], closed: false },
      orient: false,
      progress: [createKeyframe(0, 0), createKeyframe(6, 1)],
    },
  });
  const project = { ...createProject(), objects: [obj] };
  expect(computeProjectDuration(project)).toBe(6);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/engine/duration.test.ts`
Expected: FAIL — duration ignores `motionPath.progress` (returns 0).

- [ ] **Step 3: Fold the progress track into the max**

In `src/engine/duration.ts`, inside the `for (const obj of project.objects)` loop, after the `colorTracks` loop:

```ts
    for (const keyframe of obj.motionPath?.progress ?? []) {
      if (keyframe.time > max) max = keyframe.time;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/engine/duration.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/duration.ts src/engine/duration.test.ts
git commit -m "feat(motion): computeProjectDuration folds in motionPath progress keyframe times"
```

---

## Task A5: Frame parity + regenerate runtime bundle

**Files:**
- Test: `src/runtime/frame.test.ts`
- Modify (generated): `src/runtime/runtimeSource.generated.ts` (via build script)

**Interfaces:**
- Consumes: `sampleObject` motion override (A3); `computeFrame` (existing, unchanged).

**Note:** `computeFrame` already derives the wrapper `transform` from `state.x/y/rotation`, so a motion-following object needs NO new `FrameItem` field. The parity proof is that a following object's frame transform equals that of a static object placed at the followed point.

- [ ] **Step 1: Write the failing parity test**

Add to `src/runtime/frame.test.ts` (reuse its existing `createProject`/`createSceneObject`/`createVectorAsset` imports — match the file's construction style):

```ts
describe('computeFrame motion path', () => {
  it('transform equals a static object placed at the followed point (parity)', () => {
    const guide = { nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }], closed: false };
    const progress = [
      { time: 0, value: 0, easing: 'linear' as const },
      { time: 2, value: 1, easing: 'linear' as const },
    ];
    const follower = createSceneObject('a', {
      id: 'follower',
      motionPath: { path: guide, orient: false, progress },
    });
    // at t=1 the follower is at x=50 -> same transform as a static object at base.x=50
    const staticAt50 = createSceneObject('a', {
      id: 'static',
      base: { x: 50, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    });
    const fFrame = computeFrame({ ...createProject(), objects: [follower] }, 1)[0];
    const sFrame = computeFrame({ ...createProject(), objects: [staticAt50] }, 1)[0];
    expect(fFrame.transform).toBe(sFrame.transform);
  });
});
```

- [ ] **Step 2: Run test to verify it passes against the live engine**

Run: `pnpm vitest run src/runtime/frame.test.ts`
Expected: PASS — `computeFrame` uses the live engine, so the motion override already flows into the transform. (The bundle regen in Step 3 is what makes the *exported* runtime honor it; the Plan B e2e verifies export.)

- [ ] **Step 3: Regenerate the runtime bundle (so EXPORT honors motion paths)**

Run: `pnpm build:runtime`
Expected: `src/runtime/runtimeSource.generated.ts` updated (git shows a diff); it now contains the motion resolution.

Verify: `grep -c "pointAtFraction" src/runtime/runtimeSource.generated.ts` returns ≥ 1.

- [ ] **Step 4: Full suite + build gates**

Run: `pnpm vitest run && pnpm typecheck && pnpm lint && pnpm build`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/frame.test.ts src/runtime/runtimeSource.generated.ts
git commit -m "test(motion): frame transform parity for a path-following object; regenerate runtime bundle"
```

---

## Plan A — Self-review checklist

- Engine pure (no React/DOM under `src/engine/`)? ✓
- No `CURRENT_VERSION` bump (stays 4)? ✓ additive optional field.
- Arc-length extraction byte-identical? ✓ A1 keeps `resample.test.ts` green as the guard.
- Override gated on non-empty progress; ignores x/y tracks; orient adds base.rotation? ✓ A3 tests (incl. empty-progress no-op).
- Scale/opacity/geometry/color untouched by motion? ✓ A3 only writes x/y/rotation.
- Duration extends to a progress keyframe? ✓ A4.
- Runtime bundle regenerated + frame parity asserted? ✓ A5 (no new FrameItem field needed).
