# Slice 14 Duplicate Object Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user duplicate the selected object (a full independent copy with all its animation) via `Cmd/Ctrl+D` or an Inspector button.

**Architecture:** A pure `duplicateObject` helper deep-clones the object (and, for vectors, the asset) with fresh ids, a "copy" name, and an offset; a thin `duplicateSelected` store action calls it, commits (one undo step), and selects the copy. Wired to `Cmd/Ctrl+D` and an Inspector button. No engine-pipeline/render/runtime/export/persistence change.

**Tech Stack:** TypeScript (strict), Vitest + RTL, Playwright; the existing `src/engine` factories + `src/ui` store/Inspector/keyboard.

## Global Constraints

- TypeScript strict; no `any`. Match surrounding code style.
- A duplicate is independent: **vector object → CLONE the `VectorAsset`** (new id, deep copy); **imported SVG → SHARE the asset** (same `assetId`); audio is out of scope (not a scene object).
- Deep-clone via `JSON.parse(JSON.stringify(...))` (the object graph is JSON-plain by design — matches persistence; no `structuredClone` env dependency).
- The clone: fresh object id, name `"<name> copy"`, base translation offset by `DUP_OFFSET = 10` in x and y, `zOrder` set to the top by the store, then selected. ONE undo step.
- No engine-pipeline/render/runtime/export/persistence change; NO migration (project stays v4).
- Run the full gate before declaring done: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`.

---

### Task 1: Pure helper — `engine/duplicate.ts`

**Files:**
- Create: `src/engine/duplicate.ts`
- Create: `src/engine/duplicate.test.ts`
- Modify: `src/engine/index.ts` (barrel export)

**Interfaces:**
- Consumes: `Asset`, `SceneObject`, `VectorAsset` (from `./types`).
- Produces: `duplicateObject(obj: SceneObject, asset: Asset | undefined, ids: { objectId: string; assetId: string }, offset: number): { object: SceneObject; clonedAsset?: VectorAsset }`.

- [ ] **Step 1: Write the failing test**

Create `src/engine/duplicate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { duplicateObject } from './duplicate';
import { createSceneObject, createVectorAsset } from './project';
import type { SvgAsset } from './types';

