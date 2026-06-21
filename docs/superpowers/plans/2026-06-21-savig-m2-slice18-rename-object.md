# Slice 18 Rename Object Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user rename an object by double-clicking its name in the Layers panel and typing (Enter/blur commits, Escape cancels).

**Architecture:** A `renameObject(id, name)` store action (undoable commit; name is a document field) plus an inline-edit state machine in the LayersPanel (`editingId`/`draft`/`cancelRef`): the name span becomes an `<input>` on double-click. No engine helper, no pipeline/persistence/render change.

**Tech Stack:** TypeScript (strict), React 18, Vitest + RTL, Playwright; the existing `src/ui` store + LayersPanel.

## Global Constraints

- TypeScript strict; no `any`. Match surrounding code style.
- `renameObject(id, name)` is an undoable `commit`; no-op when the id is unknown or the name is unchanged. `name` is already a persisted field — NO migration (v4).
- Inline edit: double-click the name → input; Enter or blur commits the TRIMMED draft; an empty/whitespace draft keeps the OLD name; Escape cancels (no commit).
- Escape must not also commit on the subsequent blur: Escape sets `cancelRef`, calls the same finish handler (which skips the rename and nulls `editingId`, unmounting the input so a later blur cannot re-commit).
- The rename `<input>`'s own `onClick` calls `stopPropagation` so positioning the cursor does not re-fire the row's `selectObject`.
- No engine pure helper; no pipeline/persistence/render change.
- Run the full gate before declaring done: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`.

---

### Task 1: Store — `renameObject(id, name)`

**Files:**
- Modify: `src/ui/store/store.ts`
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Produces: action `renameObject(id: string, name: string): void`.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/store/store.test.ts`:

```ts
describe('renameObject', () => {
  it('renames an object (undoable)', () => {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().renameObject(id, 'Hero');
    expect(useEditor.getState().history.present.objects[0].name).toBe('Hero');
    useEditor.getState().undo();
    expect(useEditor.getState().history.present.objects[0].name).not.toBe('Hero');
  });
  it('is a no-op for an unknown id or an unchanged name', () => {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const id = useEditor.getState().selectedObjectId!;
    const name = useEditor.getState().history.present.objects[0].name;
    const past = useEditor.getState().history.past.length;
    useEditor.getState().renameObject('nope', 'X');
    useEditor.getState().renameObject(id, name); // unchanged
    expect(useEditor.getState().history.past.length).toBe(past); // no history entry
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/ui/store/store.test.ts -t "renameObject"`
Expected: FAIL — `renameObject` undefined.

- [ ] **Step 3: Add the interface entry + action**

In `src/ui/store/store.ts`:

1. In the actions interface, after `toggleObjectVisibility(id: string): void;`:

```ts
  renameObject(id: string, name: string): void;
```
2. Add the action near `toggleObjectVisibility`:

```ts
  renameObject(id, name) {
    const project = get().history.present;
    const obj = project.objects.find((o) => o.id === id);
    if (!obj || obj.name === name) return; // unknown / unchanged -> no-op
    get().commit(replaceObject(project, { ...obj, name }));
  },
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm vitest run src/ui/store/store.test.ts -t "renameObject"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(slice18): store renameObject (undoable, no-op unknown/unchanged)"
```

---

### Task 2: LayersPanel — inline rename

**Files:**
- Modify: `src/ui/components/LayersPanel/LayersPanel.tsx`
- Modify: `src/ui/components/LayersPanel/LayersPanel.module.css`
- Test: `src/ui/components/LayersPanel/LayersPanel.test.tsx`

**Interfaces:**
- Consumes: `renameObject` (Task 1).
- Produces: double-click a layer name → an `rename-<id>` input; Enter/blur commits, Escape cancels.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/components/LayersPanel/LayersPanel.test.tsx`:

```ts
import { fireEvent } from '@testing-library/react';

it('double-clicking a name renames the object on Enter', async () => {
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  const id = useEditor.getState().selectedObjectId!;
  render(<LayersPanel />);
  await userEvent.dblClick(screen.getByTestId(`layer-${id}`).querySelector('span')!);
  const input = screen.getByTestId(`rename-${id}`) as HTMLInputElement;
  expect(input.value).toBe(useEditor.getState().history.present.objects[0].name);
  await userEvent.clear(input);
  await userEvent.type(input, 'Hero{Enter}');
  expect(useEditor.getState().history.present.objects[0].name).toBe('Hero');
});

it('Escape cancels the rename', async () => {
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  const id = useEditor.getState().selectedObjectId!;
  const original = useEditor.getState().history.present.objects[0].name;
  render(<LayersPanel />);
  await userEvent.dblClick(screen.getByTestId(`layer-${id}`).querySelector('span')!);
  const input = screen.getByTestId(`rename-${id}`);
  await userEvent.clear(input);
  await userEvent.type(input, 'Nope');
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(useEditor.getState().history.present.objects[0].name).toBe(original);
});

it('committing an empty name keeps the old name', async () => {
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  const id = useEditor.getState().selectedObjectId!;
  const original = useEditor.getState().history.present.objects[0].name;
  render(<LayersPanel />);
  await userEvent.dblClick(screen.getByTestId(`layer-${id}`).querySelector('span')!);
  const input = screen.getByTestId(`rename-${id}`);
  await userEvent.clear(input);
  await userEvent.type(input, '   {Enter}');
  expect(useEditor.getState().history.present.objects[0].name).toBe(original);
});
```

> The `beforeEach(() => useEditor.getState().newProject())` at the top of the file already runs, so each test starts clean.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/ui/components/LayersPanel/LayersPanel.test.tsx`
Expected: FAIL — no `rename-<id>` input.

