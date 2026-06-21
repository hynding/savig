# Slice 19 Object Lock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user lock an object (toggle in the Layers panel) so it still renders/animates/exports but is non-interactive on the stage — it cannot be selected, moved, resized, rotated, gradient-dragged, or deleted.

**Architecture:** Add an optional `locked?: boolean` to `SceneObject` (sibling of `hidden`). A `toggleObjectLock` store action flips it and deselects the object when locking it — the single invariant *locked ⇒ not selected ⇒ no handles, no keyboard ops*. The Stage makes a locked-object pointer-down inert (bubbles to background → deselect) and suppresses the three selection-overlay memos for `hidden || locked` selected objects. The Layers panel gains a lock button. Editor-only: zero engine/render/runtime/export/migration change.

**Tech Stack:** TypeScript (strict), React 18, Zustand, Vitest + RTL, Playwright.

## Global Constraints

- TypeScript strict; no `any`. Match surrounding code style.
- `locked?: boolean` on `SceneObject` — persisted, undoable, absent === unlocked, **NO migration / version bump** (stays v4; serializes generically like `hidden`).
- `toggleObjectLock(id)` is an undoable `commit`; no-op for an unknown id; **when locking the currently-selected object it also calls `selectObject(null)`** (deselect-on-lock).
- Locked objects still render in the `ordered` map and still register playback nodes — lock does NOT hide and does NOT change export/runtime.
- Stage: a locked-object pointer-down returns early WITHOUT `selectObject` and WITHOUT `e.stopPropagation()` (so it bubbles to the background handler and deselects). The `selectedVector` / `selectedGradient` / `selectedRotatable` memos early-return when the selected object is `hidden || locked`.
- Layers panel: lock button `data-testid="lock-<id>"`, `aria-pressed={!!o.locked}`; the row `onClick` selects only when `!o.locked`.
- Run the full gate before declaring done: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`.

---

### Task 1: Store — `toggleObjectLock(id)` + `locked` field

**Files:**
- Modify: `src/engine/` SceneObject type (the file declaring `hidden?: boolean` on `SceneObject`)
- Modify: `src/ui/store/store.ts`
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Produces: action `toggleObjectLock(id: string): void`; field `SceneObject.locked?: boolean`.

- [ ] **Step 1: Locate the `hidden?` declaration**

Run: `grep -rn "hidden?: boolean" src/engine`
Expected: one hit on `SceneObject`. Add `locked?: boolean;` on the next line (same doc-comment style if any). This is the only engine change.

- [ ] **Step 2: Write the failing store tests**

Append to `src/ui/store/store.test.ts`:

```ts
describe('toggleObjectLock', () => {
  it('locks/unlocks an object (undoable)', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().toggleObjectLock(id);
    expect(useEditor.getState().history.present.objects[0].locked).toBe(true);
    useEditor.getState().undo();
    expect(useEditor.getState().history.present.objects[0].locked).toBeFalsy();
  });
  it('is a no-op for an unknown id', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const past = useEditor.getState().history.past.length;
    useEditor.getState().toggleObjectLock('nope');
    expect(useEditor.getState().history.past.length).toBe(past);
  });
  it('locking the SELECTED object deselects it', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().toggleObjectLock(id);
    expect(useEditor.getState().selectedObjectId).toBeNull();
  });
  it('locking a NON-selected object leaves the selection intact', () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 }); // obj A (selected)
    const a = useEditor.getState().selectedObjectId!;
    useEditor.getState().addVectorShape('rect', { x: 20, y: 20, width: 10, height: 10 }); // obj B (now selected)
    const b = useEditor.getState().selectedObjectId!;
    useEditor.getState().toggleObjectLock(a); // lock the non-selected A
    expect(useEditor.getState().selectedObjectId).toBe(b);
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm vitest run src/ui/store/store.test.ts -t "toggleObjectLock"`
Expected: FAIL — `toggleObjectLock` undefined.

- [ ] **Step 4: Add the interface entry + action**

In `src/ui/store/store.ts`:

1. In the actions interface, after `toggleObjectVisibility(id: string): void;`:

```ts
  toggleObjectLock(id: string): void;
```

2. Add the action immediately after the `toggleObjectVisibility` action:

```ts
  toggleObjectLock(id) {
    const project = get().history.present;
    const obj = project.objects.find((o) => o.id === id);
    if (!obj) return; // unknown id -> no-op
    const locking = !obj.locked;
    get().commit(replaceObject(project, { ...obj, locked: locking }));
    if (locking && get().selectedObjectId === id) get().selectObject(null);
  },
```

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm vitest run src/ui/store/store.test.ts -t "toggleObjectLock"`
Expected: PASS (all 4).

- [ ] **Step 6: Commit**

```bash
git add src/engine src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(slice19): SceneObject.locked + store toggleObjectLock (deselect-on-lock)"
```

