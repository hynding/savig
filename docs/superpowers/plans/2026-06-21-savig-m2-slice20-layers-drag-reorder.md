# Slice 20 Layers Drag-to-Reorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user reorder objects by dragging a row up/down in the Layers panel (native HTML5 drag-and-drop), reassigning z-order.

**Architecture:** A pure `moveObjectToTarget(objects, draggedId, targetId)` in `engine/reorder.ts` (sibling to `reorderObjects`) computes the new front-first order — direction-aware (drag down → below target, up → above) — and reassigns contiguous z-orders, returning the same array ref on no-op. A thin store action wraps it with the existing commit-if-changed pattern. The Layers panel makes rows `draggable` and wires `onDragStart/onDragOver/onDrop` to call the action; the drop target is the event target, so the wiring is unit-testable.

**Tech Stack:** TypeScript (strict), React 18, Zustand, Vitest + RTL, Playwright.

## Global Constraints

- TypeScript strict; no `any`. Match surrounding code style.
- The panel is **front-first** (highest `zOrder` at the top). `moveObjectToTarget` is direction-aware: dragging a row **down** onto a target lands it just **below** the target; **up** lands it just **above**. Z-orders are reassigned **contiguous 0..N-1** (front = highest), and the function returns the **SAME `objects` reference** on no-op (same id, unknown id, N < 2, or order unchanged) — mirroring `reorderObjects`.
- Editor-only: `zOrder` already persists/undoes — NO render/export/runtime/migration change, stays v4.
- Locked rows and a row being renamed are **not** draggable; locked rows CAN be drop targets.
- The store action makes **no selection change**.
- Run the full gate before declaring done: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`.

---

### Task 1: Engine — `moveObjectToTarget` (pure)

**Files:**
- Modify: `src/engine/reorder.ts`
- Test: `src/engine/reorder.test.ts`

**Interfaces:**
- Produces: `moveObjectToTarget(objects: SceneObject[], draggedId: string, targetId: string): SceneObject[]` (exported; auto-re-exported via the existing `export * from './reorder'` in `src/engine/index.ts`).

- [ ] **Step 1: Write the failing tests**

The existing `reorder.test.ts` builds a stack with `createSceneObject('asset', { id, zOrder })` and a `zById` helper that maps id→zOrder. Append:

```ts
describe('moveObjectToTarget', () => {
  // stack(): a:z0 (back), b:z1, c:z2 (front).  front-first panel = [c, b, a]
  it('dragging the back object UP onto the front makes it front-most', () => {
    expect(zById(moveObjectToTarget(stack(), 'a', 'c'))).toEqual({ a: 2, b: 0, c: 1 });
  });
  it('dragging the front object DOWN onto the back makes it back-most', () => {
    expect(zById(moveObjectToTarget(stack(), 'c', 'a'))).toEqual({ a: 1, b: 2, c: 0 });
  });
  it('dragging onto an adjacent neighbour swaps them', () => {
    // drag a (back) up onto b: a lands above b -> panel [c, a, b]
    expect(zById(moveObjectToTarget(stack(), 'a', 'b'))).toEqual({ a: 1, b: 0, c: 2 });
  });
  it('returns the same reference for a no-op (same id / unknown id)', () => {
    const s = stack();
    expect(moveObjectToTarget(s, 'a', 'a')).toBe(s);
    expect(moveObjectToTarget(s, 'nope', 'a')).toBe(s);
    expect(moveObjectToTarget(s, 'a', 'nope')).toBe(s);
  });
});
```

> Verify the expected z-orders by hand:
> - `move(a,c)`: panel `[c,b,a]`; di=2,ti=0; di<ti false → insert a at indexOf(c)=0 → `[a,c,b]`; zOrder = (n-1-index): a=2,c=1,b=0. ✓
> - `move(c,a)`: panel `[c,b,a]`; di=0,ti=2; di<ti true → remove c → `[b,a]`, insert at indexOf(a)+1=2 → `[b,a,c]`; b=2,a=1,c=0. ✓
> - `move(a,b)`: panel `[c,b,a]`; di=2,ti=1; di<ti false → remove a → `[c,b]`, insert at indexOf(b)=1 → `[c,a,b]`; c=2,a=1,b=0. ✓

Check whether `reorder.test.ts` imports `moveObjectToTarget`; if not, add it to the existing import line: `import { reorderObjects, moveObjectToTarget } from './reorder';`.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/engine/reorder.test.ts -t "moveObjectToTarget"`
Expected: FAIL — `moveObjectToTarget` is not exported.

