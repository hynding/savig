# Per-Node Easing — Plan A (Engine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an optional per-node easing array (`nodeEasings?: Easing[]`) on the from-keyframe drive a per-pair `t` in `samplePath`, so each morphing node can ease independently — while keeping today's single-easing morph byte-identical when the field is absent.

**Architecture:** `reconcile` gains an `aIndex` array reporting the source from-node index for each output pair (`-1` when none), so a node's easing follows it through index-pad/correspondence/resample reordering. `samplePath` looks up `a.nodeEasings?.[aIndex[k]] ?? a.easing` per pair and eases each node with its own `t`. Pure TS; the runtime bundle is regenerated.

**Tech Stack:** TypeScript (strict), Vitest. Pure engine under `src/engine/`. Runtime bundle via `node scripts/build-runtime.mjs` (`pnpm build:runtime`).

## Global Constraints

- **Engine stays pure** — no React/DOM imports under `src/engine/`. The render core lifts verbatim into the export runtime.
- **Optional field only** → persistence is a **no-op version bump**; do NOT bump `CURRENT_VERSION`. Default-absent reproduces today's single-easing morph exactly.
- **`null` holes fall back like `undefined`** — `?? a.easing` catches both (a sparse array serializes holes to `null`).
- **Per-node easing is corresponded-only** — `aIndex` is `-1` for every resampled pair, so `nodeEasings` is structurally ignored under `resampled`.
- **Preview == export parity** through the shared pure `samplePath` → `pathToD`. Regenerate the runtime bundle whenever engine morph code changes.
- **TDD**: failing test → minimal impl → green → commit. `-0` vs `+0`: use `0 - x`, never `-x` (Vitest `toEqual` distinguishes them).
- Run unit tests with `pnpm vitest run <path>`; typecheck `pnpm typecheck`; lint `pnpm lint`.

---

## File Structure

- `src/engine/types.ts` — add `nodeEasings?: Easing[]` to `ShapeKeyframe` (MODIFY).
- `src/engine/morph/reconcile.ts` — add `aIndex` to `Reconciled`; populate in all three branches (MODIFY).
- `src/engine/path.ts` — `samplePath` applies a per-pair `t` (MODIFY).
- Tests: `src/engine/morph/reconcile.test.ts`, `src/engine/path.test.ts` (or the file holding `samplePath` tests), `src/runtime/frame.test.ts` (parity).

---

## Task A1: `reconcile` reports `aIndex` + add the `nodeEasings` field

Add the optional field and make `reconcile` report node provenance. `samplePath` stays unchanged (it ignores `aIndex` this task), so behavior is byte-identical.

**Files:**
- Modify: `src/engine/types.ts` (ShapeKeyframe)
- Modify: `src/engine/morph/reconcile.ts`
- Test: `src/engine/morph/reconcile.test.ts`

**Interfaces:**
- Produces: `interface Reconciled { an: PathNode[]; bn: PathNode[]; aIndex: number[] }`
- Produces: `ShapeKeyframe.nodeEasings?: Easing[]`

- [ ] **Step 1: Write the failing tests**

Add to `src/engine/morph/reconcile.test.ts` (the file already imports `reconcile`, `PathData`, and defines `corner`):