---

### Task 2: Stage — inert locked pointer-down + handle suppression

**Files:**
- Modify: `src/ui/components/Stage/Stage.tsx`
- Test: `src/ui/components/Stage/Stage.test.tsx`

**Interfaces:**
- Consumes: `toggleObjectLock`, `toggleObjectVisibility`, `SceneObject.locked` (Task 1).

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/components/Stage/Stage.test.tsx`:

```ts
it('does not select a locked object on pointer down', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 50, height: 30 });
  const id = useEditor.getState().selectedObjectId!;
  useEditor.getState().toggleObjectLock(id); // also deselects
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  fireEvent.pointerDown(screen.getByTestId(`object-${id}`));
  expect(useEditor.getState().selectedObjectId).toBeNull(); // stayed deselected
});

it('hides the resize-handle overlay for a hidden selected object', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 50, height: 30 });
  const id = useEditor.getState().selectedObjectId!;
  useEditor.getState().toggleObjectVisibility(id); // hide; visibility does NOT deselect
  expect(useEditor.getState().selectedObjectId).toBe(id);
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  expect(screen.queryByTestId('resize-handles')).toBeNull();
});
```

> Sanity baseline already covered by the existing test "renders ... selected rect" — an unlocked, visible selected rect DOES show `resize-handles`.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx -t "locked"`
then `... -t "hidden selected"`
Expected: the locked test FAILS (selecting a locked object still selects), the hidden test FAILS (overlay still rendered).

- [ ] **Step 3: Make the locked pointer-down inert**

In `src/ui/components/Stage/Stage.tsx`, find `onObjectPointerDown`:

```ts
  const onObjectPointerDown = (id: string, e: ReactPointerEvent) => {
    e.stopPropagation();
    selectObject(id);
```

Insert a guard as the first two lines of the function body (before `e.stopPropagation()`):

```ts
  const onObjectPointerDown = (id: string, e: ReactPointerEvent) => {
    const target = useEditor.getState().history.present.objects.find((o) => o.id === id);
    if (target?.locked) return; // inert: bubble to background -> deselect
    e.stopPropagation();
    selectObject(id);
```

- [ ] **Step 4: Suppress handles for hidden/locked selected objects**

In the same file, add `|| obj.hidden || obj.locked` to the early-return guard of each of the three overlay memos. For `selectedVector`:

```ts
    if (!obj || obj.hidden || obj.locked || !asset || asset.kind !== 'vector' || asset.shapeType === 'path') return null;
```

For `selectedGradient`:

```ts
    if (!obj || obj.hidden || obj.locked || !asset || asset.kind !== 'vector') return null;
```

For `selectedRotatable`:

```ts
    if (!obj || obj.hidden || obj.locked || !asset || asset.kind !== 'vector') return null;
```

(Keep the rest of each guard exactly as-is — only insert `obj.hidden || obj.locked` right after the `!obj` clause. The `obj` is already null-checked by `!obj` first, so the field access is safe.)

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx`
Expected: PASS (the 2 new tests + all existing Stage tests).

- [ ] **Step 6: Commit**

```bash
git add src/ui/components/Stage/Stage.tsx src/ui/components/Stage/Stage.test.tsx
git commit -m "feat(slice19): locked objects are inert on stage; suppress handles for hidden/locked"
```

---

### Task 3: Layers panel lock button + e2e

**Files:**
- Modify: `src/ui/components/LayersPanel/LayersPanel.tsx`
- Modify: `src/ui/components/LayersPanel/LayersPanel.module.css`
- Test: `src/ui/components/LayersPanel/LayersPanel.test.tsx`
- Create: `e2e/lock-object.spec.ts`

**Interfaces:**
- Consumes: `toggleObjectLock`, `SceneObject.locked` (Task 1); Stage suppression (Task 2).

- [ ] **Step 1: Write the failing panel tests**

Append to `src/ui/components/LayersPanel/LayersPanel.test.tsx`:

```ts
it('the lock button toggles the object lock', async () => {
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  const id = useEditor.getState().selectedObjectId!;
  render(<LayersPanel />);
  const btn = screen.getByTestId(`lock-${id}`);
  expect(btn.getAttribute('aria-pressed')).toBe('false');
  await userEvent.click(btn);
  expect(useEditor.getState().history.present.objects[0].locked).toBe(true);
});