- [ ] **Step 3: Implement the helper**

Append to `src/engine/reorder.ts` (after `reorderObjects`):

```ts
/** Move `draggedId` to `targetId`'s slot in the z-stack, displaced in the drag
 *  direction: dragging down (dragged was above the target in the front-first panel)
 *  lands it just below the target; dragging up lands it just above. Reassigns
 *  contiguous zOrders (0..N-1). Returns the SAME `objects` reference for a no-op
 *  (same id, unknown id, N < 2, or the resulting order is unchanged). */
export function moveObjectToTarget(
  objects: SceneObject[],
  draggedId: string,
  targetId: string,
): SceneObject[] {
  if (objects.length < 2 || draggedId === targetId) return objects;
  const panel = [...objects].sort((a, b) => b.zOrder - a.zOrder).map((o) => o.id); // front-first
  const di = panel.indexOf(draggedId);
  const ti = panel.indexOf(targetId);
  if (di === -1 || ti === -1) return objects;
  const before = panel.join(' ');
  panel.splice(di, 1);
  const t = panel.indexOf(targetId);
  panel.splice(di < ti ? t + 1 : t, 0, draggedId); // down -> below target; up -> above
  if (panel.join(' ') === before) return objects; // order unchanged -> no-op
  const n = panel.length;
  const zById = new Map(panel.map((id, i) => [id, n - 1 - i] as const));
  return objects.map((o) => ({ ...o, zOrder: zById.get(o.id)! }));
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm vitest run src/engine/reorder.test.ts -t "moveObjectToTarget"`
Expected: PASS (all 4).

- [ ] **Step 5: Commit**

```bash
git add src/engine/reorder.ts src/engine/reorder.test.ts
git commit -m "feat(slice20): pure moveObjectToTarget (direction-aware drag reorder)"
```

---

### Task 2: Store — `moveObjectToTarget(draggedId, targetId)`

