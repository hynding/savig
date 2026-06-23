# Savig M4 Slice 43 — Align & Distribute Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Steps use `- [ ]` tracking.

**Goal:** Align (6 ops) and distribute (2 ops, equal-gap) the multi-selection in one undo step.

**Architecture:** Pure AABB geometry (`align.ts`) computes per-object `{id, x?, y?}` updates fed to the existing `setObjectsTransforms`. The per-object stage AABB helper (`objectAABB`) + its `resolveObjectAnchor` move from `Stage.tsx` into `snapping.ts` so both Stage and the align logic share them. No engine/export/persistence change.

**Tech Stack:** React 18 + TS strict, Zustand, Vitest + RTL, Playwright.

## Global Constraints

- TS strict; no new deps. CSS Modules + tokens for UI.
- Align/distribute gated on `autoKey` (like nudge/group transforms); commit via a single `setObjectsTransforms` (one undo step). Locked/hidden objects excluded from both the reference bbox and the writes.
- Sample the AABB and x/y at the SAME frame-snapped time `setObjectsTransforms` writes to.
- Primary/anchor invariant unaffected (align doesn't change selection).
- Commit footer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Full gate before merge: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`.

---

### Task 1: Lift `resolveObjectAnchor` + `objectAABB` into `snapping.ts`

**Files:**
- Modify: `src/ui/components/Stage/snapping.ts` (add the two functions, exported)
- Modify: `src/ui/components/Stage/Stage.tsx` (delete the local copies; import from `./snapping`)
- Test: `src/ui/components/Stage/snapping.test.ts`

**Interfaces:**
- Produces: `export function objectAABB(obj: SceneObject, asset: Asset | undefined, time: number): AABB | null` and `export function resolveObjectAnchor(obj, asset, state: RenderState): { anchorX: number; anchorY: number; bbox: LocalRect } | null`.

- [ ] **Step 1: Move the functions.** Cut `resolveObjectAnchor` (Stage.tsx ~lines 78–96) and `objectAABB` (~lines 100–113) and paste them at the end of `snapping.ts`, adding `export` to both. Add the engine imports `snapping.ts` now needs (it currently imports nothing from engine): at the top of `snapping.ts`:
```ts
import { pathBounds, resolveAnchor, sampleObject, shapeLocalBBox } from '../../../engine';
import type { Asset, LocalRect, RenderState, SceneObject } from '../../../engine';
```
(`objectAABB` uses `sampleObject`, `transformedAABB` (already local), and `resolveObjectAnchor`; `resolveObjectAnchor` uses `shapeLocalBBox`, `resolveAnchor`, `pathBounds`.)

- [ ] **Step 2: Update Stage.tsx imports.** Add `objectAABB` (and `resolveObjectAnchor` if still referenced elsewhere — grep; likely only `objectAABB` is used after the move) to the existing `./snapping` import in `Stage.tsx`:
```ts
import { /* existing: */ transformedAABB, computeSnap, aabbIntersect, groupBBox, objectAABB } from './snapping';
```
Remove the now-deleted local `function objectAABB` / `function resolveObjectAnchor`. Confirm `resolveObjectAnchor` has no other caller in Stage.tsx (`grep -n resolveObjectAnchor src/ui/components/Stage/Stage.tsx`); if unused there after the move, do not import it back.

- [ ] **Step 3: Add a lock test** in `snapping.test.ts` for the moved helper:
```ts
import { objectAABB } from './snapping';
import { createSceneObject, createVectorAsset } from '../../../engine';

it('objectAABB returns the stage AABB of a rect object', () => {
  const asset = createVectorAsset('rect', { id: 'r', style: { fill: '#000', stroke: 'none', strokeWidth: 0 } });
  // a 40x20 rect (adapt to createVectorAsset's default geometry; set shapeBase/base so the box is known)
  const obj = createSceneObject('r', { id: 'o', base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
  const a = objectAABB(obj, asset, 0);
  expect(a).not.toBeNull();
  expect(a!.maxX).toBeGreaterThan(a!.minX);
  expect(a!.maxY).toBeGreaterThan(a!.minY);
});
```
(Adjust the factory calls to match `createVectorAsset`/`createSceneObject` signatures used elsewhere in the repo — grep an existing test that builds a rect asset, e.g. `duplicate.test.ts`.)

- [ ] **Step 4: Run** `pnpm vitest run src/ui/components/Stage/snapping.test.ts src/ui/components/Stage/Stage.test.tsx && pnpm typecheck` → all PASS (behavior preserved).

- [ ] **Step 5: Commit** `refactor(slice43): lift objectAABB + resolveObjectAnchor into snapping.ts`.

---

### Task 2: Pure align/distribute geometry (`align.ts`)

**Files:**
- Create: `src/ui/components/Stage/align.ts`
- Test: `src/ui/components/Stage/align.test.ts`

**Interfaces:**
- Produces:
```ts
export type AlignEdge = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';
export type DistributeAxis = 'h' | 'v';
export interface AlignItem { id: string; aabb: AABB; x: number; y: number }
export function computeAlign(items: AlignItem[], edge: AlignEdge): { id: string; x?: number; y?: number }[];
export function computeDistribute(items: AlignItem[], axis: DistributeAxis): { id: string; x?: number; y?: number }[];
```
- Consumes: `AABB` and `groupBBox` from `./snapping`.

- [ ] **Step 1: Write the failing tests** in `align.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { computeAlign, computeDistribute, type AlignItem } from './align';

const box = (id: string, minX: number, minY: number, w: number, h: number, x = minX, y = minY): AlignItem => ({
  id, x, y, aabb: { minX, minY, maxX: minX + w, maxY: minY + h },
});

describe('computeAlign', () => {
  it('left aligns every AABB minX to the group minX', () => {
    const items = [box('a', 0, 0, 10, 10), box('b', 40, 5, 20, 10)];
    const u = computeAlign(items, 'left');
    // a is already leftmost (dx 0, filtered); b moves left by 40
    expect(u).toEqual([{ id: 'b', x: 40 - 40 }]); // b.x (40) + (0 - 40) = 0
  });

  it('hcenter aligns every AABB center X to the group center X', () => {
    const items = [box('a', 0, 0, 10, 10), box('b', 40, 0, 20, 10)];
    // group minX 0, maxX 60 -> center 30. a center 5 -> dx 25; b center 50 -> dx -20.
    const u = computeAlign(items, 'hcenter');
    expect(u).toEqual([{ id: 'a', x: 25 }, { id: 'b', x: 20 }]);
  });

  it('bottom aligns every AABB maxY to the group maxY', () => {
    const items = [box('a', 0, 0, 10, 10), box('b', 0, 0, 10, 30)];
    // group maxY 30. a maxY 10 -> dy 20; b maxY 30 -> dy 0 (filtered).
    expect(computeAlign(items, 'bottom')).toEqual([{ id: 'a', y: 20 }]);
  });
});

describe('computeDistribute', () => {
  it('equalizes horizontal gaps with the extremes fixed', () => {
    // widths 10,10,10 across [0,100]: free = 100 - 30 = 70, gap = 35.
    const items = [box('a', 0, 0, 10, 10), box('b', 30, 0, 10, 10), box('c', 90, 0, 10, 10)];
    const u = computeDistribute(items, 'h');
    // a fixed; b -> minX 0+10+35 = 45 (dx 15); c -> 45+10+35 = 90 (dx 0, filtered).
    expect(u).toEqual([{ id: 'b', x: 45 }]);
  });

  it('is a no-op for fewer than 3 items', () => {
    expect(computeDistribute([box('a', 0, 0, 10, 10), box('b', 40, 0, 10, 10)], 'h')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run** `pnpm vitest run src/ui/components/Stage/align.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `align.ts`:**
```ts
import { groupBBox, type AABB } from './snapping';

export type AlignEdge = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';
export type DistributeAxis = 'h' | 'v';
export interface AlignItem { id: string; aabb: AABB; x: number; y: number }

const EPS = 1e-6;

export function computeAlign(items: AlignItem[], edge: AlignEdge): { id: string; x?: number; y?: number }[] {
  const g = groupBBox(items.map((i) => i.aabb));
  if (!g || items.length < 2) return [];
  const horizontal = edge === 'left' || edge === 'hcenter' || edge === 'right';
  const out: { id: string; x?: number; y?: number }[] = [];
  for (const it of items) {
    const a = it.aabb;
    let d: number;
    if (edge === 'left') d = g.minX - a.minX;
    else if (edge === 'right') d = g.maxX - a.maxX;
    else if (edge === 'hcenter') d = (g.minX + g.maxX) / 2 - (a.minX + a.maxX) / 2;
    else if (edge === 'top') d = g.minY - a.minY;
    else if (edge === 'bottom') d = g.maxY - a.maxY;
    else d = (g.minY + g.maxY) / 2 - (a.minY + a.maxY) / 2; // vcenter
    if (Math.abs(d) < EPS) continue;
    out.push(horizontal ? { id: it.id, x: it.x + d } : { id: it.id, y: it.y + d });
  }
  return out;
}

export function computeDistribute(items: AlignItem[], axis: DistributeAxis): { id: string; x?: number; y?: number }[] {
  if (items.length < 3) return [];
  const horizontal = axis === 'h';
  const lo = (a: AABB) => (horizontal ? a.minX : a.minY);
  const hi = (a: AABB) => (horizontal ? a.maxX : a.maxY);
  const sorted = [...items].sort((p, q) => lo(p.aabb) - lo(q.aabb));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span = hi(last.aabb) - lo(first.aabb);
  const sizes = sorted.reduce((s, it) => s + (hi(it.aabb) - lo(it.aabb)), 0);
  const gap = (span - sizes) / (sorted.length - 1);
  const out: { id: string; x?: number; y?: number }[] = [];
  let cursor = lo(first.aabb);
  for (const it of sorted) {
    const d = cursor - lo(it.aabb);
    if (Math.abs(d) >= EPS) out.push(horizontal ? { id: it.id, x: it.x + d } : { id: it.id, y: it.y + d });
    cursor += (hi(it.aabb) - lo(it.aabb)) + gap;
  }
  return out;
}
```

- [ ] **Step 4: Run** the tests → PASS.

- [ ] **Step 5: Commit** `feat(slice43): pure computeAlign/computeDistribute geometry`.

---

### Task 3: Store actions `alignSelected` / `distributeSelected`

**Files:**
- Modify: `src/ui/store/store.ts`
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Produces: `alignSelected(edge: AlignEdge): void` / `distributeSelected(axis: DistributeAxis): void`.
- Consumes: `objectAABB` (Task 1, from `../components/Stage/snapping`), `computeAlign`/`computeDistribute`/types (Task 2, from `../components/Stage/align`), existing `setObjectsTransforms`, `sampleObject`, `snapToFrame`.

- [ ] **Step 1: Failing tests** in `store.test.ts` (new describe block; reuse the `threeRects` pattern from the grouping tests — three rects at x 0/40/80):
```ts
describe('align & distribute (slice 43)', () => {
  function rects() {
    useEditor.getState().newProject();
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const a = useEditor.getState().selectedObjectId!;
    useEditor.getState().addVectorShape('rect', { x: 40, y: 30, width: 10, height: 10 });
    const b = useEditor.getState().selectedObjectId!;
    useEditor.getState().addVectorShape('rect', { x: 90, y: 5, width: 10, height: 10 });
    const c = useEditor.getState().selectedObjectId!;
    return { a, b, c };
  }
  const aabbMinX = (id: string) => {
    const s = useEditor.getState();
    const o = s.history.present.objects.find((x) => x.id === id)!;
    return objectAABB(o, s.history.present.assets.find((as) => as.id === o.assetId), s.time)!.minX;
  };

  it('alignSelected("left") makes every selected AABB minX equal', () => {
    const { a, b, c } = rects();
    useEditor.getState().selectObjects([a, b, c]);
    useEditor.getState().alignSelected('left');
    const xa = aabbMinX(a), xb = aabbMinX(b), xc = aabbMinX(c);
    expect(Math.abs(xb - xa)).toBeLessThan(1e-6);
    expect(Math.abs(xc - xa)).toBeLessThan(1e-6);
  });

  it('alignSelected is one undo step and respects autoKey off', () => {
    const { a, b, c } = rects();
    useEditor.getState().selectObjects([a, b, c]);
    const past = useEditor.getState().history.past.length;
    useEditor.getState().alignSelected('left');
    expect(useEditor.getState().history.past.length).toBe(past + 1);
    useEditor.getState().setAutoKey(false); // match the store's autoKey setter name
    const past2 = useEditor.getState().history.past.length;
    useEditor.getState().alignSelected('right');
    expect(useEditor.getState().history.past.length).toBe(past2); // no-op
  });

  it('distributeSelected("h") equalizes the gaps between AABBs', () => {
    const { a, b, c } = rects();
    useEditor.getState().selectObjects([a, b, c]);
    useEditor.getState().distributeSelected('h');
    const s = useEditor.getState();
    const aabb = (id: string) => { const o = s.history.present.objects.find((x) => x.id === id)!; return objectAABB(o, s.history.present.assets.find((as) => as.id === o.assetId), s.time)!; };
    const boxes = [aabb(a), aabb(b), aabb(c)].sort((p, q) => p.minX - q.minX);
    const gap1 = boxes[1].minX - boxes[0].maxX;
    const gap2 = boxes[2].minX - boxes[1].maxX;
    expect(Math.abs(gap1 - gap2)).toBeLessThan(1e-6);
  });

  it('a locked member is not moved and does not anchor the alignment', () => {
    const { a, b, c } = rects();
    useEditor.getState().toggleObjectLock(a); // a is the leftmost, now locked
    const beforeA = aabbMinX(a);
    useEditor.getState().selectObjects([a, b, c]);
    useEditor.getState().alignSelected('left');
    expect(Math.abs(aabbMinX(a) - beforeA)).toBeLessThan(1e-6); // a unmoved (locked)
    // b & c align to the group of MOVABLE objects (b is leftmost movable at x40)
    expect(Math.abs(aabbMinX(c) - aabbMinX(b))).toBeLessThan(1e-6);
  });
});
```
(Verify the autoKey setter name — grep `setAutoKey`/`toggleAutoKey` in the store and use the real one. Add `import { objectAABB } from '../components/Stage/snapping';` to the test file.)

- [ ] **Step 2: Run** `pnpm vitest run src/ui/store/store.test.ts` → FAIL (actions undefined).

- [ ] **Step 3: Declare** in the store interface (near `setObjectsTransforms`):
```ts
  alignSelected(edge: AlignEdge): void;
  distributeSelected(axis: DistributeAxis): void;
```
Add imports at the top of `store.ts`:
```ts
import { objectAABB } from '../components/Stage/snapping';
import { computeAlign, computeDistribute, type AlignEdge, type DistributeAxis, type AlignItem } from '../components/Stage/align';
```

- [ ] **Step 4: Implement** the actions (place beside `setObjectsTransforms`):
```ts
  alignSelected(edge) {
    const updates = alignItemsUpdates(get(), (items) => computeAlign(items, edge));
    if (updates.length) get().setObjectsTransforms(updates);
  },
  distributeSelected(axis) {
    const updates = alignItemsUpdates(get(), (items) => computeDistribute(items, axis));
    if (updates.length) get().setObjectsTransforms(updates);
  },
```
And a module-scope helper near `groupMatesOf`:
```ts
function alignItemsUpdates(
  s: EditorState,
  fn: (items: AlignItem[]) => { id: string; x?: number; y?: number }[],
): { id: string; x?: number; y?: number }[] {
  if (!s.autoKey) return [];
  const project = s.history.present;
  const time = snapToFrame(s.time, project.meta.fps);
  const items: AlignItem[] = [];
  for (const id of s.selectedObjectIds) {
    const o = project.objects.find((x) => x.id === id);
    if (!o || o.locked || o.hidden) continue; // excluded from bbox AND writes
    const a = objectAABB(o, project.assets.find((as) => as.id === o.assetId), time);
    if (!a) continue;
    const st = sampleObject(o, time);
    items.push({ id, aabb: a, x: st.x, y: st.y });
  }
  return fn(items);
}
```
(`setObjectsTransforms` snaps internally to the same frame, so the deltas stay consistent. `snapToFrame` and `sampleObject` are already imported in `store.ts`.)

- [ ] **Step 5: Run** the store tests → PASS. Re-run `pnpm vitest run src/ui/components/Stage/align.test.ts` (unaffected).

- [ ] **Step 6: Commit** `feat(slice43): alignSelected/distributeSelected store actions`.

---

### Task 4: Inspector align/distribute buttons

**Files:**
- Modify: `src/ui/components/Inspector/Inspector.tsx`
- Test: `src/ui/components/Inspector/Inspector.test.tsx`

**Interfaces:**
- Consumes: `alignSelected`, `distributeSelected` (Task 3).

- [ ] **Step 1: Failing test** in `Inspector.test.tsx`:
```ts
it('multi-state aligns and gates Distribute on >=3 (slice 43)', () => {
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  const a = useEditor.getState().selectedObjectId!;
  useEditor.getState().addVectorShape('rect', { x: 60, y: 0, width: 10, height: 10 });
  const b = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectObjects([a, b]);
  const { rerender } = render(<Inspector />);
  expect(screen.getByRole('button', { name: 'Distribute horizontally' })).toBeDisabled(); // 2 selected
  fireEvent.click(screen.getByRole('button', { name: 'Align left' }));
  // both objects' x tracks now keyframed; b moved left toward a
  const xb = useEditor.getState().history.present.objects.find((o) => o.id === b)!.tracks.x;
  expect(xb && xb.length).toBeGreaterThan(0);
  useEditor.getState().addVectorShape('rect', { x: 120, y: 0, width: 10, height: 10 });
  const c = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectObjects([a, b, c]);
  rerender(<Inspector />);
  expect(screen.getByRole('button', { name: 'Distribute horizontally' })).toBeEnabled(); // 3 selected
});
```

- [ ] **Step 2: Run** `pnpm vitest run src/ui/components/Inspector/Inspector.test.tsx` → FAIL.

- [ ] **Step 3: Implement.** Add `alignSelected, distributeSelected` to the `useEditor.getState()` destructure. Replace the multi-state `return` block to add an align/distribute row (keep Group/Ungroup/Duplicate/Delete):
```tsx
  if (selectedIds.length > 1) {
    const someGrouped = selectedIds.some((id) => objects.find((o) => o.id === id)?.groupId);
    const canDistribute = selectedIds.length >= 3;
    return (
      <div className={styles.panel}>
        <div className={styles.row}>{selectedIds.length} objects selected</div>
        <div className={styles.row}>
          <button aria-label="Align left" onClick={() => alignSelected('left')}>⇤</button>
          <button aria-label="Align horizontal centers" onClick={() => alignSelected('hcenter')}>⇔</button>
          <button aria-label="Align right" onClick={() => alignSelected('right')}>⇥</button>
          <button aria-label="Align top" onClick={() => alignSelected('top')}>⤒</button>
          <button aria-label="Align vertical centers" onClick={() => alignSelected('vcenter')}>⇕</button>
          <button aria-label="Align bottom" onClick={() => alignSelected('bottom')}>⤓</button>
          <button aria-label="Distribute horizontally" disabled={!canDistribute} onClick={() => distributeSelected('h')}>↔</button>
          <button aria-label="Distribute vertically" disabled={!canDistribute} onClick={() => distributeSelected('v')}>↕</button>
        </div>
        <div className={styles.row}>
          <button onClick={() => groupSelected()}>Group</button>
          {someGrouped && <button onClick={() => ungroupSelected()}>Ungroup</button>}
          <button onClick={() => duplicateSelected()}>Duplicate</button>
          <button onClick={() => deleteSelectedObject()}>Delete</button>
        </div>
      </div>
    );
  }
```

- [ ] **Step 4: Run** the test → PASS.

- [ ] **Step 5: Commit** `feat(slice43): Inspector align/distribute buttons`.

---

### Task 5: e2e + full gate

**Files:**
- Create: `e2e/align-distribute.spec.ts`

- [ ] **Step 1: Write** `e2e/align-distribute.spec.ts` modeled on `e2e/multi-move.spec.ts`: draw 3 rects at different x AND y; select all (click first, Shift-click the other two); click "Align top" → assert the three `boundingBox().y` are within ~2px of each other; then click "Distribute horizontally" → read the three boxes sorted by x and assert the two gaps (next.x − prev.x − prev.width) are within ~2px. Use `page.getByRole('button', { name: 'Align top' })` etc.

- [ ] **Step 2: Run** `pnpm exec playwright test e2e/align-distribute.spec.ts` → PASS. Debug coordinate/testid issues against `multi-move.spec.ts`.

- [ ] **Step 3: Full gate** — `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test` → all green.

- [ ] **Step 4: Commit** `test(e2e): align 3 rects to a top edge, then distribute horizontally`.

---

## Self-Review (post-write)

- **Spec coverage:** refactor (T1) ✓; 6 align + 2 distribute geometry (T2) ✓; store actions w/ autoKey gate + locked/hidden exclusion + frame-snap (T3) ✓; Inspector buttons + distribute≥3 gate (T4) ✓; e2e (T5) ✓.
- **Type consistency:** `AlignEdge`/`DistributeAxis`/`AlignItem` defined in `align.ts` (T2), imported unchanged by the store (T3); `computeAlign`/`computeDistribute` signatures match across producer and consumers; `objectAABB` exported in T1 and imported in T3 + tests.
- **No placeholders:** all geometry + action code is concrete; test factory/`setAutoKey` name confirmations are explicit "grep the real name" notes (the helpers exist).
- **Deferred (per spec §6):** key-object/artboard align; distribute-by-centers; spacing input; group-as-unit align; align guides.