it('clicking a locked row does not select the object', async () => {
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  const id = useEditor.getState().selectedObjectId!;
  useEditor.getState().toggleObjectLock(id); // locked + deselected
  render(<LayersPanel />);
  await userEvent.click(screen.getByTestId(`layer-${id}`));
  expect(useEditor.getState().selectedObjectId).toBeNull(); // still not selected
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/ui/components/LayersPanel/LayersPanel.test.tsx -t "lock"`
Expected: FAIL — no `lock-<id>` button.

- [ ] **Step 3: Add the lock button + guard the row click**

In `src/ui/components/LayersPanel/LayersPanel.tsx`:

1. Destructure `toggleObjectLock` alongside the existing actions:

```ts
  const { selectObject, toggleObjectVisibility, renameObject, toggleObjectLock } = useEditor.getState();
```

2. Guard the row `onClick` (currently `onClick={() => selectObject(o.id)}`):

```tsx
            onClick={() => { if (!o.locked) selectObject(o.id); }}
```

3. Add a lock button immediately BEFORE the existing eye `<button>` (so row order is name … [lock][eye]):

```tsx
            <button
              data-testid={`lock-${o.id}`}
              aria-label={`${o.name} lock`}
              aria-pressed={!!o.locked}
              className={styles.eye}
              onClick={(e) => {
                e.stopPropagation();
                toggleObjectLock(o.id);
              }}
            >
              {o.locked ? '🔒' : '🔓'}
            </button>
```

4. Add the `locked` class to the row's className (alongside the existing `hidden` class):

```tsx
            className={`${styles.row} ${o.id === selectedId ? styles.selected : ''} ${o.hidden ? styles.hidden : ''} ${o.locked ? styles.locked : ''}`}
```

- [ ] **Step 4: Add the locked row style**

In `src/ui/components/LayersPanel/LayersPanel.module.css`, after the `.hidden` rule:

```css
.locked .name { color: var(--color-text-dim); }
```

- [ ] **Step 5: Run to verify the panel tests pass**

Run: `pnpm vitest run src/ui/components/LayersPanel/LayersPanel.test.tsx`
Expected: PASS (2 new lock tests + all existing list/select/visibility/rename tests).

- [ ] **Step 6: Write the e2e**

Create `e2e/lock-object.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('locking an object makes it non-interactive on the stage', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Draw a rect — it is auto-selected, so the resize-handle overlay is visible.
  await page
    .getByRole('group', { name: 'Tools' })
    .getByRole('button', { name: 'Rectangle', exact: true })
    .click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 180);
  await page.mouse.up();
  await expect(page.getByTestId('resize-handles')).toBeVisible();

  // Lock it via the Layers panel.
  const row = page.locator('section[aria-label="Assets"] [data-testid^="layer-"]').first();
  const rowId = (await row.getAttribute('data-testid'))!.replace('layer-', '');
  await page.getByTestId(`lock-${rowId}`).click();

  // Handles disappear, and clicking the shape on the stage does not bring them back.
  await expect(page.getByTestId('resize-handles')).toHaveCount(0);
  await page.mouse.click(box.x + 150, box.y + 140);
  await expect(page.getByTestId('resize-handles')).toHaveCount(0);
  // The object still renders.
  await expect(page.locator('[data-savig-object]')).toHaveCount(1);
});
```

- [ ] **Step 7: Run the e2e**

Run: `pnpm exec playwright test e2e/lock-object.spec.ts`
Expected: PASS.

- [ ] **Step 8: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add src/ui/components/LayersPanel/ e2e/lock-object.spec.ts
git commit -m "feat(slice19): LayersPanel lock button + e2e (locked object non-interactive)"
```

---

## Self-Review (plan vs spec)

- **§2 `locked?: boolean`, no migration** → Task 1 Step 1. ✅
- **§3 `toggleObjectLock` (commit flip, no-op unknown, deselect-on-lock-of-selected)** → Task 1 Steps 2/4; all four store tests. ✅
- **§4(a) inert locked pointer-down (no select, no stopPropagation → bubble→deselect)** → Task 2 Step 3 + the "does not select a locked object" test. ✅
- **§4(b) handle memos suppress on `hidden || locked` (incl. S17 hidden papercut)** → Task 2 Step 4 + the "hidden selected" test (the locked case is covered observably via deselect-on-lock + the e2e). ✅
- **§5 Layers panel lock button (`lock-<id>`, aria-pressed, stopPropagation) + row-click guarded** → Task 3 Steps 1/3 + both panel tests. ✅
- **§6 editor-only (no render/export/runtime/migration)** → only the SceneObject type, store, Stage, LayersPanel, and one e2e are touched; no engine render/export/runtime file. ✅
- **§9 testing (store ×4, panel ×2, Stage ×2, e2e)** → Tasks 1–3. ✅
- **Type/name consistency:** `toggleObjectLock(id)` identical across Task 1 def, Task 2 (Stage test), Task 3 (panel). `locked` field name consistent everywhere. testids `lock-<id>` consistent in component + panel test + e2e. ✅
- **Placeholder scan:** every step carries concrete code; selectors (`Tools` group, `section[aria-label="Assets"]`, `resize-handles`, `object-<id>`) all mirror existing specs/tests. ✅
