# Slice 15 Delete Object Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user delete the selected object (pruning its now-orphaned asset) via `Delete`/`Backspace` or an Inspector button, completing the add → duplicate → delete lifecycle.

**Architecture:** A pure `removeObject(project, id)` helper filters the object and prunes its asset when unreferenced; a thin `deleteSelectedObject` store action calls it, commits (one undo step), and clears the selection. A shared `nextZOrder` (max+1) replaces `objects.length` in all creation paths so delete-induced zOrder gaps can't cause collisions. Wired to the Delete-chain (last fallback, after keyframe deletion) and an Inspector button. No engine-pipeline/render/runtime/export/persistence change.

**Tech Stack:** TypeScript (strict), Vitest + RTL, Playwright; the existing `src/engine` core + `src/ui` store/Inspector/keyboard.

## Global Constraints

- TypeScript strict; no `any`. Match surrounding code style.
- Asset pruning: a deleted object's asset is removed **only when no remaining object references it** (vector assets are 1:1 → always pruned; a shared svg asset is kept). Checked against the object list AFTER the target is removed.
- No binary cleanup (only audio assets carry binaries, and audio assets are never referenced by scene objects).
- Object deletion is the LAST fallback in the `Delete`/`Backspace` chain — keyframe/node deletion wins when one is selected.
- Delete is ONE undo step (object + pruned asset restored atomically); `selectObject(null)` is transient (no second history entry).
- `nextZOrder(objects) = max(zOrder) + 1` is used by ALL four creation paths (`addObject`, `addVectorShape`, `addVectorPath`, `duplicateSelected`) so a delete-induced gap can't collide.
- No engine-pipeline/render/runtime/export/persistence change; NO migration (project stays v4).
- Run the full gate before declaring done: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`.

---

### Task 1: Pure helper — `engine/removeObject.ts`

**Files:**
- Create: `src/engine/removeObject.ts`
- Create: `src/engine/removeObject.test.ts`
- Modify: `src/engine/index.ts` (barrel export)

**Interfaces:**
- Consumes: `Project` (from `./types`).
- Produces: `removeObject(project: Project, objectId: string): Project` — removes the object and prunes its asset when unreferenced; returns the SAME reference when the id is not found.

- [ ] **Step 1: Write the failing test**

Create `src/engine/removeObject.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { removeObject } from './removeObject';
import { createProject, createSceneObject, createVectorAsset } from './project';
import type { Project, SvgAsset } from './types';