```ts
describe('reconcile aIndex (source from-node per output pair)', () => {
  it('index-pad: real-node indices then -1 for padding', () => {
    const a1: PathData = { nodes: [corner(0, 0)], closed: false };
    const b3: PathData = { nodes: [corner(0, 0), corner(5, 0), corner(10, 0)], closed: false };
    expect(reconcile(a1, b3, 'corresponded').aIndex).toEqual([0, -1, -1]);
    // a longer than b -> no padding, every pair real
    expect(reconcile(b3, a1, 'corresponded').aIndex).toEqual([0, 1, 2]);
  });

  it('correspondence-map: source i per pair, -1 for grow-from-point spurs', () => {
    const a2: PathData = { nodes: [corner(0, 0), corner(10, 0)], closed: false };
    const b3: PathData = { nodes: [corner(0, 0), corner(5, 9), corner(10, 0)], closed: false };
    // map a0->b0, a1->b2; b1 unreferenced (middle spur)
    expect(reconcile(a2, b3, 'corresponded', [0, 2]).aIndex).toEqual([0, -1, 1]);
  });

  it('correspondence-map merge: each merged pair keeps its own source index', () => {
    const a3: PathData = { nodes: [corner(0, 0), corner(4, 0), corner(10, 0)], closed: false };
    const b2: PathData = { nodes: [corner(0, 5), corner(10, 5)], closed: false };
    // a0,a1 -> b0 (merge); a2 -> b1
    expect(reconcile(a3, b2, 'corresponded', [0, 0, 1]).aIndex).toEqual([0, 1, 2]);
  });

  it('resampled: all -1 (no node identity)', () => {
    const a3: PathData = { nodes: [corner(0, 0), corner(10, 0), corner(10, 10)], closed: true };
    const b2: PathData = { nodes: [corner(0, 0), corner(20, 0)], closed: true };
    const { aIndex } = reconcile(a3, b2, 'resampled');
    expect(aIndex).toHaveLength(64); // SAMPLE_COUNT
    expect(aIndex.every((x) => x === -1)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/engine/morph/reconcile.test.ts`
Expected: FAIL — `Reconciled` has no `aIndex`.

- [ ] **Step 3: Add the field**

In `src/engine/types.ts`, inside `interface ShapeKeyframe` (after the `correspondence?` field):

```ts
  /** Per-node easing into the next keyframe, sparse and aligned 1:1 with path.nodes.
   *  Corresponded mode only; a hole/undefined/null falls back to the keyframe `easing`. */
  nodeEasings?: Easing[];
```

- [ ] **Step 4: Add `aIndex` to `Reconciled` and populate all three branches**

In `src/engine/morph/reconcile.ts`, change the interface:

```ts
export interface Reconciled {
  an: PathNode[];
  bn: PathNode[];
  aIndex: number[];
}
```

In `reconcileMap`, track the source index per emitted pair:

```ts
function reconcileMap(a: PathData, b: PathData, c: number[]): Reconciled {
  const an: PathNode[] = [];
  const bn: PathNode[] = [];
  const aIndex: number[] = [];
  let lastAAnchor = a.nodes[0].anchor;
  for (let j = 0; j < b.nodes.length; j++) {
    const srcs: number[] = [];
    for (let i = 0; i < c.length; i++) if (c[i] === j) srcs.push(i);
    if (srcs.length === 0) {
      an.push({ anchor: { x: lastAAnchor.x, y: lastAAnchor.y } });
      bn.push(b.nodes[j]);
      aIndex.push(-1);
    } else {
      for (const i of srcs) {
        an.push(a.nodes[i]);
        bn.push(b.nodes[j]);
        aIndex.push(i);
        lastAAnchor = a.nodes[i].anchor;
      }
    }
  }
  return { an, bn, aIndex };
}
```

In `reconcile`, the resampled and index-pad branches:

```ts
  if (mode === 'resampled') {
    const an = resample(a, SAMPLE_COUNT);
    const bn = align(resample(b, SAMPLE_COUNT), an, a.closed);
    return { an, bn, aIndex: new Array<number>(an.length).fill(-1) };
  }
  if (validMap(correspondence, a.nodes.length, b.nodes.length)) {
    return reconcileMap(a, b, correspondence);
  }
  const len = Math.max(a.nodes.length, b.nodes.length);
  const m = a.nodes.length;
  const aIndex = Array.from({ length: len }, (_, i) => (i < m ? i : -1));
  return { an: padNodes(a.nodes, len), bn: padNodes(b.nodes, len), aIndex };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/engine && pnpm typecheck`
Expected: PASS — new aIndex tests pass; all existing reconcile/samplePath/parity tests still green (samplePath ignores the extra field).