**Files:**
- Modify: `src/ui/store/store.ts`
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Consumes: engine `moveObjectToTarget` (Task 1).
- Produces: action `moveObjectToTarget(draggedId: string, targetId: string): void`.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/store/store.test.ts`:

```ts
describe('moveObjectToTarget (store)', () => {
  it('reorders so the dragged object becomes front-most and commits one step', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 }); // A: z0 (back)
    const a = useEditor.getState().selectedObjectId!;
    useEditor.getState().addVectorShape('rect', { x: 20, y: 20, width: 10, height: 10 }); // B: z1 (front)
    const b = useEditor.getState().selectedObjectId!;
    const past = useEditor.getState().history.past.length;
    useEditor.getState().moveObjectToTarget(a, b); // drag A up onto B -> A front
    const objs = useEditor.getState().history.present.objects;
    const za = objs.find((o) => o.id === a)!.zOrder;
    const zb = objs.find((o) => o.id === b)!.zOrder;
    expect(za).toBeGreaterThan(zb); // A now in front of B
    expect(useEditor.getState().history.past.length).toBe(past + 1); // exactly one commit
    expect(useEditor.getState().selectedObjectId).toBe(b); // selection unchanged
  });
  it('is a no-op (no commit) for the same id', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const a = useEditor.getState().selectedObjectId!;
    useEditor.getState().addVectorShape('rect', { x: 20, y: 20, width: 10, height: 10 });
    const past = useEditor.getState().history.past.length;
    useEditor.getState().moveObjectToTarget(a, a);
    expect(useEditor.getState().history.past.length).toBe(past);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/ui/store/store.test.ts -t "moveObjectToTarget"`
Expected: FAIL — store `moveObjectToTarget` undefined.

- [ ] **Step 3: Add the import alias, interface entry, and action**

In `src/ui/store/store.ts`:

1. The engine barrel import near the top already imports `reorderObjects`. Add the new helper aliased to avoid the name clash with the action:

```ts
  reorderObjects,
  moveObjectToTarget as moveObjectToTargetPure,
```

2. In the actions interface, after `reorderSelected(op: ReorderOp): void;`:

```ts
  moveObjectToTarget(draggedId: string, targetId: string): void;
```

3. Add the action immediately after `reorderSelected`:

```ts
  moveObjectToTarget(draggedId, targetId) {
    const project = get().history.present;
    const objects = moveObjectToTargetPure(project.objects, draggedId, targetId);
    if (objects === project.objects) return; // no-op -> no commit
    get().commit({ ...project, objects });
  },
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm vitest run src/ui/store/store.test.ts -t "moveObjectToTarget"`
Expected: PASS (both).

- [ ] **Step 5: Commit**

```bash
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(slice20): store moveObjectToTarget action (commit-if-changed)"
```

---

### Task 3: Layers panel HTML5 drag-and-drop + e2e

**Files:**
- Modify: `src/ui/components/LayersPanel/LayersPanel.tsx`
- Modify: `src/ui/components/LayersPanel/LayersPanel.module.css`
- Test: `src/ui/components/LayersPanel/LayersPanel.test.tsx`
- Create: `e2e/reorder-drag.spec.ts`

**Interfaces:**
- Consumes: store `moveObjectToTarget` (Task 2).

- [ ] **Step 1: Write the failing panel tests**

Append to `src/ui/components/LayersPanel/LayersPanel.test.tsx` (the file already imports `fireEvent`? if not, add it: `import { fireEvent, render, screen } from '@testing-library/react';`):

```ts
it('dragging the back row onto the front row reorders the objects', () => {
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 }); // A back
  const a = useEditor.getState().selectedObjectId!;
  useEditor.getState().addVectorShape('rect', { x: 20, y: 20, width: 10, height: 10 }); // B front
  const b = useEditor.getState().selectedObjectId!;
  render(<LayersPanel />);
  fireEvent.dragStart(screen.getByTestId(`layer-${a}`));
  fireEvent.dragOver(screen.getByTestId(`layer-${b}`));
  fireEvent.drop(screen.getByTestId(`layer-${b}`));
  const objs = useEditor.getState().history.present.objects;
  expect(objs.find((o) => o.id === a)!.zOrder).toBeGreaterThan(objs.find((o) => o.id === b)!.zOrder);
});

