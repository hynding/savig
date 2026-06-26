# Symbol Library Rename & Delete (47d) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user rename and delete symbols from the AssetPanel library, with a guarded delete (blocked while instances exist).

**Architecture:** Two undoable store actions — `renameAsset(assetId, name)` (asset analogue of `renameObject`) and `deleteSymbol(symId)` (in-use guard via `countSymbolInstances`; cross-scene prune via `collectReferencedAssetIds`). The AssetPanel symbol row gains inline rename + a delete button, mirroring the Layers panel's `editingId` pattern. No engine-render change → preview==export parity untouched.

**Tech Stack:** TypeScript (strict), React, Zustand, Vitest + RTL, Playwright. No new dependencies.

## Global Constraints

- **Preview == export parity is sacred.** No engine/render change; both actions edit asset metadata / the asset array. A deleted 0-instance symbol has no rendered leaves.
- **No new dependencies.**
- **Undoable:** each action is one whole-project commit.
- **In-use safety:** `deleteSymbol` is blocked whenever `countSymbolInstances(symId, project) > 0`.
- **Commit cadence:** one commit per task (TDD). At plan end: `npm test`, `npm run typecheck`, `npx eslint src e2e`, `npm run e2e` all green.

---

### Task 1: `renameAsset` + `deleteSymbol` store actions

**Files:**
- Modify: `src/ui/store/store.ts` (engine import ~line 34; action declarations after `swapSymbol` ~line 241; action impls after `swapSymbol` ~line 1516+)
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Produces: `renameAsset(assetId: string, name: string): void`; `deleteSymbol(symId: string): void`.
- Consumes: `countSymbolInstances`, `collectReferencedAssetIds` (engine), `pushToast` (store).

- [ ] **Step 1: Write the failing tests**

Append a new describe block to `src/ui/store/store.test.ts`:

```ts
describe('symbol library rename + delete (47d)', () => {
  function libraryWithSymbol(instances = 1) {
    const s = useEditor.getState();
    s.newProject();
    const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
    const sym = createSymbolAsset({ id: 'sym', name: 'Symbol', objects: [createSceneObject('rect-asset', { id: 'leaf' })], width: 10, height: 10 });
    const p = createProject();
    p.assets = [rectAsset, sym];
    p.objects = Array.from({ length: instances }, (_, i) => createSceneObject('sym', { id: `inst${i}` }));
    s.commit(p);
  }
  const sym = () => useEditor.getState().history.present.assets.find((a) => a.id === 'sym');

  it('renameAsset updates the symbol name; an empty name keeps the old', () => {
    libraryWithSymbol();
    useEditor.getState().renameAsset('sym', '  Hero  ');
    expect(sym()!.name).toBe('Hero');
    useEditor.getState().renameAsset('sym', '   ');
    expect(sym()!.name).toBe('Hero'); // unchanged
  });

  it('deleteSymbol with instances is blocked + toasts', () => {
    libraryWithSymbol(1);
    const before = useEditor.getState().toasts.length;
    useEditor.getState().deleteSymbol('sym');
    expect(sym()).toBeTruthy(); // not removed
    expect(useEditor.getState().toasts.length).toBe(before + 1);
  });

  it('deleteSymbol with 0 instances removes the symbol + prunes its symbol-only internal assets', () => {
    libraryWithSymbol(0); // a symbol referencing rect-asset, with NO instances
    useEditor.getState().deleteSymbol('sym');
    const assets = useEditor.getState().history.present.assets;
    expect(assets.some((a) => a.id === 'sym')).toBe(false); // removed
    expect(assets.some((a) => a.id === 'rect-asset')).toBe(false); // pruned (was used only by the symbol)
  });

  it('deleteSymbol keeps an internal asset that is also referenced at the root', () => {
    const s = useEditor.getState();
    s.newProject();
    const shared = createVectorAsset('rect', { id: 'shared', shapeType: 'rect' });
    const sym2 = createSymbolAsset({ id: 'sym', name: 'S', objects: [createSceneObject('shared', { id: 'leaf' })], width: 10, height: 10 });
    const p = createProject();
    p.assets = [shared, sym2];
    p.objects = [createSceneObject('shared', { id: 'root-user' })]; // root also uses `shared`; sym has 0 instances
    s.commit(p);
    s.deleteSymbol('sym');
    const assets = useEditor.getState().history.present.assets;
    expect(assets.some((a) => a.id === 'sym')).toBe(false); // removed
    expect(assets.some((a) => a.id === 'shared')).toBe(true); // kept (still used at root)
  });

  it('deleteSymbol is undoable', () => {
    libraryWithSymbol(0);
    useEditor.getState().deleteSymbol('sym');
    useEditor.getState().undo();
    expect(sym()).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/store/store.test.ts -t "symbol library rename + delete"`
