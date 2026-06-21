# Slice 16 Reorder Objects (z-order) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user change an object's stacking order (to front / forward / backward / to back) via Inspector buttons or keyboard shortcuts.

**Architecture:** A pure `reorderObjects(objects, id, op)` helper moves the object within the z-stack and reassigns contiguous `zOrder` 0..N-1 (returning the same array ref for no-ops); a thin `reorderSelected(op)` store action calls it and commits. The Stage already re-sorts by `zOrder`, so the visual order updates automatically. No engine-pipeline/render/runtime/export/persistence change.

**Tech Stack:** TypeScript (strict), Vitest + RTL, Playwright; the existing `src/engine` core + `src/ui` store/Inspector/keyboard.

## Global Constraints

- TypeScript strict; no `any`. Match surrounding code style.
- Stacking = `zOrder` (the Stage renders `[...objects].sort((a,b) => a.zOrder - b.zOrder)`; higher `zOrder` = front). Reorder rewrites `zOrder` values.
- Each reorder reassigns CONTIGUOUS `zOrder` 0..N-1 in the new order (normalizes gaps; keeps `nextZOrder = max+1` correct). The objects ARRAY order is unchanged — only `zOrder` fields are rewritten.
- `reorderObjects` returns the SAME `objects` reference for a no-op (unknown id, N < 2, or already at the requested extreme), so the store skips the commit.
- One undo step per reorder; the selected object stays selected.
- No engine-pipeline/render/runtime/export/persistence change; NO migration (project stays v4).
- Run the full gate before declaring done: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`.

---

### Task 1: Pure helper — `engine/reorder.ts`

**Files:**
- Create: `src/engine/reorder.ts`
- Create: `src/engine/reorder.test.ts`
- Modify: `src/engine/index.ts` (barrel export)

**Interfaces:**
- Consumes: `SceneObject` (from `./types`).
- Produces: `ReorderOp = 'front' | 'forward' | 'backward' | 'back'`; `reorderObjects(objects: SceneObject[], id: string, op: ReorderOp): SceneObject[]`.

- [ ] **Step 1: Write the failing test**

Create `src/engine/reorder.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { reorderObjects } from './reorder';
import { createSceneObject } from './project';

const stack = () => [
  createSceneObject('asset', { id: 'a', zOrder: 0 }),
  createSceneObject('asset', { id: 'b', zOrder: 1 }),
  createSceneObject('asset', { id: 'c', zOrder: 2 }),
];
const zById = (objs: ReturnType<typeof stack>) => Object.fromEntries(objs.map((o) => [o.id, o.zOrder]));