it('a locked row is not draggable', () => {
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  const id = useEditor.getState().selectedObjectId!;
  useEditor.getState().toggleObjectLock(id);
  render(<LayersPanel />);
  expect(screen.getByTestId(`layer-${id}`).getAttribute('draggable')).toBe('false');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/ui/components/LayersPanel/LayersPanel.test.tsx -t "drag\|draggable"`
Expected: FAIL — rows have no drag handlers / `draggable` attr.

- [ ] **Step 3: Add the DnD state + handlers**

In `src/ui/components/LayersPanel/LayersPanel.tsx`:

1. Destructure the new action:

```ts
  const { selectObject, toggleObjectVisibility, renameObject, toggleObjectLock, moveObjectToTarget } = useEditor.getState();
```

2. Add drag state alongside the rename state:

```ts
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
```

3. Update the row `<div>` opening tag. It currently is:

```tsx
          <div
            key={o.id}
            data-testid={`layer-${o.id}`}
            data-selected={o.id === selectedId}
            className={`${styles.row} ${o.id === selectedId ? styles.selected : ''} ${o.hidden ? styles.hidden : ''} ${o.locked ? styles.locked : ''}`}
            onClick={() => {
              if (!o.locked) selectObject(o.id);
            }}
          >
```

Replace it with (adds `draggable` + 4 DnD handlers + the dropTarget class):

```tsx
          <div
            key={o.id}
            data-testid={`layer-${o.id}`}
            data-selected={o.id === selectedId}
            className={`${styles.row} ${o.id === selectedId ? styles.selected : ''} ${o.hidden ? styles.hidden : ''} ${o.locked ? styles.locked : ''} ${o.id === dropTargetId ? styles.dropTarget : ''}`}
            draggable={!o.locked && editingId !== o.id}
            onClick={() => {
              if (!o.locked) selectObject(o.id);
            }}
            onDragStart={(e) => {
              setDragId(o.id);
              if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(e) => {
              if (dragId && dragId !== o.id) {
                e.preventDefault();
                setDropTargetId(o.id);
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragId) moveObjectToTarget(dragId, o.id);
              setDragId(null);
              setDropTargetId(null);
            }}
            onDragEnd={() => {
              setDragId(null);
              setDropTargetId(null);
            }}
          >
```

- [ ] **Step 4: Add the drop-indicator CSS**

In `src/ui/components/LayersPanel/LayersPanel.module.css`, after the `.locked` rule:

```css
.dropTarget { box-shadow: inset 0 2px 0 0 var(--color-accent); }
```

- [ ] **Step 5: Run to verify the panel tests pass**

Run: `pnpm vitest run src/ui/components/LayersPanel/LayersPanel.test.tsx`
Expected: PASS (2 new + all existing list/select/visibility/rename/lock tests).

- [ ] **Step 6: Write the e2e**

Create `e2e/reorder-drag.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('drag a layer row to reorder objects', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Draw two rects: the second-drawn is front-most, so it is the FIRST (top) row.
  const rectTool = page
    .getByRole('group', { name: 'Tools' })
    .getByRole('button', { name: 'Rectangle', exact: true });
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  for (const [dx, dy] of [
    [60, 60],
    [200, 160],
  ]) {
    await rectTool.click();
    await page.mouse.move(box.x + dx, box.y + dy);
    await page.mouse.down();
    await page.mouse.move(box.x + dx + 80, box.y + dy + 60);
    await page.mouse.up();
  }

  const rows = page.locator('section[aria-label="Assets"] [data-testid^="layer-"]');
  await expect(rows).toHaveCount(2);
  const topId = (await rows.nth(0).getAttribute('data-testid'))!; // front-most (second-drawn)
  const bottomRow = rows.nth(1); // back (first-drawn)
  const bottomId = (await bottomRow.getAttribute('data-testid'))!;

  // Drag the bottom (back) row UP onto the top (front) row -> the back object becomes front.
  await bottomRow.dragTo(rows.nth(0));

  // The first row is now the previously-bottom object.
  await expect(rows.nth(0)).toHaveAttribute('data-testid', bottomId);
  await expect(rows.nth(1)).toHaveAttribute('data-testid', topId);
});
```

- [ ] **Step 7: Run the e2e**

Run: `pnpm exec playwright test e2e/reorder-drag.spec.ts`
Expected: PASS.

> If `dragTo` does not trigger the native HTML5 drag in headless Chromium, fall back to a manual sequence: `await bottomRow.hover(); await page.mouse.down(); await rows.nth(0).hover(); await rows.nth(0).hover(); await page.mouse.up();` — but try `dragTo` first.

- [ ] **Step 8: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add src/ui/components/LayersPanel/ e2e/reorder-drag.spec.ts
git commit -m "feat(slice20): LayersPanel drag-to-reorder rows + e2e"
```

---

## Self-Review (plan vs spec)

- **§2 pure `moveObjectToTarget` (direction-aware, contiguous z, same-ref no-op)** → Task 1 + 4 engine tests (worked z-order values verified by hand). ✅
- **§3 store action (commit-if-changed, no selection change)** → Task 2 + 2 store tests (incl. selection-unchanged + one-commit + same-id no-op). ✅
- **§4 panel HTML5 DnD (draggable gated on !locked && !editing; dragStart/Over/Drop/End; dropTarget class; dataTransfer guarded)** → Task 3 Step 3 + the drag-reorder + locked-not-draggable panel tests. ✅
- **§5 `.dropTarget` CSS** → Task 3 Step 4. ✅
- **§6 editor-only (no render/export/runtime/migration)** → only `engine/reorder.ts`, store, LayersPanel + one e2e touched. ✅
- **§9 testing (engine ×4, store ×2, panel ×2, e2e)** → Tasks 1–3. ✅
- **Type/name consistency:** engine `moveObjectToTarget(objects, draggedId, targetId)` vs store action `moveObjectToTarget(draggedId, targetId)` disambiguated via the `moveObjectToTargetPure` import alias (Task 2 Step 3.1); the store action name and the panel call match. testids reuse the existing `layer-<id>`. ✅
- **Placeholder scan:** every step has concrete code; the e2e `dragTo` has a documented manual fallback; selectors mirror existing specs. ✅
