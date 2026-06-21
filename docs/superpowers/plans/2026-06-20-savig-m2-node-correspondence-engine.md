# Node-Correspondence Editor — Plan A (Engine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an explicit per-transition node map (`correspondence?: number[]`) honored by the morph engine, and add a pure `suggestCorrespondence` (cut-point rotation) plus `shift`/`reverse` map helpers — all while keeping today's index-pad morph byte-identical when no map is present.

**Architecture:** Extends the existing reconcile seam (`src/engine/morph/reconcile.ts`). `samplePath` threads the from-keyframe's `correspondence` into `reconcile`, which gains a **walk-B** explicit-map branch (iterate B's nodes in ring order, gather the A nodes feeding each) so the destination endpoint traces B exactly by construction. `suggestCorrespondence` re-expresses `align()`'s rotation×winding search as an index map via an extracted `bestAlignment` helper. Pure TS, zero React/DOM; the runtime bundle is regenerated.

**Tech Stack:** TypeScript (strict), Vitest. Pure engine under `src/engine/`. Runtime bundle via `node scripts/build-runtime.mjs` (`pnpm build:runtime`).

## Global Constraints

- **Engine stays pure** — no React/DOM imports under `src/engine/`. The render core lifts verbatim into the export runtime.
- **Optional field only** → persistence is a **no-op version bump**; do NOT bump `CURRENT_VERSION`. Default-absent reproduces today's index-pad morph exactly.
- **Preview == export parity** through the shared pure `reconcile`/`samplePath` → `pathToD`. Regenerate the runtime bundle whenever engine morph code changes.
- **`correspondence` is honored only in `corresponded` mode** (`a.morph ?? 'corresponded'`); ignored under `resampled`.
- **Deterministic ties** (lowest offset, forward winding) preserved from `align()` for Stage==runtime parity.
- **TDD**: failing test → minimal impl → green → commit. `-0` vs `+0`: use `0 - x`, never `-x` (Vitest `toEqual` distinguishes them).
- Run unit tests with `pnpm vitest run <path>`; typecheck with `pnpm typecheck`.

---

## File Structure

- `src/engine/types.ts` — add `correspondence?: number[]` to `ShapeKeyframe` (MODIFY).
- `src/engine/morph/reconcile.ts` — new `correspondence?` param + walk-B explicit-map branch (MODIFY).
- `src/engine/path.ts` — `samplePath` passes `a.correspondence` to `reconcile` (MODIFY).
- `src/engine/morph/align.ts` — extract `bestAlignment(b, a, closed): { offset, reversed }`; `align` becomes a thin wrapper (MODIFY, behavior-preserving).
- `src/engine/morph/suggest.ts` — NEW: `suggestCorrespondence`, `shiftCorrespondence`, `reverseCorrespondence`, `identityCorrespondence` (all pure).
- `src/engine/index.ts` — re-export the new `suggest.ts` symbols (MODIFY).
- Tests: `src/engine/morph/reconcile.test.ts`, `src/engine/morph/suggest.test.ts`, `src/runtime/frame.test.ts` (parity).

---

## Task A1: Thread `correspondence` through the seam (no-op when absent)

Add the field and the reconcile parameter, wire `samplePath`, and lock in that absent/identity maps are byte-identical to today's index-pad.

**Files:**
- Modify: `src/engine/types.ts` (ShapeKeyframe)
- Modify: `src/engine/morph/reconcile.ts` (signature)
- Modify: `src/engine/path.ts` (samplePath call)
- Test: `src/engine/morph/reconcile.test.ts`

**Interfaces:**
- Produces: `reconcile(a: PathData, b: PathData, mode: MorphMode, correspondence?: number[]): Reconciled`
- Produces: `ShapeKeyframe.correspondence?: number[]`

- [ ] **Step 1: Write the failing test**

Add to `src/engine/morph/reconcile.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { reconcile } from './reconcile';
import type { PathData } from '../types';

const corner = (x: number, y: number) => ({ anchor: { x, y } });
// A: 3-node open path; B: 5-node open path (counts differ).
const A: PathData = { nodes: [corner(0, 0), corner(10, 0), corner(10, 10)], closed: false };
const B: PathData = {
  nodes: [corner(0, 0), corner(5, 0), corner(10, 0), corner(10, 5), corner(10, 10)],
  closed: false,
};

describe('reconcile correspondence threading', () => {
  it('absent correspondence is byte-identical to index-pad (corresponded)', () => {
    const withParam = reconcile(A, B, 'corresponded', undefined);
    const without = reconcile(A, B, 'corresponded');
    expect(withParam).toEqual(without);
    // index-pad pads A to length 5; both arrays length 5.
    expect(withParam.an).toHaveLength(5);
    expect(withParam.bn).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/engine/morph/reconcile.test.ts`