describe('duplicateObject', () => {
  const ids = { objectId: 'new-obj', assetId: 'new-asset' };

  it('vector: clones the asset, re-points the object, offsets + renames', () => {
    const asset = createVectorAsset('rect', { id: 'va', name: 'Rectangle', style: { fill: '#ff0000', stroke: 'none', strokeWidth: 1 } });
    const obj = createSceneObject('va', { id: 'o1', name: 'Rectangle 1', base: { x: 5, y: 7, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
    const { object, clonedAsset } = duplicateObject(obj, asset, ids, 10);
    expect(object.id).toBe('new-obj');
    expect(object.name).toBe('Rectangle 1 copy');
    expect([object.base.x, object.base.y]).toEqual([15, 17]);
    expect(clonedAsset?.id).toBe('new-asset');
    expect(object.assetId).toBe('new-asset'); // points at the clone
    expect(clonedAsset?.style.fill).toBe('#ff0000');
  });

  it('vector: the clone is deeply independent of the original', () => {
    const asset = createVectorAsset('rect', { id: 'va' });
    const obj = createSceneObject('va', { id: 'o1', tracks: { x: [{ time: 0, value: 0, easing: 'linear' }] } });
    const { object, clonedAsset } = duplicateObject(obj, asset, ids, 10);
    object.tracks.x![0].value = 999;
    clonedAsset!.style.fill = '#000000';
    expect(obj.tracks.x![0].value).toBe(0); // original untouched
    expect(asset.style.fill).not.toBe('#000000');
  });

  it('svg: shares the asset (same assetId, no clonedAsset)', () => {
    const asset: SvgAsset = { id: 'sa', kind: 'svg', name: 'box', normalizedContent: '<svg/>', viewBox: '0 0 1 1', width: 1, height: 1 };
    const obj = createSceneObject('sa', { id: 'o1', name: 'box 1' });
    const { object, clonedAsset } = duplicateObject(obj, asset, ids, 10);
    expect(object.assetId).toBe('sa');
    expect(clonedAsset).toBeUndefined();
    expect(object.name).toBe('box 1 copy');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/engine/duplicate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `duplicate.ts`**

Create `src/engine/duplicate.ts`:

```ts
import type { Asset, SceneObject, VectorAsset } from './types';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Deep-clone a scene object for duplication. The clone gets `ids.objectId`, name
 *  "<name> copy", and its base translation offset by `offset` in x and y. For a
 *  VECTOR asset, also returns a cloned asset with `ids.assetId` and re-points the
 *  object at it (independent path/style); otherwise the object keeps its original
 *  `assetId` and no asset is returned (shared/instanced). `zOrder` is left as-cloned;
 *  the caller places the copy. */
export function duplicateObject(
  obj: SceneObject,
  asset: Asset | undefined,
  ids: { objectId: string; assetId: string },
  offset: number,
): { object: SceneObject; clonedAsset?: VectorAsset } {
  const object = clone(obj);
  object.id = ids.objectId;
  object.name = `${obj.name} copy`;
  object.base = { ...object.base, x: object.base.x + offset, y: object.base.y + offset };
  if (asset && asset.kind === 'vector') {
    const clonedAsset: VectorAsset = { ...clone(asset), id: ids.assetId };
    object.assetId = ids.assetId;
    return { object, clonedAsset };
  }
  return { object };
}
```

- [ ] **Step 4: Add the barrel export**

In `src/engine/index.ts`, add next to the other top-level re-exports:

```ts
export * from './duplicate';
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm vitest run src/engine/duplicate.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/engine/duplicate.ts src/engine/duplicate.test.ts src/engine/index.ts
git commit -m "feat(slice14): duplicateObject pure helper (deep clone; vector clones asset, svg shares)"
```

---

### Task 2: Store — `duplicateSelected()`

**Files:**
- Modify: `src/ui/store/store.ts`
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Consumes: `duplicateObject` (Task 1, via the engine barrel), `newId` (already imported), `selectObject` (existing action).
- Produces: action `duplicateSelected(): void`.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/store/store.test.ts`:

```ts
describe('duplicateSelected', () => {
  it('clones a vector object + its asset, selects the copy, one undo step', () => {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorShape('rect', { x: 0, y: 0, width: 40, height: 30 });
    const before = useEditor.getState().history.present;
    expect(before.objects).toHaveLength(1);
    const origId = before.objects[0].id;

    useEditor.getState().duplicateSelected();
    const after = useEditor.getState().history.present;
    expect(after.objects).toHaveLength(2);
    expect(after.assets.filter((a) => a.kind === 'vector')).toHaveLength(2); // asset cloned
    const copy = after.objects.find((o) => o.id !== origId)!;
    expect(useEditor.getState().selectedObjectId).toBe(copy.id);
    expect(copy.zOrder).toBe(1); // placed on top
    expect([copy.base.x, copy.base.y]).toEqual([10, 10]); // offset

    useEditor.getState().undo(); // one undo removes both object + asset
    expect(useEditor.getState().history.present.objects).toHaveLength(1);
  });

  it('is a no-op when nothing is selected', () => {
    const s = useEditor.getState();
    s.newProject();
    s.selectObject(null);
    useEditor.getState().duplicateSelected();
    expect(useEditor.getState().history.present.objects).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/ui/store/store.test.ts -t "duplicateSelected"`
Expected: FAIL — `duplicateSelected` undefined.

- [ ] **Step 3: Add the action + interface entry + a constant**

In `src/ui/store/store.ts`:

1. Add `duplicateObject` to the engine import group (the `from '../../engine'` import that already pulls `createSceneObject`/`createVectorAsset`/`newId`).
2. Near the top-level constants (e.g. beside `const KF_EPS = 1e-6;`), add:

```ts
const DUP_OFFSET = 10;
```
3. In the actions interface, after `addObject(assetId: string): void;`:

```ts
  duplicateSelected(): void;
```
4. Add the action (place it near `addObject`/`addVectorShape`):

```ts
  duplicateSelected() {
    const project = get().history.present;
    const obj = project.objects.find((o) => o.id === get().selectedObjectId);
    if (!obj) return;
    const asset = project.assets.find((a) => a.id === obj.assetId);
    const { object, clonedAsset } = duplicateObject(
      obj,
      asset,
      { objectId: newId(), assetId: newId() },
      DUP_OFFSET,
    );
    const placed = { ...object, zOrder: project.objects.length };
    get().commit({
      ...project,
      assets: clonedAsset ? [...project.assets, clonedAsset] : project.assets,
      objects: [...project.objects, placed],
    });
    get().selectObject(placed.id);
  },
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/ui/store/store.test.ts -t "duplicateSelected"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(slice14): store duplicateSelected (clone + commit + select, one undo step)"
```

---

### Task 3: UI — keyboard `Cmd/Ctrl+D` + Inspector "Duplicate" button

**Files:**
- Modify: `src/ui/hooks/useKeyboard.ts`
- Modify: `src/ui/components/Inspector/Inspector.tsx`
- Test: `src/ui/hooks/useKeyboard.test.ts`, `src/ui/components/Inspector/Inspector.test.tsx`

**Interfaces:**
- Consumes: `duplicateSelected` (Task 2).
- Produces: `Cmd/Ctrl+D` duplicates; an Inspector "Duplicate" button.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/hooks/useKeyboard.test.ts`:

```ts
it('Cmd/Ctrl+D duplicates the selected object', () => {
  const s = useEditor.getState();
  s.newProject();
  s.addVectorShape('rect', { x: 0, y: 0, width: 20, height: 20 });
  expect(useEditor.getState().history.present.objects).toHaveLength(1);
  fireEvent.keyDown(window, { key: 'd', metaKey: true });
  expect(useEditor.getState().history.present.objects).toHaveLength(2);
});
```

Append to `src/ui/components/Inspector/Inspector.test.tsx`:

```ts
it('the Duplicate button duplicates the selected object', async () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 30, height: 20 });
  render(<Inspector />);
  await userEvent.click(screen.getByRole('button', { name: /duplicate/i }));
  expect(useEditor.getState().history.present.objects).toHaveLength(2);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/ui/hooks/useKeyboard.test.ts src/ui/components/Inspector/Inspector.test.tsx`
Expected: FAIL — `Cmd+D` does nothing; no Duplicate button.

- [ ] **Step 3: Add the keyboard branch**

In `src/ui/hooks/useKeyboard.ts`, after the `mod && (e.key === 'z' || e.key === 'Z')` block (which already returns), add:

```ts
      if (mod && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        s.duplicateSelected();
        return;
      }
```

- [ ] **Step 4: Add the Inspector button**

In `src/ui/components/Inspector/Inspector.tsx`:

1. Add `duplicateSelected` to the destructured `useEditor.getState()` actions (alongside `setProperty` etc.).
2. At the top of the returned panel JSX (the `return ( <div className={styles.panel}> …`), add a button row as the FIRST child of the panel:

```tsx
        <div className={styles.row}>
          <button onClick={() => duplicateSelected()}>Duplicate</button>
        </div>
```

> This sits past the `if (!obj) return …` guard, so it only renders when an object is selected.

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm vitest run src/ui/hooks/useKeyboard.test.ts src/ui/components/Inspector/Inspector.test.tsx`
Expected: PASS.

- [ ] **Step 6: Gate + commit**

Run: `pnpm vitest run && pnpm typecheck && pnpm lint`
Expected: all green.

```bash
git add src/ui/hooks/useKeyboard.ts src/ui/components/Inspector/Inspector.tsx src/ui/hooks/useKeyboard.test.ts src/ui/components/Inspector/Inspector.test.tsx
git commit -m "feat(slice14): Cmd/Ctrl+D + Inspector Duplicate button"
```

---

### Task 4: End-to-end — Duplicate adds a selected copy

**Files:**
- Create: `e2e/duplicate-object.spec.ts`

**Interfaces:**
- Consumes: the whole feature.

- [ ] **Step 1: Write the e2e**

Create `e2e/duplicate-object.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('duplicate creates a second, selected object', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Draw a rect (it is selected).
  await page.getByRole('button', { name: 'Rectangle' }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 180);
  await page.mouse.up();
  await page.getByRole('button', { name: 'Select' }).click();
  await expect(page.locator('[data-savig-object]')).toHaveCount(1);

  // Duplicate via the Inspector button.
  await page.getByRole('button', { name: /duplicate/i }).click();
  await expect(page.locator('[data-savig-object]')).toHaveCount(2);
  // Exactly one object is selected, and it is the duplicate (data-selected="true").
  await expect(page.locator('[data-savig-object][data-selected="true"]')).toHaveCount(1);
});
```

> If `data-selected` is rendered as `"true"`/`"false"` the selector matches the selected one; the per-object `data-selected={o.id === selectedId}` attribute exists in the Stage render.

- [ ] **Step 2: Run to verify it passes**

Run: `pnpm exec playwright test e2e/duplicate-object.spec.ts`
Expected: PASS.

- [ ] **Step 3: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add e2e/duplicate-object.spec.ts
git commit -m "test(e2e): duplicate creates a second selected object"
```

---

## Self-Review (plan vs spec)

- **§2 asset fork (vector clone / svg share)** → Task 1 (`duplicateObject` branches on `asset.kind`). ✅
- **§3 pure helper (JSON deep-clone; new id; copy name; offset; zOrder left to caller)** → Task 1. ✅
- **§4 store `duplicateSelected` (clone + commit one step + select; zOrder top; no-op when unselected)** → Task 2. ✅
- **§5 UI (Cmd/Ctrl+D preventDefault; Inspector button)** → Task 3. ✅
- **§6 no persistence/render/runtime/export change** → only `duplicate.ts`, `index.ts`, store, keyboard, Inspector, tests, one e2e touched. ✅
- **§7 tests (engine vector/svg/independence; store add/select/undo/no-op; Inspector button; e2e count+selection)** → Tasks 1, 2, 3, 4. ✅
- **Type consistency:** `duplicateObject(obj, asset, ids, offset)` signature + `{ object, clonedAsset? }` return identical in Task 1 def + Task 2 call; `DUP_OFFSET = 10` local to the store; `duplicateSelected()` name consistent across store/keyboard/Inspector. ✅
- **Placeholder scan:** all steps carry concrete code; the e2e `data-selected` note has a concrete basis. ✅