- [ ] **Step 6: Commit**

```bash
git add src/engine/types.ts src/engine/morph/reconcile.ts src/engine/morph/reconcile.test.ts
git commit -m "feat(morph): reconcile reports aIndex (source node per pair) + nodeEasings field"
```

---

## Task A2: `samplePath` applies a per-pair `t`

Use `aIndex` + `nodeEasings` to ease each node pair with its own `t`. Absent `nodeEasings` collapses to today's single `t`.

**Files:**
- Modify: `src/engine/path.ts` (`samplePath`)
- Test: the existing `samplePath` test file (find it: `grep -rl "samplePath" src/engine/*.test.ts`)

**Interfaces:**
- Consumes: `reconcile(...).aIndex` (Task A1), `ShapeKeyframe.nodeEasings` (Task A1).

- [ ] **Step 1: Write the failing tests**

Add to the file containing `samplePath` tests (use the same imports/helpers it already has; `corner`, `samplePath`, `applyEasing` are in `src/engine`):

```ts
import { applyEasing } from './easing';

describe('samplePath per-node easing', () => {
  // Two-node open path, A -> B over [0,2]. Node 0 easeIn, node 1 linear.
  const A = { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 0, y: 0 } }] };
  const B = { closed: false, nodes: [{ anchor: { x: 10, y: 0 } }, { anchor: { x: 10, y: 0 } }] };

  it('eases each node with its own t; endpoints stay exact', () => {
    const track = [
      { time: 0, easing: 'linear' as const, nodeEasings: ['easeIn' as const, 'linear' as const], path: A },
      { time: 2, easing: 'linear' as const, path: B },
    ];
    const mid = samplePath(track, 1); // rawProgress 0.5
    // node 0 used easeIn, node 1 used linear -> different x at the same frame
    expect(mid.nodes[0].anchor.x).toBeCloseTo(10 * applyEasing('easeIn', 0.5), 6);
    expect(mid.nodes[1].anchor.x).toBeCloseTo(10 * 0.5, 6);
    expect(mid.nodes[0].anchor.x).not.toBeCloseTo(mid.nodes[1].anchor.x, 4);
    // endpoints exact
    expect(samplePath(track, 0)).toEqual(A);
    expect(samplePath(track, 2)).toEqual(B);
  });

  it('a hole / -1 pair falls back to the keyframe easing', () => {
    const track = [
      // only node 1 customized; node 0 is a hole -> keyframe easing (linear)
      { time: 0, easing: 'linear' as const, nodeEasings: [undefined as unknown as 'linear', 'easeIn' as const], path: A },
      { time: 2, easing: 'linear' as const, path: B },
    ];
    const mid = samplePath(track, 1);
    expect(mid.nodes[0].anchor.x).toBeCloseTo(5, 6); // linear fallback
    expect(mid.nodes[1].anchor.x).toBeCloseTo(10 * applyEasing('easeIn', 0.5), 6);
  });

  it('absent nodeEasings is byte-identical to a single-easing morph', () => {
    const plain = [{ time: 0, easing: 'easeIn' as const, path: A }, { time: 2, easing: 'linear' as const, path: B }];
    const mid = samplePath(plain, 1);
    // every node uses the keyframe easing (easeIn) -> same x
    expect(mid.nodes[0].anchor.x).toBeCloseTo(mid.nodes[1].anchor.x, 9);
    expect(mid.nodes[0].anchor.x).toBeCloseTo(10 * applyEasing('easeIn', 0.5), 6);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/engine`
Expected: FAIL — `samplePath` still uses a single `t`, so node 0 and node 1 reach the same x.

- [ ] **Step 3: Apply the per-pair `t`**

In `src/engine/path.ts`, replace the tail of `samplePath` (the `const t = …` line through the loop):