Expected: FAIL — `reconcile` currently accepts 3 args; calling with a 4th is a type error (`pnpm typecheck`) / the test referencing the new param shape fails to compile.

- [ ] **Step 3: Add the field and the parameter (unused for now)**

In `src/engine/types.ts`, inside `interface ShapeKeyframe` (after `morph?: MorphMode;`):

```ts
  /** Explicit a-index → b-index node map for the transition INTO the next keyframe.
   *  Corresponded mode only; absent = identity (index-pad). Editor keeps it
   *  cyclic-order-preserving; engine guards only length/range. */
  correspondence?: number[];
```

In `src/engine/morph/reconcile.ts`, change the signature (leave the body unchanged for now):

```ts
export function reconcile(
  a: PathData,
  b: PathData,
  mode: MorphMode,
  correspondence?: number[],
): Reconciled {
  if (mode === 'resampled') {
    const an = resample(a, SAMPLE_COUNT);
    const bn = align(resample(b, SAMPLE_COUNT), an, a.closed);
    return { an, bn };
  }
  const len = Math.max(a.nodes.length, b.nodes.length);
  return { an: padNodes(a.nodes, len), bn: padNodes(b.nodes, len) };
}
```

In `src/engine/path.ts`, `samplePath`, pass the from-keyframe's map:

```ts
  const { an, bn } = reconcile(a.path, b.path, a.morph ?? 'corresponded', a.correspondence);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/engine/morph/reconcile.test.ts && pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/engine/types.ts src/engine/morph/reconcile.ts src/engine/path.ts src/engine/morph/reconcile.test.ts
git commit -m "feat(morph): thread correspondence through reconcile seam (no-op when absent)"
```

---

## Task A2: walk-B explicit-map reconcile branch

Honor a valid `correspondence` by iterating B in ring order; guarantee the destination endpoint, grow-from-point insertions, adjacent merges, and length/range fallback.

**Files:**
- Modify: `src/engine/morph/reconcile.ts`
- Test: `src/engine/morph/reconcile.test.ts`

**Interfaces:**
- Consumes: `reconcile(a, b, mode, correspondence?)` from Task A1.
- Produces: walk-B behavior (no signature change).

- [ ] **Step 1: Write the failing tests**

Add to `src/engine/morph/reconcile.test.ts` (these inline `lerp`/`at` helpers verify
endpoint geometry without importing from production code):