- [ ] **Step 3: Add the inline-edit state + input**

Replace the body of `src/ui/components/LayersPanel/LayersPanel.tsx` with:

```tsx
import { useRef, useState } from 'react';
import { useEditor } from '../../store/store';
import styles from './LayersPanel.module.css';

export function LayersPanel() {
  const objects = useEditor((s) => s.history.present.objects);
  const selectedId = useEditor((s) => s.selectedObjectId);
  const { selectObject, toggleObjectVisibility, renameObject } = useEditor.getState();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const cancelRef = useRef(false);

  const startEdit = (id: string, name: string) => {
    cancelRef.current = false;
    setDraft(name);
    setEditingId(id);
  };
  const finishEdit = () => {
    const id = editingId;
    if (id && !cancelRef.current) {
      const trimmed = draft.trim();
      if (trimmed) renameObject(id, trimmed); // empty/whitespace -> keep old name
    }
    cancelRef.current = false;
    setEditingId(null);
  };

  // Front-first: highest zOrder at the top (Figma/Photoshop convention).
  const ordered = [...objects].sort((a, b) => b.zOrder - a.zOrder);

  return (
    <div className={styles.panel} aria-label="Layers">
      <div className={styles.header}>Layers</div>
      {ordered.length === 0 ? (
        <div className={styles.empty}>No objects</div>
      ) : (
        ordered.map((o) => (
          <div
            key={o.id}
            data-testid={`layer-${o.id}`}
            data-selected={o.id === selectedId}
            className={`${styles.row} ${o.id === selectedId ? styles.selected : ''} ${o.hidden ? styles.hidden : ''}`}
            onClick={() => selectObject(o.id)}
          >
            {editingId === o.id ? (
              <input
                data-testid={`rename-${o.id}`}
                className={styles.nameInput}
                autoFocus
                value={draft}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => setDraft(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onBlur={finishEdit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') finishEdit();
                  else if (e.key === 'Escape') {
                    cancelRef.current = true;
                    finishEdit();
                  }
                }}
              />
            ) : (
              <span className={styles.name} onDoubleClick={() => startEdit(o.id, o.name)}>
                {o.name}
              </span>
            )}
            <button
              data-testid={`vis-${o.id}`}
              aria-label={`${o.name} visibility`}
              aria-pressed={!o.hidden}
              className={styles.eye}
              onClick={(e) => {
                e.stopPropagation();
                toggleObjectVisibility(o.id);
              }}
            >
              {o.hidden ? '▯' : '◉'}
            </button>
          </div>
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add the input CSS**

In `src/ui/components/LayersPanel/LayersPanel.module.css`, after the `.name` rule:

```css
.nameInput { flex: 1; min-width: 0; font: inherit; color: var(--color-text); background: var(--color-bg); border: 1px solid var(--color-accent); border-radius: var(--radius-1); padding: 0 var(--space-1); }
```

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm vitest run src/ui/components/LayersPanel/LayersPanel.test.tsx`
Expected: PASS (the 3 new rename tests + the existing list/select/visibility tests).

- [ ] **Step 6: Gate + commit**

Run: `pnpm vitest run && pnpm typecheck && pnpm lint`
Expected: all green.

```bash
git add src/ui/components/LayersPanel/
git commit -m "feat(slice18): LayersPanel inline rename (double-click; Enter/blur/Escape)"
```

---

### Task 3: End-to-end — rename a layer

**Files:**
- Create: `e2e/rename-object.spec.ts`

**Interfaces:**
- Consumes: the whole feature.

- [ ] **Step 1: Write the e2e**

Create `e2e/rename-object.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('double-click a layer name to rename the object', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Draw a rect.
  await page.getByRole('group', { name: 'Tools' }).getByRole('button', { name: 'Rectangle', exact: true }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 180);
  await page.mouse.up();

  // The Layers panel lists it; rename via double-click.
  const layers = page.locator('section[aria-label="Assets"] [aria-label="Layers"]');
  const row = layers.locator('[data-testid^="layer-"]').first();
  const rowId = (await row.getAttribute('data-testid'))!.replace('layer-', '');
  await row.locator('span').first().dblclick();
  const input = page.getByTestId(`rename-${rowId}`);
  await input.fill('Hero');
  await input.press('Enter');

  await expect(layers.locator('text=Hero')).toBeVisible();
});
```

- [ ] **Step 2: Run to verify it passes**

Run: `pnpm exec playwright test e2e/rename-object.spec.ts`
Expected: PASS.

- [ ] **Step 3: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add e2e/rename-object.spec.ts
git commit -m "test(e2e): double-click a layer name renames the object"
```

---

## Self-Review (plan vs spec)

- **§2 store renameObject (undoable; no-op unknown/unchanged)** → Task 1. ✅
- **§3 inline edit (double-click → input; Enter/blur commit; Escape cancel via cancelRef; empty keeps old; input stopPropagation; autofocus+select)** → Task 2. ✅
- **§4 CSS `.nameInput`** → Task 2 Step 4. ✅
- **§5 no persistence/render change** → only store + LayersPanel touched + one e2e. ✅
- **§6 tests (store rename/undo/no-op; panel double-click-rename/Escape/empty; e2e)** → Tasks 1, 2, 3. ✅
- **Type consistency:** `renameObject(id, name)` signature identical in Task 1 def + Task 2 call; testids `rename-<id>` consistent in Task 2 component + test + Task 3 e2e. ✅
- **Placeholder scan:** all steps carry concrete code; the e2e Tools-group + `[data-testid^="layer-"]` selectors mirror prior slices. ✅