Expected: FAIL — `renameAsset` / `deleteSymbol` are not defined.

- [ ] **Step 3: Import `countSymbolInstances`**

In `src/ui/store/store.ts`, add `countSymbolInstances` to the engine import that already includes `symbolContains` (~line 34):

```ts
import { pathBounds, identityCorrespondence, primitivePathFromSpec, booleanOp as booleanOpEngine, ringArea, symbolContains } from '../../engine';
```
→
```ts
import { pathBounds, identityCorrespondence, primitivePathFromSpec, booleanOp as booleanOpEngine, ringArea, symbolContains, countSymbolInstances } from '../../engine';
```

- [ ] **Step 4: Add the action type declarations**

After the `swapSymbol(instanceId: string, newSymId: string): void;` declaration (~line 241), add:

```ts
  /** Rename any asset (library symbol, svg, audio). Empty/whitespace keeps the old name. (47d) */
  renameAsset(assetId: string, name: string): void;
  /** Delete a library symbol — blocked (toast) while any instance references it; prunes its
   *  now-orphaned internal vector/svg assets. (47d) */
  deleteSymbol(symId: string): void;
```

- [ ] **Step 5: Implement the actions**

After the `swapSymbol` implementation's closing `},` (~line 1528, immediately before `booleanOp(op) {`), add:

```ts
  renameAsset(assetId, name) {
    const s = get();
    const project = s.history.present;
    const asset = project.assets.find((a) => a.id === assetId);
    const trimmed = name.trim();
    if (!asset || !trimmed || asset.name === trimmed) return;
    get().commit({ ...project, assets: project.assets.map((a) => (a.id === assetId ? { ...a, name: trimmed } : a)) });
  },
  deleteSymbol(symId) {
    const s = get();
    const project = s.history.present;
    const sym = project.assets.find((a) => a.id === symId);
    if (!sym || sym.kind !== 'symbol') return;
    const count = countSymbolInstances(symId, project);
    if (count > 0) {
      get().pushToast('error', `Can't delete "${sym.name}" — it has ${count} instance${count === 1 ? '' : 's'}.`);
      return;
    }
    // Remove the symbol, then cross-scene prune its now-orphaned vector/svg internal assets (keep
    // symbol/audio; keep anything still referenced anywhere) — the phase-1/boolean prune predicate.
    let next = { ...project, assets: project.assets.filter((a) => a.id !== symId) };
    const referenced = collectReferencedAssetIds(next);
    next = { ...next, assets: next.assets.filter((a) => a.kind === 'symbol' || a.kind === 'audio' || referenced.has(a.id)) };
    get().commit(next);
  },
```

- [ ] **Step 6: Run to verify pass + the whole store suite**

Run: `npx vitest run src/ui/store/store.test.ts -t "symbol library rename + delete"`
Expected: PASS (all five). Then the whole store suite:
Run: `npx vitest run src/ui/store/store.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck + commit**

```bash
npm run typecheck
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(symbol-rename-delete): renameAsset + guarded deleteSymbol store actions"
```

---

### Task 2: AssetPanel symbol-row rename/delete UI

**Files:**
- Modify: `src/ui/components/AssetPanel/AssetPanel.tsx`, `src/ui/components/AssetPanel/AssetPanel.module.css`
- Test: `src/ui/components/AssetPanel/AssetPanel.test.tsx`

