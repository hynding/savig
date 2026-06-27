# Distribute by Centers Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "distribute by centers" action/buttons evenly space the selected objects' centres.

**Architecture:** Pure `computeDistributeCenters` in align.ts + `distributeCentersSelected(axis)` store
action (mirrors `distributeSelected`) + 2 Inspector buttons. Layout op; no render change.

**Tech Stack:** React 18 + TS strict, Zustand, Vitest + RTL.

## Global Constraints
- preview == export parity (writes transforms via setObjectsTransforms; no render change).
- TS strict. Reuse align-family plumbing.

---

### Task 1: `computeDistributeCenters` helper

**Files:** Modify `src/ui/components/Stage/align.ts`; Test `src/ui/components/Stage/align.test.ts`.

- [ ] **Step 1: Failing test** — append to align.test.ts:

```ts
describe('computeDistributeCenters', () => {
  // three boxes, centres at x=0, x=30, x=100 (differently sized to show CENTERS not gaps are evened)
  const item = (id: string, minX: number, w: number, x = 0): AlignItem => ({ id, aabb: { minX, minY: 0, maxX: minX + w, maxY: 10 }, x, y: 0 });
  it('evens the centres along x (middle moves to the midpoint)', () => {
    // a: center 0 (minX -5,w10), b: center 30 (minX 20,w20), c: center 100 (minX 95,w10)
    const out = computeDistributeCenters([item('a', -5, 10), item('b', 20, 20), item('c', 95, 10)], 'h');
    // step = (100-0)/2 = 50 -> b center should be 50 (currently 30) -> +20
    expect(out).toEqual([{ id: 'b', x: 20 }]);
  });
  it('returns [] for fewer than 3 and for already-even', () => {
    expect(computeDistributeCenters([item('a', 0, 10), item('b', 40, 10)], 'h')).toEqual([]);
    expect(computeDistributeCenters([item('a', 0, 10, 0), item('b', 45, 10, 0), item('c', 90, 10, 0)], 'h')).toEqual([]);
  });
});
```

Add `computeDistributeCenters` to the `./align` import in the test.

- [ ] **Step 2: Run → fails** (not exported).

- [ ] **Step 3:** In `align.ts`, add (uses existing `AABB`, `AlignItem`, `DistributeAxis`, `EPS`):

```ts
/** Distribute by equal CENTER spacing along `axis`: first & last (by center) stay; intermediate items
 *  move so all centers are evenly spaced. >=3 items. */
export function computeDistributeCenters(
  items: AlignItem[],
  axis: DistributeAxis,
): { id: string; x?: number; y?: number }[] {
  if (items.length < 3) return [];
  const horizontal = axis === 'h';
  const center = (a: AABB) => (horizontal ? (a.minX + a.maxX) / 2 : (a.minY + a.maxY) / 2);
  const sorted = [...items].sort((p, q) => center(p.aabb) - center(q.aabb));
  const firstC = center(sorted[0].aabb);
  const lastC = center(sorted[sorted.length - 1].aabb);
  const step = (lastC - firstC) / (sorted.length - 1);
  const out: { id: string; x?: number; y?: number }[] = [];
  sorted.forEach((it, i) => {
    const d = firstC + i * step - center(it.aabb);
    if (Math.abs(d) >= EPS) out.push(horizontal ? { id: it.id, x: it.x + d } : { id: it.id, y: it.y + d });
  });
  return out;
}
```

- [ ] **Step 4: Run → PASS.** Commit `feat(align): computeDistributeCenters helper`.

---

### Task 2: `distributeCentersSelected` store action

**Files:** Modify `src/ui/store/store.ts` (interface + impl by `distributeSelected`, import the helper);
Test `src/ui/store/store.test.ts`.

- [ ] **Step 1: Failing test** — `describe('distributeCentersSelected')`: 3 objects with uneven
centres, autoKey ON, `distributeCentersSelected('h')`, assert the middle object moved so centres are
even; one undo step. Mirror a `distributeSelected` store test if present (else an align one).

NOTE before running: confirm there IS (or isn't) an existing distributeSelected store test to mirror;
confirm autoKey-on convention; assert via sampled x or tracks.x.

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3:** Add interface `distributeCentersSelected(axis: DistributeAxis): void;` (by
`distributeSelected`), import `computeDistributeCenters`, implement:

```ts
distributeCentersSelected(axis) {
  const updates = alignItemsUpdates(get(), (items) => computeDistributeCenters(items, axis));
  if (updates.length) get().setObjectsTransforms(updates);
},
```

- [ ] **Step 4: Run → PASS.** Commit `feat(store): distributeCentersSelected action`.

---

### Task 3: Inspector buttons + RTL

**Files:** Modify `src/ui/components/Inspector/Inspector.tsx`; Test `Inspector.test.tsx`.

- [ ] **Step 1: Failing RTL test** — with ≥3 objects selected, assert buttons aria-labelled
"Distribute horizontal centers" / "Distribute vertical centers" exist and a click invokes the action.

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3:** Destructure `distributeCentersSelected`; add two buttons next to the existing
distribute buttons, gated by the existing `canDistribute` (`movableCount >= 3`):

```tsx
<button aria-label="Distribute horizontal centers" title="Distribute horizontal centers" disabled={!canDistribute} onClick={() => distributeCentersSelected('h')}>⇿</button>
<button aria-label="Distribute vertical centers" title="Distribute vertical centers" disabled={!canDistribute} onClick={() => distributeCentersSelected('v')}>⇳</button>
```

- [ ] **Step 4: Run RTL → PASS.**

- [ ] **Step 5: Full verify + commit** — `npx vitest run && npm run typecheck && npx eslint <touched>`;
`feat(inspector): distribute-by-centers buttons`.

---

## Self-Review
- Spec coverage: helper (T1), action (T2), buttons (T3) + tests.
- Placeholders: the NOTE verifies the distribute test convention — a real check.
- Type consistency: `computeDistributeCenters(items, axis)` matches the store call;
  `distributeCentersSelected(axis: DistributeAxis)`.