describe('removeObject', () => {
  it('vector: removes the object and prunes its 1:1 asset', () => {
    const asset = createVectorAsset('rect', { id: 'va' });
    const obj = createSceneObject('va', { id: 'o1' });
    const project: Project = { ...createProject(), assets: [asset], objects: [obj] };
    const next = removeObject(project, 'o1');
    expect(next.objects).toHaveLength(0);
    expect(next.assets).toHaveLength(0); // asset pruned
  });

  it('shared svg asset: removes the object but KEEPS the asset (sibling still uses it)', () => {
    const asset: SvgAsset = { id: 'sa', kind: 'svg', name: 'box', normalizedContent: '<svg/>', viewBox: '0 0 1 1', width: 1, height: 1 };
    const o1 = createSceneObject('sa', { id: 'o1' });
    const o2 = createSceneObject('sa', { id: 'o2' });
    const project: Project = { ...createProject(), assets: [asset], objects: [o1, o2] };
    const next = removeObject(project, 'o1');
    expect(next.objects.map((o) => o.id)).toEqual(['o2']);
    expect(next.assets).toHaveLength(1); // kept, still referenced by o2
  });

  it('unknown id: returns the same project reference (no-op signal)', () => {
    const project = createProject();
    expect(removeObject(project, 'nope')).toBe(project);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/engine/removeObject.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `removeObject.ts`**

Create `src/engine/removeObject.ts`:

```ts
import type { Project } from './types';

/** Remove the object with `objectId`, and prune its asset if no remaining object
 *  references it (vector assets are 1:1 -> always pruned; a shared svg asset is
 *  kept). Returns the SAME project reference when the id is not found. */
export function removeObject(project: Project, objectId: string): Project {
  const obj = project.objects.find((o) => o.id === objectId);
  if (!obj) return project;
  const objects = project.objects.filter((o) => o.id !== objectId);
  const assetStillUsed = objects.some((o) => o.assetId === obj.assetId);
  const assets = assetStillUsed
    ? project.assets
    : project.assets.filter((a) => a.id !== obj.assetId);
  return { ...project, objects, assets };
}
```

- [ ] **Step 4: Add the barrel export**

In `src/engine/index.ts`, add next to the other top-level re-exports (e.g. after `export * from './duplicate';`):

```ts
export * from './removeObject';
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm vitest run src/engine/removeObject.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/engine/removeObject.ts src/engine/removeObject.test.ts src/engine/index.ts
git commit -m "feat(slice15): removeObject pure helper (filter object + prune orphaned asset)"
```

---

### Task 2: Store — `deleteSelectedObject` + shared `nextZOrder`

**Files:**
- Modify: `src/ui/store/store.ts`
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Consumes: `removeObject` (Task 1, via the engine barrel), `selectObject` (existing).
- Produces: action `deleteSelectedObject(): void`; a local `nextZOrder(objects: SceneObject[]): number` used by all four creation paths.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/store/store.test.ts`:

```ts
describe('deleteSelectedObject', () => {
  it('removes a vector object + its asset, clears selection, one undo step', () => {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorShape('rect', { x: 0, y: 0, width: 30, height: 20 });
    expect(useEditor.getState().history.present.objects).toHaveLength(1);
    expect(useEditor.getState().history.present.assets.filter((a) => a.kind === 'vector')).toHaveLength(1);

    useEditor.getState().deleteSelectedObject();
    expect(useEditor.getState().history.present.objects).toHaveLength(0);
    expect(useEditor.getState().history.present.assets.filter((a) => a.kind === 'vector')).toHaveLength(0);
    expect(useEditor.getState().selectedObjectId).toBeNull();

    useEditor.getState().undo(); // one undo restores both
    expect(useEditor.getState().history.present.objects).toHaveLength(1);
  });

  it('is a no-op when nothing is selected', () => {
    const s = useEditor.getState();
    s.newProject();
    s.selectObject(null);
    useEditor.getState().deleteSelectedObject();
    expect(useEditor.getState().history.present.objects).toHaveLength(0);
  });

  it('after deleting a middle object, a new object gets a unique top zOrder', () => {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 }); // zOrder 0
    s.addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 }); // zOrder 1
    s.addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 }); // zOrder 2
    const mid = useEditor.getState().history.present.objects[1].id;
    useEditor.getState().selectObject(mid);
    useEditor.getState().deleteSelectedObject(); // survivors have zOrder 0 and 2 (gap)
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const zs = useEditor.getState().history.present.objects.map((o) => o.zOrder);
    expect(new Set(zs).size).toBe(zs.length); // all unique (no collision)
    expect(Math.max(...zs)).toBe(zs[zs.length - 1]); // the newest is on top
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/ui/store/store.test.ts -t "deleteSelectedObject"`
Expected: FAIL — `deleteSelectedObject` undefined; the zOrder test fails (collision from `objects.length`).

- [ ] **Step 3: Add the `nextZOrder` helper**

In `src/ui/store/store.ts`, near the other module-level helpers (e.g. after `replaceObject`):

```ts
function nextZOrder(objects: SceneObject[]): number {
  return objects.reduce((m, o) => Math.max(m, o.zOrder), -1) + 1;
}
```

- [ ] **Step 4: Use `nextZOrder` in all four creation paths**

Replace each `zOrder: project.objects.length,` in `addObject`, `addVectorShape`, and
`addVectorPath` with:

```ts
      zOrder: nextZOrder(project.objects),
```

And in `duplicateSelected`, replace the inline:

```ts
    const topZOrder = project.objects.reduce((m, o) => Math.max(m, o.zOrder), -1) + 1;
    const placed = { ...object, zOrder: topZOrder };
```

with:

```ts
    const placed = { ...object, zOrder: nextZOrder(project.objects) };
```

- [ ] **Step 5: Add the action + interface entry**

1. Import `removeObject` from the engine (the `from '../../engine'` import group).
2. In the actions interface, after `duplicateSelected(): void;`:

```ts
  deleteSelectedObject(): void;
```
3. Add the action near `duplicateSelected`:

```ts
  deleteSelectedObject() {
    const id = get().selectedObjectId;
    if (id == null) return;
    const project = get().history.present;
    const next = removeObject(project, id);
    if (next === project) return; // unknown id -> no-op
    get().commit(next);
    get().selectObject(null);
  },
```

- [ ] **Step 6: Run to verify they pass**

Run: `pnpm vitest run src/ui/store/store.test.ts`
Expected: PASS (new delete tests + the zOrder regression + no regressions in the duplicate/add tests).

- [ ] **Step 7: Commit**

```bash
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(slice15): store deleteSelectedObject + shared nextZOrder (no zOrder collisions)"
```

---

### Task 3: UI — Delete-chain fallback + Inspector "Delete" button

**Files:**
- Modify: `src/ui/hooks/useKeyboard.ts`
- Modify: `src/ui/components/Inspector/Inspector.tsx`
- Test: `src/ui/hooks/useKeyboard.test.ts`, `src/ui/components/Inspector/Inspector.test.tsx`

**Interfaces:**
- Consumes: `deleteSelectedObject` (Task 2).
- Produces: `Delete`/`Backspace` deletes the selected object when no keyframe/node is selected; an Inspector "Delete" button.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/hooks/useKeyboard.test.ts`:

```ts
it('Delete removes the selected object when no keyframe is selected', () => {
  const s = useEditor.getState();
  s.newProject();
  s.addVectorShape('rect', { x: 0, y: 0, width: 20, height: 20 });
  s.setActiveTool('select');
  expect(useEditor.getState().history.present.objects).toHaveLength(1);
  fireEvent.keyDown(window, { key: 'Delete' });
  expect(useEditor.getState().history.present.objects).toHaveLength(0);
});

it('Delete removes a selected keyframe, NOT the object', () => {
  const s = useEditor.getState();
  s.newProject();
  s.addVectorShape('rect', { x: 0, y: 0, width: 20, height: 20 });
  s.seek(1);
  s.setProperty('x', 50); // creates a scalar keyframe at t=1
  const id = useEditor.getState().selectedObjectId!;
  useEditor.getState().setActiveTool('select');
  useEditor.getState().selectKeyframe({ objectId: id, property: 'x', time: 1 });
  fireEvent.keyDown(window, { key: 'Delete' });
  expect(useEditor.getState().history.present.objects).toHaveLength(1); // object kept
  expect(useEditor.getState().history.present.objects[0].tracks.x ?? []).toHaveLength(0); // keyframe gone
});
```

Append to `src/ui/components/Inspector/Inspector.test.tsx`:

```ts
it('the Delete button removes the selected object', async () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 30, height: 20 });
  render(<Inspector />);
  await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));
  expect(useEditor.getState().history.present.objects).toHaveLength(0);
});
```

> The Inspector test uses `/^delete$/i` (exact) so it does not match "Delete color keyframe"/"Delete node" etc. that may render in other states; here only the object Delete button is present.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/ui/hooks/useKeyboard.test.ts src/ui/components/Inspector/Inspector.test.tsx`
Expected: FAIL — Delete does not remove the object; no Delete button.

- [ ] **Step 3: Extend the Delete chain**

In `src/ui/hooks/useKeyboard.ts`, replace the final `else s.removeSelectedKeyframe();` in the `Delete`/`Backspace` case with:

```ts
          else if (s.selectedKeyframe) s.removeSelectedKeyframe();
          else if (s.selectedObjectId) s.deleteSelectedObject();
```

- [ ] **Step 4: Add the Inspector button**

In `src/ui/components/Inspector/Inspector.tsx`:

1. Add `deleteSelectedObject` to the destructured `useEditor.getState()` actions (beside `duplicateSelected`).
2. Beside the existing Duplicate button, add a Delete button:

```tsx
        <div className={styles.row}>
          <button onClick={() => duplicateSelected()}>Duplicate</button>
          <button onClick={() => deleteSelectedObject()}>Delete</button>
        </div>
```

(replace the existing single-button row that holds Duplicate.)

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm vitest run src/ui/hooks/useKeyboard.test.ts src/ui/components/Inspector/Inspector.test.tsx`
Expected: PASS.

- [ ] **Step 6: Gate + commit**

Run: `pnpm vitest run && pnpm typecheck && pnpm lint`
Expected: all green.

```bash
git add src/ui/hooks/useKeyboard.ts src/ui/components/Inspector/Inspector.tsx src/ui/hooks/useKeyboard.test.ts src/ui/components/Inspector/Inspector.test.tsx
git commit -m "feat(slice15): Delete-chain object fallback + Inspector Delete button"
```

---

### Task 4: End-to-end — Delete removes the selected object

**Files:**
- Create: `e2e/delete-object.spec.ts`

**Interfaces:**
- Consumes: the whole feature.

- [ ] **Step 1: Write the e2e**

Create `e2e/delete-object.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('delete removes the selected object', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Draw two rects.
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  for (const [dx, dy] of [[60, 60], [200, 160]]) {
    await page.getByRole('button', { name: 'Rectangle' }).click();
    await page.mouse.move(box.x + dx, box.y + dy);
    await page.mouse.down();
    await page.mouse.move(box.x + dx + 80, box.y + dy + 60);
    await page.mouse.up();
  }
  await page.getByRole('button', { name: 'Select' }).click();
  await expect(page.locator('[data-savig-object]')).toHaveCount(2);

  // The last-drawn rect is selected; Delete it via the Inspector button.
  await page.getByRole('button', { name: /^Delete$/ }).click();
  await expect(page.locator('[data-savig-object]')).toHaveCount(1);
});
```

- [ ] **Step 2: Run to verify it passes**

Run: `pnpm exec playwright test e2e/delete-object.spec.ts`
Expected: PASS.

- [ ] **Step 3: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add e2e/delete-object.spec.ts
git commit -m "test(e2e): delete removes the selected object"
```

---

## Self-Review (plan vs spec)

- **§2 asset pruning (vector prune / svg keep-shared, checked after removal)** → Task 1 (`removeObject`). ✅
- **§2.1 nextZOrder across all four creation paths** → Task 2 (Steps 3–4 + the zOrder regression test). ✅
- **§3 pure helper (filter + prune; same-ref no-op)** → Task 1. ✅
- **§4 store `deleteSelectedObject` (no-op when unselected; one commit; selectObject(null))** → Task 2 (Step 5). ✅
- **§5 UI (Delete chain last fallback after keyframe; Inspector button)** → Task 3. ✅
- **§6 no persistence/render/runtime/export change** → only `removeObject.ts`, `index.ts`, store, keyboard, Inspector, tests, one e2e touched. ✅
- **§7 tests (engine vector/svg-shared/unknown; store delete/no-op/zOrder; keyboard object-vs-keyframe; Inspector button; e2e)** → Tasks 1, 2, 3, 4. ✅
- **Type consistency:** `removeObject(project, id): Project` signature identical in Task 1 def + Task 2 call; `nextZOrder(objects)` local to the store, used in 4 places; `deleteSelectedObject()` name consistent across store/keyboard/Inspector. ✅
- **Placeholder scan:** all steps carry concrete code; the Inspector `/^delete$/i` note explains the exact-match rationale. ✅