describe('reorderObjects', () => {
  it('forward swaps the object with the next-higher one', () => {
    expect(zById(reorderObjects(stack(), 'a', 'forward'))).toEqual({ a: 1, b: 0, c: 2 });
  });
  it('backward swaps with the next-lower one', () => {
    expect(zById(reorderObjects(stack(), 'c', 'backward'))).toEqual({ a: 0, b: 2, c: 1 });
  });
  it('front moves the object to the top', () => {
    expect(zById(reorderObjects(stack(), 'a', 'front'))).toEqual({ a: 2, b: 0, c: 1 });
  });
  it('back moves the object to the bottom', () => {
    expect(zById(reorderObjects(stack(), 'c', 'back'))).toEqual({ a: 1, b: 2, c: 0 });
  });
  it('preserves the array element order (only zOrder changes)', () => {
    const result = reorderObjects(stack(), 'a', 'front');
    expect(result.map((o) => o.id)).toEqual(['a', 'b', 'c']);
  });
  it('returns the same reference for no-ops (already at the extreme, unknown id, N<2)', () => {
    const s = stack();
    expect(reorderObjects(s, 'c', 'forward')).toBe(s); // already front
    expect(reorderObjects(s, 'a', 'backward')).toBe(s); // already back
    expect(reorderObjects(s, 'a', 'front')).not.toBe(s); // real change
    expect(reorderObjects(s, 'nope', 'front')).toBe(s); // unknown id
    const one = [createSceneObject('asset', { id: 'a', zOrder: 0 })];
    expect(reorderObjects(one, 'a', 'front')).toBe(one); // N<2
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/engine/reorder.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `reorder.ts`**

Create `src/engine/reorder.ts`:

```ts
import type { SceneObject } from './types';

export type ReorderOp = 'front' | 'forward' | 'backward' | 'back';

/** Reorder `id` within the z-stack; return a new objects array with contiguous
 *  zOrders (0..N-1) in the new order. The array element order is preserved; only
 *  each object's `zOrder` is rewritten. Returns the SAME `objects` reference for a
 *  no-op (unknown id, N < 2, or already at the requested extreme). */
export function reorderObjects(objects: SceneObject[], id: string, op: ReorderOp): SceneObject[] {
  if (objects.length < 2) return objects;
  const order = [...objects].sort((a, b) => a.zOrder - b.zOrder);
  const idx = order.findIndex((o) => o.id === id);
  if (idx === -1) return objects;
  const last = order.length - 1;
  let next: SceneObject[];
  if (op === 'forward') {
    if (idx >= last) return objects;
    next = [...order];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
  } else if (op === 'backward') {
    if (idx <= 0) return objects;
    next = [...order];
    [next[idx], next[idx - 1]] = [next[idx - 1], next[idx]];
  } else if (op === 'front') {
    if (idx >= last) return objects;
    next = [...order.slice(0, idx), ...order.slice(idx + 1), order[idx]];
  } else {
    // back
    if (idx <= 0) return objects;
    next = [order[idx], ...order.slice(0, idx), ...order.slice(idx + 1)];
  }
  const zById = new Map(next.map((o, z) => [o.id, z] as const));
  return objects.map((o) => ({ ...o, zOrder: zById.get(o.id)! }));
}
```

- [ ] **Step 4: Add the barrel export**

In `src/engine/index.ts`, add next to the other top-level re-exports (e.g. after `export * from './removeObject';`):

```ts
export * from './reorder';
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm vitest run src/engine/reorder.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/engine/reorder.ts src/engine/reorder.test.ts src/engine/index.ts
git commit -m "feat(slice16): reorderObjects pure helper (z-stack move + contiguous zOrder)"
```

---

### Task 2: Store — `reorderSelected(op)`

**Files:**
- Modify: `src/ui/store/store.ts`
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Consumes: `reorderObjects`, `ReorderOp` (Task 1, via the engine barrel).
- Produces: action `reorderSelected(op: ReorderOp): void`.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/store/store.test.ts`:

```ts
describe('reorderSelected', () => {
  it('sends the selected front object to the back (one undo step)', () => {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 }); // zOrder 0
    s.addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 }); // zOrder 1 (selected, front)
    const front = useEditor.getState().selectedObjectId!;
    useEditor.getState().reorderSelected('back');
    const objsById = Object.fromEntries(
      useEditor.getState().history.present.objects.map((o) => [o.id, o.zOrder]),
    );
    expect(objsById[front]).toBe(0); // now at the back
    expect(useEditor.getState().selectedObjectId).toBe(front); // still selected

    useEditor.getState().undo();
    const after = useEditor.getState().history.present.objects.find((o) => o.id === front)!;
    expect(after.zOrder).toBe(1); // restored
  });

  it('is a no-op when nothing is selected or already at the extreme', () => {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const past = useEditor.getState().history.past.length;
    useEditor.getState().reorderSelected('front'); // single object -> no-op
    expect(useEditor.getState().history.past.length).toBe(past); // no new history entry
    s.selectObject(null);
    useEditor.getState().reorderSelected('back'); // nothing selected -> no-op
    expect(useEditor.getState().history.past.length).toBe(past);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/ui/store/store.test.ts -t "reorderSelected"`
Expected: FAIL — `reorderSelected` undefined.

- [ ] **Step 3: Add the import + interface entry + action**

In `src/ui/store/store.ts`:

1. Add `reorderObjects` to the engine import group, and `ReorderOp` to the engine type import group (`import type { … } from '../../engine'`).
2. In the actions interface, after `deleteSelectedObject(): void;`:

```ts
  reorderSelected(op: ReorderOp): void;
```
3. Add the action near `deleteSelectedObject`:

```ts
  reorderSelected(op) {
    const id = get().selectedObjectId;
    if (id == null) return;
    const project = get().history.present;
    const objects = reorderObjects(project.objects, id, op);
    if (objects === project.objects) return; // no-op -> no commit
    get().commit({ ...project, objects });
  },
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm vitest run src/ui/store/store.test.ts -t "reorderSelected"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(slice16): store reorderSelected (one undo step, no-op at extremes)"
```

---

### Task 3: UI — Inspector buttons + keyboard shortcuts

**Files:**
- Modify: `src/ui/components/Inspector/Inspector.tsx`
- Modify: `src/ui/hooks/useKeyboard.ts`
- Test: `src/ui/components/Inspector/Inspector.test.tsx`, `src/ui/hooks/useKeyboard.test.ts`

**Interfaces:**
- Consumes: `reorderSelected` (Task 2).
- Produces: four Inspector reorder buttons; `Cmd/Ctrl+]`/`[` (+Shift) reorder shortcuts.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/components/Inspector/Inspector.test.tsx`:

```ts
it('the To Back button lowers the selected object zOrder', async () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 }); // zOrder 0
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 }); // zOrder 1 (selected)
  const front = useEditor.getState().selectedObjectId!;
  render(<Inspector />);
  await userEvent.click(screen.getByRole('button', { name: /to back/i }));
  const obj = useEditor.getState().history.present.objects.find((o) => o.id === front)!;
  expect(obj.zOrder).toBe(0);
});
```

Append to `src/ui/hooks/useKeyboard.test.ts`:

```ts
it('Cmd/Ctrl+] brings the selected object forward', () => {
  const s = useEditor.getState();
  s.newProject();
  s.addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 }); // zOrder 0
  s.addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 }); // zOrder 1
  const back = useEditor.getState().history.present.objects[0].id;
  useEditor.getState().selectObject(back); // select the back one (zOrder 0)
  fireEvent.keyDown(window, { key: ']', metaKey: true });
  const obj = useEditor.getState().history.present.objects.find((o) => o.id === back)!;
  expect(obj.zOrder).toBe(1); // moved forward
});

it('Cmd/Ctrl+Shift+[ sends the selected object to the back', () => {
  const s = useEditor.getState();
  s.newProject();
  s.addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  s.addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  const front = useEditor.getState().selectedObjectId!; // zOrder 1
  fireEvent.keyDown(window, { key: '{', metaKey: true, shiftKey: true }); // Shift+[ -> '{'
  const obj = useEditor.getState().history.present.objects.find((o) => o.id === front)!;
  expect(obj.zOrder).toBe(0); // to back
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/ui/components/Inspector/Inspector.test.tsx src/ui/hooks/useKeyboard.test.ts`
Expected: FAIL — no reorder buttons; the bracket keys do nothing.

- [ ] **Step 3: Add the Inspector buttons**

In `src/ui/components/Inspector/Inspector.tsx`:

1. Add `reorderSelected` to the destructured `useEditor.getState()` actions (beside `duplicateSelected`/`deleteSelectedObject`).
2. After the Duplicate/Delete row, add a reorder row:

```tsx
        <div className={styles.row}>
          <button onClick={() => reorderSelected('back')}>To Back</button>
          <button onClick={() => reorderSelected('backward')}>Backward</button>
          <button onClick={() => reorderSelected('forward')}>Forward</button>
          <button onClick={() => reorderSelected('front')}>To Front</button>
        </div>
```

- [ ] **Step 4: Add the keyboard shortcuts**

In `src/ui/hooks/useKeyboard.ts`, after the `mod && (e.key === 'd' || e.key === 'D')` block, add:

```ts
      if (mod && (e.key === ']' || e.key === '}')) {
        e.preventDefault();
        s.reorderSelected(e.shiftKey ? 'front' : 'forward');
        return;
      }
      if (mod && (e.key === '[' || e.key === '{')) {
        e.preventDefault();
        s.reorderSelected(e.shiftKey ? 'back' : 'backward');
        return;
      }
```

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm vitest run src/ui/components/Inspector/Inspector.test.tsx src/ui/hooks/useKeyboard.test.ts`
Expected: PASS.

- [ ] **Step 6: Gate + commit**

Run: `pnpm vitest run && pnpm typecheck && pnpm lint`
Expected: all green.

```bash
git add src/ui/components/Inspector/Inspector.tsx src/ui/hooks/useKeyboard.ts src/ui/components/Inspector/Inspector.test.tsx src/ui/hooks/useKeyboard.test.ts
git commit -m "feat(slice16): Inspector reorder buttons + Cmd/Ctrl+[/] shortcuts"
```

---

### Task 4: End-to-end — To Back changes the stacking order

**Files:**
- Create: `e2e/reorder-objects.spec.ts`

**Interfaces:**
- Consumes: the whole feature.

- [ ] **Step 1: Write the e2e**

Create `e2e/reorder-objects.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('To Back moves the selected object below the others', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Draw two overlapping rects (the 2nd is selected and on top = last in DOM).
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  const rectTool = page.getByRole('group', { name: 'Tools' }).getByRole('button', { name: 'Rectangle', exact: true });
  for (const [dx, dy] of [
    [100, 100],
    [130, 130],
  ]) {
    await rectTool.click();
    await page.mouse.move(box.x + dx, box.y + dy);
    await page.mouse.down();
    await page.mouse.move(box.x + dx + 80, box.y + dy + 60);
    await page.mouse.up();
  }
  await page.getByRole('button', { name: 'Select' }).click();
  await expect(page.locator('[data-savig-object]')).toHaveCount(2);

  const idsBefore = await page.locator('[data-savig-object]').evaluateAll((els) => els.map((e) => e.getAttribute('data-savig-object')));

  // The 2nd rect (last in DOM = front) is selected; send it to the back.
  await page.getByRole('button', { name: /to back/i }).click();

  const idsAfter = await page.locator('[data-savig-object]').evaluateAll((els) => els.map((e) => e.getAttribute('data-savig-object')));
  // The front object (last before) is now first (back).
  expect(idsAfter[0]).toBe(idsBefore[1]);
  expect(idsAfter).toEqual([...idsBefore].reverse());
});
```

- [ ] **Step 2: Run to verify it passes**

Run: `pnpm exec playwright test e2e/reorder-objects.spec.ts`
Expected: PASS.

- [ ] **Step 3: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add e2e/reorder-objects.spec.ts
git commit -m "test(e2e): To Back changes the stacking order"
```

---

## Self-Review (plan vs spec)

- **§2 model (reassign contiguous 0..N-1; array order preserved; same-ref no-op)** → Task 1. ✅
- **§3 pure helper (sort, move per op, reassign; same-ref no-op for unknown/extreme/N<2)** → Task 1. ✅
- **§4 store `reorderSelected` (no-op when unselected; same-ref no-op; one commit; selection kept)** → Task 2. ✅
- **§5 UI (4 Inspector buttons; Cmd/Ctrl+]/[ with Shift = front/back; shifted key codes `}`/`{`)** → Task 3. ✅
- **§6 no persistence/render/runtime/export change** → only `reorder.ts`, `index.ts`, store, Inspector, keyboard, tests, one e2e touched. ✅
- **§7 tests (engine ops + no-ops + permutation; store reorder/no-op/undo; keyboard forward/to-back; Inspector To Back; e2e DOM-order reversal)** → Tasks 1, 2, 3, 4. ✅
- **Type consistency:** `ReorderOp = 'front'|'forward'|'backward'|'back'` + `reorderObjects(objects, id, op): SceneObject[]` identical in Task 1 def + Task 2 call; `reorderSelected(op)` name consistent across store/Inspector/keyboard. ✅
- **Placeholder scan:** all steps carry concrete code; the e2e Tools-group scoping mirrors the Slice-15 fix. ✅