```ts
const lerp = (p: number, q: number, t: number) => p + (q - p) * t;
const at = (an: { anchor: { x: number; y: number } }[], bn: typeof an, t: number) =>
  an.map((n, i) => ({
    x: lerp(n.anchor.x, bn[i].anchor.x, t),
    y: lerp(n.anchor.y, bn[i].anchor.y, t),
  }));

describe('reconcile explicit map (walk-B)', () => {
  // Two equal-count closed triangles; B is A rotated by +1 in node order.
  const triA: PathData = { nodes: [corner(0, 0), corner(10, 0), corner(5, 10)], closed: true };
  const triB: PathData = { nodes: [corner(5, 10), corner(0, 0), corner(10, 0)], closed: true };

  it('identity map equals index-pad (byte-identical) for equal counts', () => {
    const mapped = reconcile(triA, triB, 'corresponded', [0, 1, 2]);
    const plain = reconcile(triA, triB, 'corresponded');
    expect(mapped).toEqual(plain);
  });

  it('rotation map: destination endpoint (t=1) traces B exactly', () => {
    // a[i] -> b[(i+? )]; map A's nodes onto the rotated B so the morph does not roll.
    const map = [1, 2, 0]; // a0->b1, a1->b2, a2->b0
    const { an, bn } = reconcile(triA, triB, 'corresponded', map);
    // t=1 must be B's nodes in B ring order.
    expect(at(an, bn, 1)).toEqual(triB.nodes.map((n) => n.anchor));
    // t=0 must be A's nodes in A ring order.
    expect(at(an, bn, 0)).toEqual(triA.nodes.map((n) => n.anchor));
  });

  it('unreferenced B node grows from a point (degenerate spur)', () => {
    // A 2 nodes, B 3 nodes, map a0->b0, a1->b1; b2 unreferenced.
    const a2: PathData = { nodes: [corner(0, 0), corner(10, 0)], closed: false };
    const b3: PathData = { nodes: [corner(0, 0), corner(10, 0), corner(20, 0)], closed: false };
    const { an, bn } = reconcile(a2, b3, 'corresponded', [0, 1]);
    expect(an).toHaveLength(3);
    expect(bn).toHaveLength(3);
    // b2 paired with degenerate A point = anchor of the most-recently-emitted A node (a1 @ 10,0).
    expect(bn[2].anchor).toEqual({ x: 20, y: 0 });
    expect(an[2].anchor).toEqual({ x: 10, y: 0 });
  });

  it('adjacent merge: two A nodes onto one B node', () => {
    const a2: PathData = { nodes: [corner(0, 0), corner(10, 0)], closed: false };
    const b1: PathData = { nodes: [corner(5, 5)], closed: false };
    const { an, bn } = reconcile(a2, b1, 'corresponded', [0, 0]);
    expect(an).toHaveLength(2);
    expect(bn).toHaveLength(2);
    expect(bn[0].anchor).toEqual({ x: 5, y: 5 });
    expect(bn[1].anchor).toEqual({ x: 5, y: 5 }); // duplicate => zero-length edge at t=1
  });

  it('invalid map (wrong length) falls back to index-pad', () => {
    expect(reconcile(triA, triB, 'corresponded', [0, 1])).toEqual(
      reconcile(triA, triB, 'corresponded'),
    );
  });

  it('invalid map (entry out of range) falls back to index-pad', () => {
    expect(reconcile(triA, triB, 'corresponded', [0, 1, 9])).toEqual(
      reconcile(triA, triB, 'corresponded'),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/engine/morph/reconcile.test.ts`
Expected: FAIL — `reconcile` ignores `correspondence`, so rotation/grow/merge assertions fail (it still returns index-pad).

- [ ] **Step 3: Implement the walk-B branch**

In `src/engine/morph/reconcile.ts`, add a validity check and the walk-B builder, and use them in the corresponded branch:

```ts
// A map is structurally valid when it has one entry per A node and every entry
// indexes a real B node. Cyclic-order-preservation is the EDITOR's invariant
// (walk-B keeps the destination endpoint exact regardless), so it is not checked here.
function validMap(c: number[] | undefined, m: number, n: number): c is number[] {
  if (!c || c.length !== m || n === 0) return false;
  for (const j of c) {
    if (!Number.isInteger(j) || j < 0 || j >= n) return false;
  }
  return true;
}

// Walk B in ring order; gather the A nodes feeding each B node.
// Empty source -> grow-from-point spur (degenerate A at the last emitted A anchor,
// else A[0]). Multiple sources -> adjacent merge (B node duplicated).
function reconcileMap(a: PathData, b: PathData, c: number[]): Reconciled {
  const an: PathNode[] = [];
  const bn: PathNode[] = [];
  let lastAAnchor = a.nodes[0].anchor;
  for (let j = 0; j < b.nodes.length; j++) {
    const srcs: number[] = [];
    for (let i = 0; i < c.length; i++) if (c[i] === j) srcs.push(i);
    if (srcs.length === 0) {
      an.push({ anchor: { x: lastAAnchor.x, y: lastAAnchor.y } });
      bn.push(b.nodes[j]);
    } else {
      for (const i of srcs) {
        an.push(a.nodes[i]);
        bn.push(b.nodes[j]);
        lastAAnchor = a.nodes[i].anchor;
      }
    }
  }
  return { an, bn };
}
```

Then change the corresponded branch:

```ts
  if (validMap(correspondence, a.nodes.length, b.nodes.length)) {
    return reconcileMap(a, b, correspondence);
  }
  const len = Math.max(a.nodes.length, b.nodes.length);
  return { an: padNodes(a.nodes, len), bn: padNodes(b.nodes, len) };
```

