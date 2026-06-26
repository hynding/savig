# Drag-to-Place a Symbol (47d) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drag a symbol from the AssetPanel library onto the Stage to place an instance under the cursor.

**Architecture:** A position-taking store action `placeSymbolInstanceAt(symId, x, y)` (same cycle guard + active-scene routing as `placeSymbolInstance`, but `base = (x - cx, y - cy)` so the content-centre lands at the drop point). The AssetPanel symbol button becomes a drag source (symId via a custom `dataTransfer` MIME); the Stage `<svg>` is a drop target that maps the client point with the existing `clientToLocal` and calls the action. No engine-render change → preview==export parity untouched.

**Tech Stack:** TypeScript (strict), React, Zustand, Vitest + RTL, Playwright. No new dependencies.

## Global Constraints

- **Preview == export parity is sacred.** No engine/render change; the action adds an instance object (like `placeSymbolInstance`).
- **No new dependencies.**
- **Cross-component handoff via `dataTransfer`** (MIME `application/x-savig-symbol`), not a store ref.
- **Cycle-guarded** identically to `placeSymbolInstance`/`swapSymbol`.
- **Commit cadence:** one commit per task (TDD). At plan end: `npm test`, `npm run typecheck`, `npx eslint src e2e`, `npm run e2e` all green.

---

### Task 1: `placeSymbolInstanceAt` store action

**Files:**
- Modify: `src/ui/store/store.ts` (declaration after `placeSymbolInstance(symId: string): void;` ~line 239; impl after `placeSymbolInstance`'s closing `},` ~line 1496)
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Produces: `placeSymbolInstanceAt(symId: string, x: number, y: number): void`.
- Consumes: `selectActiveObjects`/`selectActiveAssetId`/`symbolContains`/`sceneContentAABB`/`createSceneObject`/`nextZOrder`/`DEFAULT_TRANSFORM` (all in scope).

- [ ] **Step 1: Write the failing tests**

Append a new describe block to `src/ui/store/store.test.ts`:

```ts
describe('placeSymbolInstanceAt — drag-to-place (47d)', () => {
  const square = (off: number): import('../../engine').PathData => ({
    closed: true,
    nodes: [
      { anchor: { x: off, y: off } },
      { anchor: { x: off + 10, y: off } },
      { anchor: { x: off + 10, y: off + 10 } },
      { anchor: { x: off, y: off + 10 } },
    ],
  });
  function library() {
    const s = useEditor.getState();
    s.newProject();
    const pathAsset = createVectorAsset('path', { id: 'pa-asset', path: square(100) }); // 100..110 -> centre (105,105)
    const sym = createSymbolAsset({ id: 'sym', name: 'Sym', objects: [createSceneObject('pa-asset', { id: 'leaf' })], width: 10, height: 10 });
    const p = createProject();
    p.assets = [pathAsset, sym];
    p.objects = [createSceneObject('sym', { id: 'inst' })];
    s.commit(p);
  }
  const rootObjs = () => useEditor.getState().history.present.objects;
  const symObjs = () => (useEditor.getState().history.present.assets.find((a) => a.id === 'sym') as { objects: import('../../engine').SceneObject[] }).objects;

  it('places an instance whose content-centre lands at the drop point', () => {
    library();
    useEditor.getState().placeSymbolInstanceAt('sym', 200, 300);
    const placed = rootObjs().find((o) => o.assetId === 'sym' && o.id !== 'inst')!;
    expect(placed.base.x).toBe(200 - 105); // x - cx
    expect(placed.base.y).toBe(300 - 105); // y - cy
    expect(useEditor.getState().selectedObjectId).toBe(placed.id); // selected
  });

  it('is cycle-guarded: dropping a symbol into itself in edit mode is blocked + toasts', () => {
    library();
    useEditor.getState().enterSymbol('sym');
    const before = symObjs().length;
    const toasts = useEditor.getState().toasts.length;
    useEditor.getState().placeSymbolInstanceAt('sym', 10, 10);
    expect(symObjs().length).toBe(before); // nothing added to the symbol
    expect(useEditor.getState().toasts.length).toBe(toasts + 1);
  });

  it('placeSymbolInstance (click) still places at authored coords (regression)', () => {
    library();
    useEditor.getState().placeSymbolInstance('sym');
    const placed = rootObjs().find((o) => o.assetId === 'sym' && o.id !== 'inst')!;
    expect(placed.base.x).toBe(0); // authored coords, no offset
    expect(placed.base.y).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/store/store.test.ts -t "drag-to-place"`
Expected: FAIL — `placeSymbolInstanceAt` is not defined.

- [ ] **Step 3: Add the declaration**

After `placeSymbolInstance(symId: string): void;` (~line 239), add:

```ts
  /** Place a symbol instance with its content-centre at scene point (x, y) — drag-to-place. (47d) */
  placeSymbolInstanceAt(symId: string, x: number, y: number): void;
```

- [ ] **Step 4: Implement the action**

After `placeSymbolInstance`'s closing `},` (the line after `get().selectObject(instance.id);` at ~line 1495–1496, immediately before `swapSymbol(instanceId, newSymId) {`), add:

```ts
  placeSymbolInstanceAt(symId, x, y) {
    const s = get();
    const project = s.history.present;
    const symbol = project.assets.find((a) => a.id === symId);
    if (!symbol || symbol.kind !== 'symbol') return;
    const containing = selectActiveAssetId(s);
    if (containing && (symId === containing || symbolContains(symId, containing, project.assets))) {
      get().pushToast('error', `Can't place ${symbol.name} here — it would contain itself.`);
      return;
    }
    const objects = selectActiveObjects(s);
    const time = snapToFrame(s.time, project.meta.fps);
    const box = sceneContentAABB(symbol.objects, project.assets, time);
    const cx = box ? (box.minX + box.maxX) / 2 : 0;
    const cy = box ? (box.minY + box.maxY) / 2 : 0;
    const instance = createSceneObject(symId, {
      name: `${symbol.name} ${nextZOrder(objects) + 1}`,
      zOrder: nextZOrder(objects),
      anchorX: cx,
      anchorY: cy,
      base: { ...DEFAULT_TRANSFORM, x: x - cx, y: y - cy },
    });
    get().commitActiveScene([...objects, instance]);
    get().selectObject(instance.id);
  },
