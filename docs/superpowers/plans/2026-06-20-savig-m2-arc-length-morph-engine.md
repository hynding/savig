# Arc-Length Morph — Plan A (Engine & Pipeline) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add arc-length cross-shape morphing to the engine: a pluggable `reconcile` seam in `samplePath` with the existing index-pad extracted as `corresponded` (byte-identical) and a new `resampled` strategy (flatten → arc-length sample → rotation/winding alignment), opt-in via an optional `morph?` field on `ShapeKeyframe`.

**Architecture:** Three small pure engine files under `engine/morph/` (`resample.ts`, `align.ts`, `reconcile.ts`); `samplePath` calls `reconcile` where it currently calls `padNodes` (which moves into `reconcile.ts`). No UI in this plan. Because resampling is internal to `samplePath`, the runtime bundle picks it up via regeneration and the export path needs no new code.

**Tech Stack:** TypeScript (strict), Vitest. Pure engine — zero React/DOM. esbuild runtime bundle.

## Global Constraints

- Engine stays **pure TS, no React/DOM imports** (`engine/morph/*` import only from `../types`/sibling morph files).
- TDD: failing test first, watch it fail, minimal implementation, watch it pass, commit.
- `corresponded` (index-pad) output must be **byte-identical** to today's `padNodes` behavior — the Slice-3 parity tests and morph e2e guard it.
- `SAMPLE_COUNT = 64` is a **global** module constant (continuity at interior keyframes); `FLATTEN_STEPS = 16`.
- Flatten uses the **same L/C classification as `pathToD`'s `segment()`**: cubic iff `prev.out || cur.in`; cubic control points `C1 = prev.anchor + prev.out`, `C2 = cur.anchor + cur.in` (absent handle = zero offset).
- Alignment minimizes **total squared distance**; ties broken by **lowest offset, forward winding** (deterministic, so Stage == runtime).
- Open paths sample at fractions `i/(N-1)` (endpoints exact); closed at `i/N` (index 0 at arc-length 0, no duplicate close point).
- **No persistence version bump** — `morph?` is additive/optional; old projects load unchanged.
- Strict TS: no `any`; all exported functions fully typed.
- Mode lives on the **from**-keyframe: a transition `a → b` is resampled iff `a.morph === 'resampled'`.

---

### Task 1: `resample(path, N)` — arc-length sampling

**Files:**
- Create: `src/engine/morph/resample.ts`
- Test: `src/engine/morph/resample.test.ts`

**Interfaces:**
- Consumes: `PathData`, `PathNode`, `PathPoint` from `../types`.
- Produces:
  - `SAMPLE_COUNT: number` (= 64), `FLATTEN_STEPS: number` (= 16)
  - `resample(path: PathData, n?: number): PathNode[]` — `n` corner nodes (anchor only), default `SAMPLE_COUNT`.

- [ ] **Step 1: Write the failing test**

```ts
// src/engine/morph/resample.test.ts
import { describe, it, expect } from 'vitest';
import { resample, SAMPLE_COUNT } from './resample';
import type { PathData } from '../types';

const line: PathData = { nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 9, y: 0 } }], closed: false };
const square: PathData = {
  nodes: [
    { anchor: { x: 0, y: 0 } },
    { anchor: { x: 10, y: 0 } },
    { anchor: { x: 10, y: 10 } },
    { anchor: { x: 0, y: 10 } },
  ],
  closed: true,
};

describe('resample', () => {
  it('returns SAMPLE_COUNT corner nodes by default', () => {
    const out = resample(square);
    expect(out).toHaveLength(SAMPLE_COUNT);
    expect(out[0].in).toBeUndefined();
    expect(out[0].out).toBeUndefined();
  });

  it('samples an open path evenly by arc length, endpoints exact', () => {
    const out = resample(line, 4); // fractions 0, 1/3, 2/3, 1 of length 9
    expect(out.map((nd) => nd.anchor.x)).toEqual([0, 3, 6, 9]);
    expect(out[0].anchor.y).toBe(0);
  });

  it('samples a closed path at i/N (no duplicate close point)', () => {
    const out = resample(square, 4); // perimeter 40, fractions 0,1/4,1/2,3/4 -> lengths 0,10,20,30
    expect(out.map((nd) => [nd.anchor.x, nd.anchor.y])).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
  });

  it('guards a zero-length / coincident path (no divide-by-zero)', () => {
    const dot: PathData = { nodes: [{ anchor: { x: 5, y: 5 } }, { anchor: { x: 5, y: 5 } }], closed: false };
    const out = resample(dot, 3);
    expect(out).toEqual([
      { anchor: { x: 5, y: 5 } },
      { anchor: { x: 5, y: 5 } },
      { anchor: { x: 5, y: 5 } },
    ]);
  });

  it('does not mutate the input path', () => {
    const before = JSON.stringify(square);
    resample(square);
    expect(JSON.stringify(square)).toBe(before);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/engine/morph/resample.test.ts`