**Interfaces:** Consumes `renameAsset`/`deleteSymbol` (Task 1).

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/components/AssetPanel/AssetPanel.test.tsx`:

```ts
it('renames a symbol via the library (47d)', async () => {
  const s = useEditor.getState();
  s.newProject();
  const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
  const sym = createSymbolAsset({ id: 'sym', name: 'Symbol', objects: [createSceneObject('rect-asset', { id: 'leaf' })], width: 10, height: 10 });
  const p = createProject();
  p.assets = [rectAsset, sym];
  p.objects = [createSceneObject('sym', { id: 'inst' })];
  act(() => { s.commit(p); });
  render(<AssetPanel />);
  await userEvent.click(screen.getByLabelText('Rename Symbol'));
  const input = screen.getByTestId('symbol-rename-sym');
  await userEvent.clear(input);
  await userEvent.type(input, 'Hero{Enter}');
  expect(useEditor.getState().history.present.assets.find((a) => a.id === 'sym')!.name).toBe('Hero');
});

it('deletes a 0-instance symbol via the library; an in-use one is blocked (47d)', async () => {
  const s = useEditor.getState();
  s.newProject();
  const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
  const sym = createSymbolAsset({ id: 'sym', name: 'Symbol', objects: [createSceneObject('rect-asset', { id: 'leaf' })], width: 10, height: 10 });
  const p = createProject();
  p.assets = [rectAsset, sym];
  p.objects = [createSceneObject('sym', { id: 'inst' })]; // 1 instance
  act(() => { s.commit(p); });
  render(<AssetPanel />);
  // In use -> delete is a no-op (the row stays).
  await userEvent.click(screen.getByLabelText('Delete Symbol'));
  expect(screen.getByTestId('symbol-sym')).toBeInTheDocument();
  // Remove the instance, then delete works -> the row disappears.
  act(() => { s.commit({ ...useEditor.getState().history.present, objects: [] }); });
  await userEvent.click(screen.getByLabelText('Delete Symbol'));
  expect(screen.queryByTestId('symbol-sym')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/components/AssetPanel/AssetPanel.test.tsx -t "47d"`
Expected: the rename/delete tests FAIL — no rename/delete buttons.

- [ ] **Step 3: Restructure the symbol row**

In `src/ui/components/AssetPanel/AssetPanel.tsx`:

Add `useState` to the React import and pull `renameAsset`/`deleteSymbol` from the store:

```tsx
import { useId } from 'react';
```
→
```tsx
import { useId, useState } from 'react';
```

and:

```tsx
  const { addAsset, addObject, addAudioClip, placeSymbolInstance, pushToast } = useEditor.getState();
```
→
```tsx
  const { addAsset, addObject, addAudioClip, placeSymbolInstance, pushToast, renameAsset, deleteSymbol } = useEditor.getState();
  const [editingId, setEditingId] = useState<string | null>(null);
```

Replace the symbol `.map(...)` body (the `<button data-testid={`symbol-${sym.id}`}>…</button>` return) with the row from the spec §2.2:

```tsx
            return (
              <div className={styles.symbolRow} key={sym.id}>
                {editingId === sym.id ? (
                  <input
                    className={styles.renameInput}
                    data-testid={`symbol-rename-${sym.id}`}
                    defaultValue={sym.name}
                    autoFocus
                    onBlur={(e) => { renameAsset(sym.id, e.currentTarget.value); setEditingId(null); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                  />
                ) : (
                  <button
                    className={styles.item}
                    data-testid={`symbol-${sym.id}`}
                    disabled={cyclic}
                    title={cyclic ? 'Would create a containment cycle' : 'Place an instance'}
                    onClick={() => placeSymbolInstance(sym.id)}
                  >
                    <SymbolThumbnail symbol={sym} assets={assets} meta={meta} />
                    <span>{sym.name} ({countSymbolInstances(sym.id, { objects, assets })})</span>
                  </button>
                )}
                <button className={styles.rowBtn} aria-label={`Rename ${sym.name}`} onClick={() => setEditingId(sym.id)}>✎</button>
                <button className={styles.rowBtn} aria-label={`Delete ${sym.name}`} onClick={() => deleteSymbol(sym.id)}>×</button>
              </div>
            );
```

(Remove the now-unused outer `key={sym.id}` from the old button; the `key` lives on the `<div>`. `const cyclic = …` stays just before the `return`.)

- [ ] **Step 4: Add CSS**

Append to `src/ui/components/AssetPanel/AssetPanel.module.css`:

```css
.symbolRow {
  display: flex;
  align-items: stretch;
  gap: 2px;
}
.symbolRow .item {
  flex: 1;
  min-width: 0;
}
.renameInput {
  flex: 1;
  min-width: 0;
}
.rowBtn {
  flex: 0 0 auto;
  padding: 0 6px;
}
```

- [ ] **Step 5: Run to verify pass + the AssetPanel suite**

Run: `npx vitest run src/ui/components/AssetPanel/AssetPanel.test.tsx`
Expected: PASS (the new rename/delete tests + the existing symbol-list / cycle / thumbnail tests — the place button keeps its `data-testid`, text, click, and `disabled`).

- [ ] **Step 6: Typecheck + lint + commit**

```bash
npm run typecheck
npx eslint src
git add src/ui/components/AssetPanel/
git commit -m "feat(symbol-rename-delete): AssetPanel symbol-row inline rename + delete controls"
```

---

### Task 3: e2e + full-suite verification

**Files:**
- Modify: `e2e/symbols.spec.ts`

- [ ] **Step 1: Write the e2e test**

Append to `e2e/symbols.spec.ts`. Create a symbol, rename it via the library → the row shows the new name.

```ts
test('rename a symbol in the library (47d)', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  const tools = page.getByRole('group', { name: 'Tools' });
  await tools.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(box.x + 120, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 170, box.y + 150);
  await page.mouse.up();
  await page.locator('[data-savig-object]').first().click();
  await page.getByRole('button', { name: 'Create Symbol', exact: true }).click();

  // Rename the new symbol via its library row. Scope to the symbols section — the Layers panel
  // also renders a "Rename {name}" button for the instance object (same accessible name).
  const symbolsSection = page.getByTestId('symbols-section');
  await symbolsSection.getByRole('button', { name: /^Rename / }).first().click();
  const input = page.locator('[data-testid^="symbol-rename-"]').first();
  await input.fill('Hero');
  await input.press('Enter');
  await expect(page.getByTestId('symbols-section')).toContainText('Hero');
});
```

- [ ] **Step 2: Run the e2e**

Run: `npm run e2e -- symbols.spec.ts`
Expected: PASS.

- [ ] **Step 3: Full-suite verification**

```bash
npm test
npm run typecheck
npx eslint src e2e
npm run e2e
```
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add e2e/symbols.spec.ts
git commit -m "test(symbol-rename-delete): e2e rename a symbol in the library"
```

---

## Self-Review

**1. Spec coverage** (spec §2–6): §2.1 renameAsset + deleteSymbol → Task 1. §2.2 row restructure → Task 2. §3 parity/undo/in-use → Global Constraints + tests. §4 scope (rename+delete; drag-to-place/swap-anchor/non-symbol-rename deferred) → not implemented. §6 tests → store (Task 1), RTL (Task 2), e2e (Task 3). ✅

**2. Placeholder scan:** No TBD/TODO; full action bodies, the full row JSX, CSS, and exact import/declaration edits. ✅

**3. Type consistency:** `renameAsset(assetId: string, name: string): void`; `deleteSymbol(symId: string): void`; `countSymbolInstances(symId, project)` (project satisfies `Pick<Project,'objects'|'assets'>`); `collectReferencedAssetIds(project): Set<string>`; the prune predicate matches phase-1 delete (keep symbol/audio OR referenced). ✅

**4. Parity:** no engine/render change; both actions edit asset metadata / the asset array; a 0-instance symbol has no rendered leaves. ✅