```

- [ ] **Step 5: Run to verify pass + the whole store suite**

Run: `npx vitest run src/ui/store/store.test.ts -t "drag-to-place"`
Expected: PASS (all three). Then the whole store suite (existing `placeSymbolInstance` tests must stay green):
Run: `npx vitest run src/ui/store/store.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(symbol-drag-to-place): placeSymbolInstanceAt store action"
```

---

### Task 2: AssetPanel drag source + Stage drop target

**Files:**
- Modify: `src/ui/components/AssetPanel/AssetPanel.tsx`, `src/ui/components/Stage/Stage.tsx`
- Test: `src/ui/components/AssetPanel/AssetPanel.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/ui/components/AssetPanel/AssetPanel.test.tsx`:

```ts
it('the symbol place button is a drag source (47d)', () => {
  const s = useEditor.getState();
  s.newProject();
  const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
  const sym = createSymbolAsset({ id: 'sym', name: 'Symbol', objects: [createSceneObject('rect-asset', { id: 'leaf' })], width: 10, height: 10 });
  const p = createProject();
  p.assets = [rectAsset, sym];
  p.objects = [createSceneObject('sym', { id: 'inst' })];
  act(() => { s.commit(p); });
  render(<AssetPanel />);
  expect(screen.getByTestId('symbol-sym')).toHaveAttribute('draggable', 'true');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/components/AssetPanel/AssetPanel.test.tsx -t "drag source"`
Expected: FAIL — the button is not draggable.

- [ ] **Step 3: AssetPanel — make the place button a drag source**

In `src/ui/components/AssetPanel/AssetPanel.tsx`, on the symbol place `<button>` (the one with `data-testid={`symbol-${sym.id}`}`), add `draggable` + `onDragStart` (just after `onClick={() => placeSymbolInstance(sym.id)}`):

```tsx
                    onClick={() => placeSymbolInstance(sym.id)}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/x-savig-symbol', sym.id);
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
```

- [ ] **Step 4: Stage — drop target**

In `src/ui/components/Stage/Stage.tsx`, add `onDragOver` + `onDrop` to the `<svg>` (alongside `onPointerDown`/`onDoubleClick`/`onWheel`):

```tsx
      <svg
        className={styles.svg}
        viewBox={`0 0 ${project.meta.width} ${project.meta.height}`}
        onPointerDown={onBackgroundPointerDown}
        onDoubleClick={onSvgDoubleClick}
        onWheel={onWheel}
```
→
```tsx
      <svg
        className={styles.svg}
        viewBox={`0 0 ${project.meta.width} ${project.meta.height}`}
        onPointerDown={onBackgroundPointerDown}
        onDoubleClick={onSvgDoubleClick}
        onWheel={onWheel}
        onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-savig-symbol')) e.preventDefault(); }}
        onDrop={(e) => {
          const symId = e.dataTransfer.getData('application/x-savig-symbol');
          if (!symId) return;
          e.preventDefault();
          const p = clientToLocal(e.clientX, e.clientY);
          if (p) useEditor.getState().placeSymbolInstanceAt(symId, p.x, p.y);
        }}
```

(`clientToLocal` and `useEditor` are already in scope in Stage.tsx.)

- [ ] **Step 5: Run to verify pass + the AssetPanel suite**

Run: `npx vitest run src/ui/components/AssetPanel/AssetPanel.test.tsx`
Expected: PASS (the new drag-source test + existing symbol tests). Then the Stage suite (no behavioural regression from the added handlers):
Run: `npx vitest run src/ui/components/Stage/Stage.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck + lint + commit**

```bash
npm run typecheck
npx eslint src
git add src/ui/components/AssetPanel/AssetPanel.tsx src/ui/components/Stage/Stage.tsx
git commit -m "feat(symbol-drag-to-place): AssetPanel drag source + Stage drop target"
```

---

### Task 3: e2e + full-suite verification

**Files:**
- Modify: `e2e/symbols.spec.ts`

- [ ] **Step 1: Write the e2e test**

Append to `e2e/symbols.spec.ts`. Create a symbol (1 instance), then drag its library row onto the Stage → a second instance is placed.

```ts
test('drag a symbol from the library onto the canvas places an instance (47d)', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  const stage = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await stage.boundingBox())!;
  const tools = page.getByRole('group', { name: 'Tools' });
  await tools.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(box.x + 120, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 170, box.y + 150);
  await page.mouse.up();
  await page.locator('[data-savig-object]').first().click();
  await page.getByRole('button', { name: 'Create Symbol', exact: true }).click();
  await expect(page.locator('[data-savig-object]')).toHaveCount(1); // 1 instance leaf

  // Drag the symbol's library row (the place button is the first button in the symbols section) onto
  // the canvas -> a second instance.
  await page.getByTestId('symbols-section').getByRole('button').first().dragTo(stage, { targetPosition: { x: 300, y: 220 } });
  await expect(page.locator('[data-savig-object]')).toHaveCount(2);
});
```

> The library's symbol id is generated, so target the place button generically: `page.getByTestId('symbols-section').getByRole('button').first()` is the first symbol's place button (the rename/delete buttons follow it; `.first()` is the place button). If `dragTo` does not carry `dataTransfer` in this environment (instance count stays 1), the Task-1 store tests are the authoritative proof of the placement logic — fall back to dispatching the drop manually with a constructed `DataTransfer` via `page.evaluate`, or assert the drag source's `draggable` attribute only.

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
git commit -m "test(symbol-drag-to-place): e2e drag a symbol from the library onto the canvas"
```

---

## Self-Review

**1. Spec coverage** (spec §2–6): §2.1 placeSymbolInstanceAt → Task 1. §2.2 AssetPanel drag source → Task 2. §2.3 Stage drop target → Task 2. §3 parity/undo/cycle → Global Constraints + tests. §4 scope (drag-to-place; swap-anchor/non-symbol/ghost deferred) → not implemented. §6 tests → store (Task 1), RTL (Task 2), e2e (Task 3). ✅

**2. Placeholder scan:** No TBD/TODO; full action body, the exact JSX additions, and the test code. The e2e note documents the DnD fallback. ✅

**3. Type consistency:** `placeSymbolInstanceAt(symId: string, x: number, y: number): void`; `clientToLocal(clientX, clientY): Point | null`; the instance `base = { ...DEFAULT_TRANSFORM, x: x - cx, y: y - cy }`. The store action mirrors `placeSymbolInstance`'s guard/centre, differing only in `base`. ✅

**4. Parity:** no engine/render change; the action adds an instance object exactly like `placeSymbolInstance`. ✅