Note: `reconcileMap` reuses the SAME `PathNode` objects from `a`/`b` for non-degenerate pairs (no mutation), matching `padNodes`'s by-reference style. Degenerate spurs allocate a fresh anchor (cloned coords) so no shared-reference surprises.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/engine/morph/reconcile.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Run the full engine suite (regression: index-pad + resampled unchanged)**

Run: `pnpm vitest run src/engine && pnpm typecheck`
Expected: PASS — existing Slice 3 / Feature 2 reconcile and samplePath tests still green.

- [ ] **Step 6: Commit**

```bash
git add src/engine/morph/reconcile.ts src/engine/morph/reconcile.test.ts
git commit -m "feat(morph): walk-B explicit-map reconcile (exact destination, grow/merge, range guard)"
```

---

## Task A3: `suggestCorrespondence` + map helpers (refactor `align`)

Extract the rotation×winding search so it can emit an index map, and add the pure map utilities the UI will call.

**Files:**
- Modify: `src/engine/morph/align.ts` (extract `bestAlignment`, keep `align` behavior-preserving)
- Create: `src/engine/morph/suggest.ts`
- Modify: `src/engine/index.ts` (re-exports)
- Test: `src/engine/morph/suggest.test.ts`

**Interfaces:**
- Produces: `bestAlignment(b: PathNode[], a: PathNode[], closed: boolean): { offset: number; reversed: boolean }`
- Produces: `suggestCorrespondence(a: PathData, b: PathData): number[]`
- Produces: `identityCorrespondence(m: number, n: number): number[]` (`c[i] = min(i, n-1)`)
- Produces: `shiftCorrespondence(c: number[], n: number, delta: number): number[]`
- Produces: `reverseCorrespondence(c: number[], n: number): number[]`

- [ ] **Step 1: Write the failing tests**

Create `src/engine/morph/suggest.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  suggestCorrespondence,
  identityCorrespondence,
  shiftCorrespondence,
  reverseCorrespondence,
} from './suggest';
import type { PathData } from '../types';

const corner = (x: number, y: number) => ({ anchor: { x, y } });
// Square, closed, 4 nodes.
const sq = (pts: [number, number][]): PathData => ({
  nodes: pts.map(([x, y]) => corner(x, y)),
  closed: true,
});
const A = sq([[0, 0], [10, 0], [10, 10], [0, 10]]);
// B is A rotated by +1 (cut point shifted): node 0 of A sits at index 3 of B.
const Brot = sq([[10, 0], [10, 10], [0, 10], [0, 0]]);

describe('suggestCorrespondence', () => {
  it('recovers the cut-point rotation (closed, equal counts)', () => {
    // A[i] should map to the B index holding A[i]'s coordinate.
    // A[0]=(0,0) lives at B index 3 -> c[0]=3, then +1 each (mod 4).
    expect(suggestCorrespondence(A, Brot)).toEqual([3, 0, 1, 2]);
  });

  it('identity on an exact copy (offset 0, forward winding tie-break)', () => {
    expect(suggestCorrespondence(A, A)).toEqual([0, 1, 2, 3]);
  });

  it('recovers reversed winding', () => {
    // B is A traversed in reverse order.
    const Brev = sq([[0, 0], [0, 10], [10, 10], [10, 0]]);
    // Reverse map: c[i] = n-1-i = [3,2,1,0].
    expect(suggestCorrespondence(A, Brev)).toEqual([3, 2, 1, 0]);
  });

  it('open paths never cyclically shift (offset 0; winding only)', () => {
    const oa: PathData = { nodes: [corner(0, 0), corner(10, 0), corner(20, 0)], closed: false };
    const ob: PathData = { nodes: [corner(0, 0), corner(10, 0), corner(20, 0)], closed: false };
    expect(suggestCorrespondence(oa, ob)).toEqual([0, 1, 2]);
  });

  it('unequal counts -> clamped identity', () => {
    const a2: PathData = { nodes: [corner(0, 0), corner(10, 0)], closed: false };
    const b4: PathData = {
      nodes: [corner(0, 0), corner(5, 0), corner(10, 0), corner(15, 0)],
      closed: false,
    };
    expect(suggestCorrespondence(a2, b4)).toEqual([0, 1]);
    const b1: PathData = { nodes: [corner(0, 0)], closed: false };
    expect(suggestCorrespondence(a2, b1)).toEqual([0, 0]); // min(i, n-1)
  });

  it('does not mutate inputs', () => {
    const before = JSON.stringify(A);
    suggestCorrespondence(A, Brot);
    expect(JSON.stringify(A)).toBe(before);
  });
});

describe('map helpers', () => {
  it('identityCorrespondence clamps to b range', () => {
    expect(identityCorrespondence(3, 5)).toEqual([0, 1, 2]);
    expect(identityCorrespondence(4, 2)).toEqual([0, 1, 1, 1]);
  });

  it('shiftCorrespondence rotates targets modulo n', () => {
    expect(shiftCorrespondence([0, 1, 2, 3], 4, 1)).toEqual([1, 2, 3, 0]);
    expect(shiftCorrespondence([0, 1, 2, 3], 4, -1)).toEqual([3, 0, 1, 2]);
  });

  it('reverseCorrespondence flips winding', () => {
    expect(reverseCorrespondence([0, 1, 2, 3], 4)).toEqual([3, 2, 1, 0]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/engine/morph/suggest.test.ts`
