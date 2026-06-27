# Center Selection on Canvas Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Center on canvas" action/button centres the selection's combined bbox on the artboard.

**Architecture:** Pure `computeCenterOnFrame` in align.ts + `centerOnCanvas()` store action reusing
`alignItemsUpdates`/`setObjectsTransforms` + Inspector buttons. Layout op; no render change.

**Tech Stack:** React 18 + TS strict, Zustand, Vitest + RTL.

## Global Constraints
- preview == export parity (writes object transforms via setObjectsTransforms; no render change).
- TS strict. Reuse align-family plumbing (autoKey gate inherited, consistent with align/distribute).

---

### Task 1: `computeCenterOnFrame` helper

**Files:** Modify `src/ui/components/Stage/align.ts`; Test `src/ui/components/Stage/align.test.ts`.

- [ ] **Step 1: Failing test** — append to align.test.ts (mirror the computeAlign tests; build
`AlignItem`s with explicit `aabb`/`x`/`y`):

```ts
describe('computeCenterOnFrame', () => {
  const item = (id: string, minX: number, minY: number, w: number, h: number, x = 0, y = 0): AlignItem => ({ id, aabb: { minX, minY, maxX: minX + w, maxY: minY + h }, x, y });
  it('centres one item on the frame', () => {
    const out = computeCenterOnFrame([item('a', 0, 0, 10, 10, 0, 0)], 100, 100);
    expect(out).toEqual([{ id: 'a', x: 45, y: 45 }]); // centre 5,5 -> 50,50 => +45,+45
  });
  it('shifts a multi-selection by ONE delta (relative offsets preserved)', () => {
    const out = computeCenterOnFrame([item('a', 0, 0, 10, 10, 0, 0), item('b', 20, 0, 10, 10, 20, 0)], 100, 100);
    // combined bbox 0..30 x, 0..10 y -> centre 15,5 -> 50,50 => +35,+45
    expect(out).toEqual([{ id: 'a', x: 35, y: 45 }, { id: 'b', x: 55, y: 45 }]);
  });
  it('returns [] when already centred and [] for empty', () => {
    expect(computeCenterOnFrame([item('a', 45, 45, 10, 10, 0, 0)], 100, 100)).toEqual([]);
    expect(computeCenterOnFrame([], 100, 100)).toEqual([]);
  });
});
```

Add `computeCenterOnFrame` to the `./align` import in the test (it imports the helpers + `AlignItem`).

- [ ] **Step 2: Run → fails** (not exported).

- [ ] **Step 3:** In `align.ts`, add the helper (uses the existing `groupBBox`, `EPS`, `AABB`,
`AlignItem`):

```ts
/** Shift every item by ONE delta so the selection's combined bbox centre lands on the frame centre
 *  (frameW/2, frameH/2). Moves the selection as a rigid group (relative positions preserved). >=1 item. */
export function computeCenterOnFrame(
  items: AlignItem[],
  frameW: number,
  frameH: number,
): { id: string; x?: number; y?: number }[] {
  const g = groupBBox(items.map((i) => i.aabb));
  if (!g || items.length < 1) return [];
  const dx = frameW / 2 - (g.minX + g.maxX) / 2;
  const dy = frameH / 2 - (g.minY + g.maxY) / 2;
  if (Math.abs(dx) < EPS && Math.abs(dy) < EPS) return [];
  return items.map((it) => ({ id: it.id, x: it.x + dx, y: it.y + dy }));
}
```

- [ ] **Step 4: Run → PASS.** Commit `feat(align): computeCenterOnFrame helper`.

---

### Task 2: `centerOnCanvas` store action

**Files:** Modify `src/ui/store/store.ts` (interface + impl near `alignSelected`/`distributeSelected`,
and the `computeCenterOnFrame` import from `../components/Stage/align`); Test `src/ui/store/store.test.ts`.

- [ ] **Step 1: Failing test** — append `describe('centerOnCanvas')`: newProject (note its meta.width/
height — read them), add a vector object away from centre with autoKey ON, call `centerOnCanvas()`,
assert the object's sampled centre ≈ (width/2, height/2). Mirror an existing align/distribute store
test for setup (autoKey on; `setObjectsTransforms` keyframes a normal object). Include: it is one undo
step (history.past grows by 1).

NOTE before running: confirm the default project meta width/height (read createProject defaults) to
compute the expected centre; confirm align/distribute store tests turn autoKey ON (alignItemsUpdates
gates on it). Verify the exact name of the bbox/sample helper to assert position (sampleObject + the
object's objectAABB, or just assert tracks.x/y values).

- [ ] **Step 2: Run → fails** (action missing).

- [ ] **Step 3:** Add to the store interface `centerOnCanvas(): void;` (near `alignSelected`), import
`computeCenterOnFrame`, and implement near `distributeSelected`:

```ts
centerOnCanvas() {
  const { width, height } = get().history.present.meta;
  const updates = alignItemsUpdates(get(), (items) => computeCenterOnFrame(items, width, height));
  if (updates.length) get().setObjectsTransforms(updates);
},
```

- [ ] **Step 4: Run → PASS.** Commit `feat(store): centerOnCanvas action`.

---

### Task 3: Inspector buttons + RTL

**Files:** Modify `src/ui/components/Inspector/Inspector.tsx`; Test `Inspector.test.tsx`.

- [ ] **Step 1: Failing RTL test** — a single selected object: assert a button aria-label "Center on
canvas" exists and clicking it invokes `centerOnCanvas` (object recenters / action ran). Mirror an
existing Inspector button test.

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3:** In Inspector.tsx, destructure `centerOnCanvas` from the store; add a
`<button aria-label="Center on canvas" title="Center on canvas" onClick={() => centerOnCanvas()}>` in
BOTH the single-object panel (near the transform rows) and the multi-select panel (alongside the
align/distribute row). (For the multi panel it can sit in the same row as align/distribute.)

- [ ] **Step 4: Run RTL → PASS.**

- [ ] **Step 5: Full verify + commit** — `npx vitest run && npm run typecheck && npx eslint <touched>`;
`feat(inspector): Center on canvas button (single + multi panels)`.

---

## Self-Review
- Spec coverage: helper (T1), action (T2), buttons (T3) + tests at each layer.
- Placeholders: the NOTEs verify meta defaults + the autoKey-on test convention — real checks.
- Type consistency: `computeCenterOnFrame(items, w, h)` matches the store call; `centerOnCanvas(): void`.