```ts
  const { an, bn, aIndex } = reconcile(a.path, b.path, a.morph ?? 'corresponded', a.correspondence);
  const nodes: PathNode[] = [];
  for (let k = 0; k < an.length; k++) {
    const e = (aIndex[k] >= 0 ? a.nodeEasings?.[aIndex[k]] : undefined) ?? a.easing;
    nodes.push(lerpNode(an[k], bn[k], applyEasing(e, rawProgress)));
  }
  return { nodes, closed: a.path.closed };
```

(Delete the now-unused `const t = applyEasing(a.easing, rawProgress);` line; `rawProgress` is still computed above it.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/engine && pnpm typecheck`
Expected: PASS — per-node effect verified; existing morph tests (all single-easing) unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/engine/path.ts src/engine/*.test.ts
git commit -m "feat(morph): samplePath applies a per-pair t from nodeEasings (corresponded only)"
```

---

## Task A3: Runtime parity + bundle regeneration

Prove a per-node-eased morph is byte-identical Stage == runtime, and regenerate the committed runtime bundle.

**Files:**
- Test: `src/runtime/frame.test.ts` (ADD a case to the `computeFrame path morphing` describe)
- Modify (generated): `src/runtime/runtimeSource.generated.ts` (via build script)

**Interfaces:**
- Consumes: `samplePath` (now per-node-aware), `computeFrame`, `pathToD`.

- [ ] **Step 1: Write the failing parity test**

Add inside the `describe('computeFrame path morphing', …)` block in `src/runtime/frame.test.ts` (reuse this file's `createVectorAsset` / `createSceneObject` / `createProject` / `pathToD` / `samplePath` imports):

```ts
  it('emits pathD equal to pathToD(samplePath) for a PER-NODE-EASED morph at several t', () => {
    const na = { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 0, y: 0 } }] };
    const nb = { closed: false, nodes: [{ anchor: { x: 10, y: 0 } }, { anchor: { x: 10, y: 0 } }] };
    const nTrack: ShapeKeyframe[] = [
      { time: 0, easing: 'linear', nodeEasings: ['easeIn', 'easeOut'], path: na },
      { time: 2, easing: 'linear', path: nb },
    ];
    const asset = createVectorAsset('path', { path: na });
    const obj = createSceneObject(asset.id, { anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5, shapeTrack: nTrack });
    const project = { ...createProject(), assets: [asset], objects: [obj] };
    for (const t of [0, 0.5, 1, 1.5, 2]) {
      expect(computeFrame(project, t)[0].pathD).toBe(pathToD(samplePath(nTrack, t)));
    }
  });
```

- [ ] **Step 2: Run test to verify it fails (stale bundle)**

Run: `pnpm vitest run src/runtime/frame.test.ts`
Expected: FAIL — the committed runtime bundle predates the per-pair `t`, so `computeFrame`'s `pathD` (from the stale bundle) differs from the fresh `samplePath` at the eased interior frames.

- [ ] **Step 3: Regenerate the runtime bundle**

Run: `pnpm build:runtime`
Expected: `src/runtime/runtimeSource.generated.ts` updated (git shows a diff).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/runtime/frame.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite + build gates**

Run: `pnpm vitest run && pnpm typecheck && pnpm lint && pnpm build`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/runtime/frame.test.ts src/runtime/runtimeSource.generated.ts
git commit -m "test(parity): per-node-eased morph Stage==runtime; regenerate runtime bundle"
```

---

## Plan A — Self-review checklist (run before handing off)

- Engine pure (no React/DOM under `src/engine/`)? ✓ all new code is plain TS.
- No `CURRENT_VERSION` bump? ✓ optional field only.
- Absent `nodeEasings` byte-identical to single-easing morph? ✓ A2 asserts it; existing morph tests unchanged.
- `aIndex` correct for all three branches incl. merge / spur / padding? ✓ A1 tests.
- Resampled ignores `nodeEasings`? ✓ `aIndex` all `-1` → fallback to `a.easing`.
- Runtime bundle regenerated and parity asserted? ✓ A3.