Expected: FAIL — `./suggest` module does not exist.

- [ ] **Step 3: Extract `bestAlignment` from `align.ts`**

Rewrite `src/engine/morph/align.ts` so the search is shared (behavior-preserving — same consideration order and ties):

```ts
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

// The rotation+winding that best matches `b` to `a` (equal lengths). Closed: all cyclic
// offsets in both windings. Open: forward vs reversed only (offset always 0). Ties:
// lowest offset, forward winding (strict `<` keeps the first-seen forward offset 0).
export function bestAlignment(
  b: PathNode[],
  a: PathNode[],
  closed: boolean,
): { offset: number; reversed: boolean } {
  const n = b.length;
  if (n === 0) return { offset: 0, reversed: false };
  let best = { offset: 0, reversed: false };
  let bestCost = cost(a, b); // forward, offset 0 (seed)
  const consider = (cand: PathNode[], offset: number, reversed: boolean) => {
    const c = cost(a, cand);
    if (c < bestCost) {
      bestCost = c;
      best = { offset, reversed };
    }
  };
  const reversed = b.slice().reverse();
  if (closed) {
    for (let k = 1; k < n; k++) consider(rotate(b, k), k, false);
    for (let k = 0; k < n; k++) consider(rotate(reversed, k), k, true);
  } else {
    consider(reversed, 0, true);
  }
  return best;
}

// Reorder `b` (rotation + winding) to best match `a`. Thin wrapper over bestAlignment
// so resampled reconcile keeps byte-identical output.
export function align(b: PathNode[], a: PathNode[], closed: boolean): PathNode[] {
  const { offset, reversed } = bestAlignment(b, a, closed);
  const base = reversed ? b.slice().reverse() : b;
  return rotate(base, offset);
}
```

- [ ] **Step 4: Verify `align` is still byte-identical (resampled regression)**

Run: `pnpm vitest run src/engine/morph`
Expected: PASS — existing `align`/`reconcile`/resampled tests unchanged.

- [ ] **Step 5: Create `suggest.ts`**

Create `src/engine/morph/suggest.ts`:

```ts
import type { PathData } from '../types';
import { bestAlignment } from './align';

// c[i] = min(i, n-1): a well-defined identity map clamped into B's index range.
export function identityCorrespondence(m: number, n: number): number[] {
  const out = new Array<number>(m);
  for (let i = 0; i < m; i++) out[i] = Math.min(i, n - 1);
  return out;
}

// Suggested a-index -> b-index map. Equal counts: the cut-point rotation (+ winding)
// that minimizes total travel, reusing align()'s search. Unequal counts: clamped identity.
export function suggestCorrespondence(a: PathData, b: PathData): number[] {
  const m = a.nodes.length;
  const n = b.nodes.length;
  if (m === 0 || n === 0) return [];
  if (m !== n) return identityCorrespondence(m, n);
  const { offset, reversed } = bestAlignment(b.nodes, a.nodes, a.closed);
  const out = new Array<number>(m);
  for (let i = 0; i < m; i++) {
    const rotated = (i + offset) % n;
    out[i] = reversed ? n - 1 - rotated : rotated;
  }
  return out;
}

// Rotate the cut point: every target advances by `delta` (mod n). Keeps a rotation a
// rotation; uniformly rotates a custom map's targets. delta is typically +1 / -1.
export function shiftCorrespondence(c: number[], n: number, delta: number): number[] {
  if (n === 0) return c.slice();
  return c.map((j) => (((j + delta) % n) + n) % n);
}

// Flip winding: target j -> n-1-j.
export function reverseCorrespondence(c: number[], n: number): number[] {
  return c.map((j) => n - 1 - j);
}
```