Expected: FAIL — cannot resolve `./resample`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/engine/morph/resample.ts
import type { PathData, PathNode, PathPoint } from '../types';

export const SAMPLE_COUNT = 64;
export const FLATTEN_STEPS = 16;

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
function flatten(path: PathData): PathPoint[] {
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

function pointAtLength(flat: PathPoint[], cum: number[], target: number): PathPoint {
  const total = cum[cum.length - 1];
  if (target <= 0) return { x: flat[0].x, y: flat[0].y };
  if (target >= total) return { x: flat[flat.length - 1].x, y: flat[flat.length - 1].y };
  let j = 1;
  while (j < cum.length && cum[j] < target) j++;
  const segLen = cum[j] - cum[j - 1];
  const t = segLen === 0 ? 0 : (target - cum[j - 1]) / segLen;
  return lerpPoint(flat[j - 1], flat[j], t);
}

// Resample to `n` points evenly spaced by arc length, lying on the rendered curve.
export function resample(path: PathData, n: number = SAMPLE_COUNT): PathNode[] {
  const flat = flatten(path);
  if (flat.length === 0) {
    return Array.from({ length: n }, () => ({ anchor: { x: 0, y: 0 } }));
  }
  const cum: number[] = [0];
  for (let i = 1; i < flat.length; i++) cum.push(cum[i - 1] + dist(flat[i - 1], flat[i]));
  const total = cum[cum.length - 1];
  if (total === 0) {
    return Array.from({ length: n }, () => ({ anchor: { x: flat[0].x, y: flat[0].y } }));
  }
  const out: PathNode[] = [];
  for (let i = 0; i < n; i++) {
    const frac = path.closed ? i / n : i / (n - 1);
    out.push({ anchor: pointAtLength(flat, cum, frac * total) });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/engine/morph/resample.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/morph/resample.ts src/engine/morph/resample.test.ts
git commit -m "feat(morph): arc-length resample (flatten + even sampling)"
```

---

### Task 2: `align(b, a, closed)` — rotation/winding match

**Files:**
- Create: `src/engine/morph/align.ts`
- Test: `src/engine/morph/align.test.ts`

**Interfaces:**
- Consumes: `PathNode`, `PathPoint` from `../types`.
- Produces: `align(b: PathNode[], a: PathNode[], closed: boolean): PathNode[]` — `b` reordered (rotation + winding) to minimize Σ squared distance to `a`; ties → lowest offset, forward winding. `a` is never reordered.

- [ ] **Step 1: Write the failing test**

```ts
// src/engine/morph/align.test.ts
import { describe, it, expect } from 'vitest';
import { align } from './align';
import type { PathNode } from '../types';

const nodes = (pts: Array<[number, number]>): PathNode[] => pts.map(([x, y]) => ({ anchor: { x, y } }));

describe('align', () => {
  it('recovers a cyclic rotation of a closed shape (zero cost)', () => {
    const a = nodes([[0, 0], [10, 0], [10, 10], [0, 10]]);
    const b = nodes([[10, 10], [0, 10], [0, 0], [10, 0]]); // a rotated by +2
    expect(align(b, a, true)).toEqual(a);
  });

  it('recovers a reversed-winding closed shape', () => {
    const a = nodes([[0, 0], [10, 0], [10, 10], [0, 10]]);
    const b = nodes([[0, 0], [0, 10], [10, 10], [10, 0]]); // a reversed
    expect(align(b, a, true)).toEqual(a);
  });

  it('picks the cheaper winding for an open path', () => {
    const a = nodes([[0, 0], [5, 0], [10, 0]]);
    const b = nodes([[10, 0], [5, 0], [0, 0]]); // reversed -> matches a
    expect(align(b, a, false)).toEqual(a);
  });

  it('breaks ties toward the forward, offset-0 ordering', () => {
    const a = nodes([[0, 0], [1, 1], [2, 2], [3, 3]]);
    const b = a.map((nd) => ({ anchor: { ...nd.anchor } }));
    expect(align(b, a, true)).toEqual(a); // all offsets cost 0 -> keep forward offset 0
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/engine/morph/align.test.ts`
Expected: FAIL — cannot resolve `./align`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/engine/morph/align.ts
import type { PathNode, PathPoint } from '../types';

function sqDist(a: PathPoint, b: PathPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx * dx + dy * dy;
}

function cost(a: PathNode[], b: PathNode[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += sqDist(a[i].anchor, b[i].anchor);
  return s;
}

function rotate(nodes: PathNode[], k: number): PathNode[] {
  if (k === 0) return nodes;
  return nodes.slice(k).concat(nodes.slice(0, k));
}

// Reorder `b` (rotation + winding) to best match `a` (same length). Closed: all cyclic
// offsets in both windings. Open: forward vs reversed only. Ties: lowest offset,
// forward winding (strict `<` keeps the first-seen, which is forward offset 0).
export function align(b: PathNode[], a: PathNode[], closed: boolean): PathNode[] {
  const n = b.length;
  if (n === 0) return b;
  const reversed = b.slice().reverse();
  let best = b;
  let bestCost = cost(a, b);
  const consider = (cand: PathNode[]) => {
    const c = cost(a, cand);
    if (c < bestCost) {
      bestCost = c;
      best = cand;
    }
  };
  if (closed) {
    for (let k = 0; k < n; k++) {
      consider(rotate(b, k));
      consider(rotate(reversed, k));
    }
  } else {
    consider(reversed);
  }
  return best;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/engine/morph/align.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/morph/align.ts src/engine/morph/align.test.ts
git commit -m "feat(morph): rotation/winding alignment (min squared distance)"
```

---

### Task 3: `reconcile(a, b, mode)` + `MorphMode` data field

**Files:**
- Modify: `src/engine/types.ts` (add `MorphMode`; add `morph?` to `ShapeKeyframe` at types.ts:124-128)
- Create: `src/engine/morph/reconcile.ts`
- Test: `src/engine/morph/reconcile.test.ts`

**Interfaces:**
- Consumes: `resample`, `SAMPLE_COUNT` (Task 1); `align` (Task 2); `PathData`, `PathNode` from `../types`.
- Produces:
  - `type MorphMode = 'corresponded' | 'resampled'` (in `types.ts`); `ShapeKeyframe.morph?: MorphMode`.
  - `interface Reconciled { an: PathNode[]; bn: PathNode[] }`
  - `reconcile(a: PathData, b: PathData, mode: MorphMode): Reconciled` — equal-length matched node arrays.

- [ ] **Step 1: Write the failing test**

```ts
// src/engine/morph/reconcile.test.ts
import { describe, it, expect } from 'vitest';
import { reconcile } from './reconcile';
import { SAMPLE_COUNT } from './resample';
import type { PathData } from '../types';

const a: PathData = { nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 10, y: 10 } }], closed: false };
const b: PathData = { nodes: [{ anchor: { x: 0, y: 0 } }], closed: false };

describe('reconcile', () => {
  it('corresponded index-pads the shorter to the longer (byte-identical to padNodes)', () => {
    const { an, bn } = reconcile(a, b, 'corresponded');
    expect(an).toHaveLength(3);
    expect(bn).toHaveLength(3);
    // b padded with degenerate corner nodes at its last anchor (0,0)
    expect(bn).toEqual([
      { anchor: { x: 0, y: 0 } },
      { anchor: { x: 0, y: 0 } },
      { anchor: { x: 0, y: 0 } },
    ]);
    expect(an).toBe(a.nodes); // already long enough -> same reference (as old padNodes)
  });

  it('resampled returns SAMPLE_COUNT corner nodes on both sides', () => {
    const { an, bn } = reconcile(a, b, 'resampled');
    expect(an).toHaveLength(SAMPLE_COUNT);
    expect(bn).toHaveLength(SAMPLE_COUNT);
    expect(an[0].in).toBeUndefined();
    expect(bn[0].out).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/engine/morph/reconcile.test.ts`
Expected: FAIL — cannot resolve `./reconcile`.

- [ ] **Step 3: Write minimal implementation**

In `src/engine/types.ts`, add the type and field (replace the `ShapeKeyframe` interface at types.ts:124-128):

```ts
export type MorphMode = 'corresponded' | 'resampled';

export interface ShapeKeyframe {
  time: number;
  path: PathData;
  easing: Easing;
  /** Reconciliation for the transition INTO the next keyframe. Absent = 'corresponded'
   *  (index-pad, today's behavior). 'resampled' = arc-length cross-shape morph. */
  morph?: MorphMode;
}
```

Create `src/engine/morph/reconcile.ts`:

```ts
import type { MorphMode, PathData, PathNode } from '../types';
import { resample, SAMPLE_COUNT } from './resample';
import { align } from './align';

export interface Reconciled {
  an: PathNode[];
  bn: PathNode[];
}

// Index-pad: lengthen `nodes` to `len` by repeating a degenerate corner node at the
// last anchor, so extra nodes morph as growing out of / retracting into a point.
// (Moved verbatim from path.ts so `corresponded` is byte-identical to Slice 3.)
function padNodes(nodes: PathNode[], len: number): PathNode[] {
  if (nodes.length >= len) return nodes;
  const last = nodes[nodes.length - 1];
  const padded = nodes.slice();
  while (padded.length < len) padded.push({ anchor: { x: last.anchor.x, y: last.anchor.y } });
  return padded;
}

// Produce equal-length matched node arrays for two bracketing shapes. The single
// reconciliation seam: index-pad (corresponded, default) or arc-length resample.
export function reconcile(a: PathData, b: PathData, mode: MorphMode): Reconciled {
  if (mode === 'resampled') {
    const an = resample(a, SAMPLE_COUNT);
    const bn = align(resample(b, SAMPLE_COUNT), an, a.closed);
    return { an, bn };
  }
  const len = Math.max(a.nodes.length, b.nodes.length);
  return { an: padNodes(a.nodes, len), bn: padNodes(b.nodes, len) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/engine/morph/reconcile.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/types.ts src/engine/morph/reconcile.ts src/engine/morph/reconcile.test.ts
git commit -m "feat(morph): reconcile seam (corresponded | resampled) + morph field"
```

---

### Task 4: Integrate `reconcile` into `samplePath` + barrel exports

**Files:**
- Modify: `src/engine/path.ts` (samplePath at path.ts:92-121; remove the local `padNodes` at path.ts:80-86)
- Modify: `src/engine/index.ts` (barrel: export the morph modules)
- Test: `src/engine/path.test.ts` (append a `samplePath resampled` block)

**Interfaces:**
- Consumes: `reconcile` (Task 3); reads `ShapeKeyframe.morph` (Task 3).
- Produces: `samplePath` unchanged signature, now resampling when the from-keyframe is `'resampled'`. Engine barrel re-exports `resample`, `align`, `reconcile`, `SAMPLE_COUNT`, `FLATTEN_STEPS`, `Reconciled`.

- [ ] **Step 1: Write the failing test**

```ts
// append to src/engine/path.test.ts
describe('samplePath resampled', () => {
  const a: PathData = { nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 10, y: 10 } }], closed: true, };
  const b: PathData = { nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 20, y: 0 } }], closed: true };

  it('produces a fixed-resolution point set between resampled keyframes', () => {
    const track: ShapeKeyframe[] = [
      { time: 0, path: a, easing: 'linear', morph: 'resampled' },
      { time: 1, path: b, easing: 'linear' },
    ];
    expect(samplePath(track, 0.5).nodes.length).toBe(64);
  });

  it('clamp returns the real (un-resampled) path at the endpoints', () => {
    const track: ShapeKeyframe[] = [
      { time: 0, path: a, easing: 'linear', morph: 'resampled' },
      { time: 1, path: b, easing: 'linear' },
    ];
    expect(samplePath(track, 0).nodes.length).toBe(a.nodes.length); // clamp -> first.path
    expect(samplePath(track, 1).nodes.length).toBe(b.nodes.length); // clamp -> last.path
  });

  it('without morph:resampled, behaves exactly as before (index-pad)', () => {
    const track: ShapeKeyframe[] = [
      { time: 0, path: a, easing: 'linear' },
      { time: 1, path: b, easing: 'linear' },
    ];
    expect(samplePath(track, 0.5).nodes.length).toBe(Math.max(a.nodes.length, b.nodes.length));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/engine/path.test.ts -t "samplePath resampled"`
Expected: FAIL — the resampled case returns 3 (index-pad), not 64.

- [ ] **Step 3: Write minimal implementation**

In `src/engine/path.ts`: delete the local `padNodes` function (path.ts:79-86), add the import, and replace the tail of `samplePath`.

Add near the top imports:
```ts
import { reconcile } from './morph/reconcile';
```

Replace the `samplePath` body from `const len = Math.max(...)` through the `return` with:
```ts
  const { an, bn } = reconcile(a.path, b.path, a.morph ?? 'corresponded');
  const nodes: PathNode[] = [];
  for (let i = 0; i < an.length; i++) nodes.push(lerpNode(an[i], bn[i], t));
  return { nodes, closed: a.path.closed };
```

In `src/engine/index.ts`, add after `export * from './path';`:
```ts
export * from './morph/resample';
export * from './morph/align';
export * from './morph/reconcile';
```

- [ ] **Step 4: Run the resampled test, then the FULL engine suite (corresponded byte-identical guard)**

Run: `pnpm vitest run src/engine/path.test.ts`
Expected: PASS — the new `samplePath resampled` block AND every pre-existing `samplePath` test (the index-pad cases are unchanged, proving `corresponded` is byte-identical).

Run: `pnpm vitest run src/engine`
Expected: PASS — whole engine suite green.

- [ ] **Step 5: Commit**

```bash
git add src/engine/path.ts src/engine/index.ts src/engine/path.test.ts
git commit -m "feat(morph): samplePath uses the reconcile seam (resampled opt-in)"
```

---

### Task 5: Runtime parity + bundle regeneration

**Files:**
- Test: `src/runtime/frame.test.ts` (append a resampled parity case near the existing pathD tests at frame.test.ts:122-131)
- Modify (generated): `src/runtime/runtimeSource.generated.ts` (regenerated, committed)

**Interfaces:**
- Consumes: `samplePath`, `pathToD` (engine), `computeFrame` (runtime). No new exports.

- [ ] **Step 1: Write the failing test**

```ts
// append within src/runtime/frame.test.ts (same imports already include computeFrame, samplePath, pathToD)
describe('computeFrame resampled morph parity', () => {
  it('pathD for a resampled morph equals pathToD(samplePath(track, t))', () => {
    const project = morphProjectResampled(); // helper below
    const t = 0.5;
    const item = computeFrame(project, t).find((i) => i.pathD)!;
    const track = project.objects[0].shapeTrack!;
    expect(item.pathD).toBe(pathToD(samplePath(track, t)));
  });
});

function morphProjectResampled() {
  const base = morphProject(); // reuse the existing helper that builds a morphed-path project
  base.objects[0].shapeTrack = [
    { time: 0, path: { nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 10, y: 10 } }], closed: true }, easing: 'linear', morph: 'resampled' },
    { time: 1, path: { nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 20, y: 0 } }], closed: true }, easing: 'linear' },
  ];
  return base;
}
```

> If `frame.test.ts` has no reusable `morphProject()` helper, inline a minimal project in `morphProjectResampled` instead: one vector path object with the `shapeTrack` above, mirroring the setup the existing `emits pathD ...` test (frame.test.ts:122) already uses. Match that test's existing project-construction style exactly.

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `pnpm vitest run src/runtime/frame.test.ts -t "resampled morph parity"`
Expected: PASS once Tasks 1-4 are in (parity holds by construction — `computeFrame` already routes through `samplePath`/`pathToD`). If it fails, the failure is a real parity bug to fix, not a stub.

- [ ] **Step 3: Regenerate the runtime bundle**

The committed runtime bundle inlines the engine render core (which now includes the morph seam). Regenerate it:

Run: `pnpm build:runtime`
Expected: prints `Wrote runtimeSource.generated.ts (<N> bytes of runtime).`; `git status` shows `src/runtime/runtimeSource.generated.ts` modified (it now contains the resample/align/reconcile code).

- [ ] **Step 4: Verify runtime suite + typecheck**

Run: `pnpm vitest run src/runtime && pnpm typecheck`
Expected: PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/frame.test.ts src/runtime/runtimeSource.generated.ts
git commit -m "test(morph): runtime parity for resampled morph; regenerate bundle"
```

---

### Task 6: Persistence round-trip for `morph`

**Files:**
- Test: `src/services/persistence/savig.test.ts` (append one case)

**Interfaces:**
- Consumes: `saveSavig`, `loadSavig` (already imported in the test); `morph?` field (Task 3).

- [ ] **Step 1: Write the failing test**

```ts
// append inside the `describe('savig persistence', ...)` block in src/services/persistence/savig.test.ts
it('preserves a shape keyframe morph mode across save/load', () => {
  const f = file();
  f.project.objects.push({
    id: 'o1',
    name: 'morpher',
    assetId: 'b0b0b0b0',
    zOrder: 0,
    anchorX: 0,
    anchorY: 0,
    base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    tracks: {},
    shapeTrack: [
      { time: 0, path: { nodes: [{ anchor: { x: 0, y: 0 } }], closed: true }, easing: 'linear', morph: 'resampled' },
      { time: 1, path: { nodes: [{ anchor: { x: 5, y: 5 } }], closed: true }, easing: 'linear' },
    ],
  });
  const loaded = loadSavig(saveSavig(f));
  expect(loaded.project.objects[0].shapeTrack![0].morph).toBe('resampled');
  expect(loaded.project.objects[0].shapeTrack![1].morph).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm vitest run src/services/persistence/savig.test.ts -t "morph mode"`
Expected: PASS — `morph` is plain JSON data and survives the zip round-trip (no version bump needed). If it FAILS, the loader is stripping unknown fields and that must be fixed (it should not be).

- [ ] **Step 3: Full suite + lint + typecheck**

Run: `pnpm vitest run && pnpm lint && pnpm typecheck`
Expected: all green; lint exit 0; no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/services/persistence/savig.test.ts
git commit -m "test(persistence): morph mode survives savig round-trip (no version bump)"
```

---

## Self-Review

**Spec coverage:**
- §3.1 reconcile seam (corresponded byte-identical + resampled) → Tasks 3, 4. ✓
- §3.2 resample (flatten same as pathToD segment(), arc-length, open/closed fractions, degenerate guard) → Task 1. ✓
- §3.3 align (closed rotation+winding, open winding, tie-break lowest-offset/forward) → Task 2. ✓
- §3.4 global N continuity → `SAMPLE_COUNT` constant used everywhere (Tasks 1, 3). ✓
- §3.5 pipeline / bundle regen → Task 5. ✓
- §2 data model (`MorphMode`, `morph?` on from-keyframe) → Task 3; read in `samplePath` Task 4. ✓
- §4 parity (Stage == export == runtime) → Task 5 (computeFrame routes through samplePath/pathToD). ✓
- §6 persistence no version bump, round-trip → Task 6. ✓
- §9 test strategy (resample/align/reconcile/samplePath/parity/persistence) → Tasks 1-6. ✓
- UI (§5) is **Plan B**, intentionally not here. ✓

**Placeholder scan:** No TBD/TODO; every code step is complete. The one conditional note in Task 5 Step 1 (reuse vs inline the `morphProject` helper) gives the exact fallback construction, not a vague "set up a project."

**Type consistency:** `MorphMode`/`Reconciled`/`reconcile`/`resample`/`align`/`SAMPLE_COUNT`/`FLATTEN_STEPS` are declared in Tasks 1-3's Produces blocks and consumed with identical names/signatures in Tasks 4-6. `samplePath` keeps its signature; `a.morph ?? 'corresponded'` matches the optional field. `padNodes` is removed from `path.ts` (Task 4) and reborn inside `reconcile.ts` (Task 3) — no duplicate definition remains.