- [ ] **Step 6: Re-export from the engine barrel**

In `src/engine/index.ts`, add (next to other morph re-exports):

```ts
export {
  suggestCorrespondence,
  identityCorrespondence,
  shiftCorrespondence,
  reverseCorrespondence,
} from './morph/suggest';
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm vitest run src/engine/morph/suggest.test.ts && pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add src/engine/morph/align.ts src/engine/morph/suggest.ts src/engine/morph/suggest.test.ts src/engine/index.ts
git commit -m "feat(morph): suggestCorrespondence (cut-point rotation) + shift/reverse/identity helpers"
```

---

## Task A4: Runtime parity + bundle regeneration

Prove a correspondence-mapped morph is byte-identical Stage == runtime, and regenerate the committed runtime bundle.

**Files:**
- Test: `src/runtime/frame.test.ts` (ADD a case)
- Modify (generated): `src/runtime/runtimeSource.generated.ts` (via build script)

**Interfaces:**
- Consumes: `samplePath` (now correspondence-aware), `computeFrame`, `pathToD`.

- [ ] **Step 1: Write the failing parity test**

Add to `src/runtime/frame.test.ts` (follow the existing morph-parity test's setup for building an object with a `shapeTrack`; mirror its imports/helpers). The new case sets `correspondence` on the from-keyframe:

```ts
it('correspondence-mapped morph: computeFrame pathD === pathToD(samplePath) at several t', () => {
  // Build a path object whose shapeTrack has two keyframes, the first carrying a
  // correspondence map (reuse this file's existing makePathObject/project helper).
  const obj = makePathObject({
    shapeTrack: [
      {
        time: 0,
        easing: 'linear',
        morph: 'corresponded',
        correspondence: [1, 2, 0], // rotation
        path: { nodes: [corner(0, 0), corner(10, 0), corner(5, 10)], closed: true },
      },
      {
        time: 1,
        easing: 'linear',
        path: { nodes: [corner(5, 10), corner(0, 0), corner(10, 0)], closed: true },
      },
    ],
  });
  const project = makeProject([obj]);
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    const frame = computeFrame(project, t);
    const item = frame.items.find((i) => i.id === obj.id)!;
    expect(item.pathD).toBe(pathToD(samplePath(obj.shapeTrack!, t)));
  }
});
```

If `frame.test.ts` lacks `makePathObject`/`makeProject` helpers, copy the exact construction used by the existing resampled-morph parity test in this file (same object/project shape) and only swap in the `correspondence` field. Do not invent new helpers.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/runtime/frame.test.ts`
Expected: FAIL — the committed runtime bundle predates the correspondence change, so `computeFrame`'s `pathD` (from the stale bundle) differs from the fresh `samplePath`.

- [ ] **Step 3: Regenerate the runtime bundle**

Run: `pnpm build:runtime`
Expected: `src/runtime/runtimeSource.generated.ts` updated (git shows a diff).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/runtime/frame.test.ts`
Expected: PASS — bundle and engine now agree.

- [ ] **Step 5: Full suite + build gates**

Run: `pnpm vitest run && pnpm typecheck && pnpm lint && pnpm build`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/runtime/frame.test.ts src/runtime/runtimeSource.generated.ts
git commit -m "test(parity): correspondence-mapped morph Stage==runtime; regenerate runtime bundle"
```

---

## Plan A — Self-review checklist (run before handing off)

- Engine pure (no React/DOM under `src/engine/`)? ✓ all new code is plain TS.
- No `CURRENT_VERSION` bump? ✓ optional field only.
- Absent/identity maps byte-identical to index-pad? ✓ Task A1/A2 assert it.
- `align` resampled output unchanged? ✓ Task A3 Step 4 regression.
- Runtime bundle regenerated and parity asserted? ✓ Task A4.
- `-0` vs `+0`: degenerate anchors are cloned coords, no negation; safe.
