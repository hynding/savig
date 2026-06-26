# Author Inside a Symbol — Phase 5: In-Symbol Layers Mutators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Layers-panel mutators (visibility, lock, rename, reorder, drag-reorder, drag-reparent) edit a symbol's internal hierarchy in edit mode.

**Architecture:** Reuse the seam: each action resolves the scene via `selectActiveObjects` instead of the root, and writes a single object via phase-3's `replaceObjectInScene(project, selectActiveAssetId(s), next)` or a whole array via 47-edit's `commitActiveScene(nextObjects)`. No engine-render change → preview==export parity untouched.

**Tech Stack:** TypeScript (strict), React, Zustand, Vitest (unit + jsdom), Playwright (e2e). No new dependencies.

## Global Constraints

- **Preview == export parity is sacred.** No change to `flattenInstances`/`computeFrame`/`renderDocument`/runtime.
- **No new dependencies.**
- **Active-scene routed:** resolve via `selectActiveObjects(s)`; single-object writes via `replaceObjectInScene(project, selectActiveAssetId(s), next)`; whole-array writes via `commitActiveScene(nextObjects)`.
- **Root behaviour byte-unchanged:** `selectActiveObjects(s)` === `project.objects` at root; `replaceObjectInScene(p, null, x)` === `replaceObject(p, x)`; `commitActiveScene(objs)` === `commit({ ...project, objects: objs })`.
- **No UI change:** the Layers panel already renders the active scene (47-edit) and calls these actions.
- **Commit cadence:** one commit per task (TDD). At plan end: `npm test`, `npm run typecheck`, `npx eslint src e2e`, `npm run e2e` all green; engine/parity suites green.

---

### Task 1: Route the single-object Layers mutators (`toggleObjectVisibility`, `toggleObjectLock`, `renameObject`)

**Files:**
- Modify: `src/ui/store/store.ts`
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Consumes: `replaceObjectInScene`/`selectActiveObjects`/`selectActiveAssetId` (already in store).

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/store/store.test.ts`:

```ts
describe('in-symbol Layers mutators (author-in-symbol phase 5)', () => {
  function symbolWithTwo() {
    const s = useEditor.getState();
    s.newProject();
    const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
    const a = createSceneObject('rect-asset', { id: 'pa', name: 'A', zOrder: 0 });
    const b = createSceneObject('rect-asset', { id: 'pb', name: 'B', zOrder: 1 });
    const sym = createSymbolAsset({ id: 'sym', objects: [a, b], width: 10, height: 10 });
    const p = createProject();
    p.assets = [rectAsset, sym];
    p.objects = [createSceneObject('sym', { id: 'inst1' }), createSceneObject('sym', { id: 'inst2' })];
    s.commit(p);
    s.enterSymbol('sym');
  }
  const symObjs = () => (useEditor.getState().history.present.assets.find((a) => a.id === 'sym') as { objects: import('../../engine').SceneObject[] }).objects;
  const symObj = (id: string) => symObjs().find((o) => o.id === id)!;

  it('toggleObjectVisibility toggles the SYMBOL object hidden (not root)', () => {
    symbolWithTwo();
    useEditor.getState().toggleObjectVisibility('pa');
    expect(symObj('pa').hidden).toBe(true);
    expect(useEditor.getState().history.present.objects.map((o) => o.id)).toEqual(['inst1', 'inst2']); // root untouched
  });

  it('toggleObjectLock toggles the SYMBOL object locked and drops it from selection', () => {
    symbolWithTwo();
    useEditor.getState().selectObject('pa');
    useEditor.getState().toggleObjectLock('pa');
    expect(symObj('pa').locked).toBe(true);
    expect(useEditor.getState().selectedObjectIds).not.toContain('pa');
  });

  it('renameObject renames the SYMBOL object', () => {
    symbolWithTwo();
    useEditor.getState().renameObject('pa', 'Renamed');
    expect(symObj('pa').name).toBe('Renamed');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/store/store.test.ts -t "in-symbol Layers mutators"`
Expected: FAIL — these resolve the object from the root, find nothing inside a symbol, no-op.

- [ ] **Step 3: Route `toggleObjectVisibility`**

```ts
  toggleObjectVisibility(id) {
    const s = get();
    const project = s.history.present;
    const obj = selectActiveObjects(s).find((o) => o.id === id);
    if (!obj) return;
    get().commit(replaceObjectInScene(project, selectActiveAssetId(s), { ...obj, hidden: !obj.hidden }));
  },
```

- [ ] **Step 4: Route `toggleObjectLock`**

```ts
  toggleObjectLock(id) {
    const s = get();
    const project = s.history.present;
    const obj = selectActiveObjects(s).find((o) => o.id === id);
    if (!obj) return; // unknown id -> no-op
    const locking = !obj.locked;
    get().commit(replaceObjectInScene(project, selectActiveAssetId(s), { ...obj, locked: locking }));
    // Drop a freshly-locked object from the selection (it can't be edited/deleted).
    if (locking && get().selectedObjectIds.includes(id)) {
      const next = get().selectedObjectIds.filter((x) => x !== id);
      set({ selectedObjectIds: next, selectedObjectId: next.at(-1) ?? null });
    }
  },
```

- [ ] **Step 5: Route `renameObject`**

```ts
  renameObject(id, name) {
    const s = get();
    const project = s.history.present;
    const obj = selectActiveObjects(s).find((o) => o.id === id);
    if (!obj || obj.name === name) return; // unknown / unchanged -> no-op
    get().commit(replaceObjectInScene(project, selectActiveAssetId(s), { ...obj, name }));
  },
```

- [ ] **Step 6: Run to verify pass + the whole store suite**

Run: `npx vitest run src/ui/store/store.test.ts -t "in-symbol Layers mutators"`
Expected: PASS. Then the whole store suite (existing root visibility/lock/rename tests must stay green):
Run: `npx vitest run src/ui/store/store.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck + commit**

```bash
npm run typecheck
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(in-symbol-layers): route toggleObjectVisibility/toggleObjectLock/renameObject to the active scene"
```

---

### Task 2: Route the structural Layers mutators (`reorderSelected`, `moveObjectToTarget`, `reparentObject`)

**Files:**
- Modify: `src/ui/store/store.ts`
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Consumes: `commitActiveScene`/`replaceObjectInScene`/`selectActiveObjects`/`selectActiveAssetId`, `reorderObjects`/`moveObjectToTarget as moveObjectToTargetPure`/`bakeGroupIntoChild`/`unbakeGroupFromChild`/`resolveObjectAnchor` (all already in scope).

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/store/store.test.ts`, inside the `in-symbol Layers mutators (author-in-symbol phase 5)` describe block (so `symbolWithTwo`/`symObjs`/`symObj` are in scope):

```ts
  it('reorderSelected reorders the SYMBOL scene objects (not root)', () => {
    symbolWithTwo(); // sym objects: A(z0), B(z1)
    useEditor.getState().selectObject('pa');
    useEditor.getState().reorderSelected('front'); // bring A to front
    const za = symObj('pa').zOrder;
    const zb = symObj('pb').zOrder;
    expect(za).toBeGreaterThan(zb); // A now in front of B inside the symbol
  });

  it('reparentObject moves an internal object into an internal group (parentId set)', () => {
    const s = useEditor.getState();
    s.newProject();
    const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
    const group = createGroupObject({ id: 'g', anchorX: 0, anchorY: 0, zOrder: 0 });
    const child = createSceneObject('rect-asset', { id: 'c', name: 'C', zOrder: 1 });
    const sym = createSymbolAsset({ id: 'sym', objects: [group, child], width: 10, height: 10 });
    const p = createProject();
    p.assets = [rectAsset, sym];
    p.objects = [createSceneObject('sym', { id: 'inst' })];
    s.commit(p);
    s.enterSymbol('sym');
    s.reparentObject('c', 'g'); // drop the child into the group, inside the symbol
    const symC = (useEditor.getState().history.present.assets.find((a) => a.id === 'sym') as { objects: import('../../engine').SceneObject[] }).objects.find((o) => o.id === 'c')!;
    expect(symC.parentId).toBe('g');
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/store/store.test.ts -t "reorders the SYMBOL scene|moves an internal object into an internal group"`
Expected: FAIL — these operate on the root objects array; inside a symbol the selected/target ids aren't there, so they no-op.

- [ ] **Step 3: Route `reorderSelected`**

```ts
  reorderSelected(op) {
    const s = get();
    const id = s.selectedObjectId;
    if (id == null) return;
    const cur = selectActiveObjects(s);
    const objects = reorderObjects(cur, id, op);
    if (objects === cur) return; // no-op -> no commit
    get().commitActiveScene(objects);
  },
```

- [ ] **Step 4: Route `moveObjectToTarget`**

```ts
  moveObjectToTarget(draggedId, targetId) {
    const s = get();
    const cur = selectActiveObjects(s);
    const objects = moveObjectToTargetPure(cur, draggedId, targetId);
    if (objects === cur) return; // no-op -> no commit
    get().commitActiveScene(objects);
  },
```

- [ ] **Step 5: Route `reparentObject`**

In `reparentObject`, change the scene local and the final write (the body reads the scene through the single local `objs` and writes once at the end). Find the opening:
```ts
  reparentObject(id, newParentId) {
    const s = get();
    const project = s.history.present;
    const objs = project.objects;
```
Change the `objs` line to:
```ts
    const objs = selectActiveObjects(s);
```
Then find the final commit line:
```ts
    get().commit(replaceObject(project, cur));
```
Change it to:
```ts
    get().commit(replaceObjectInScene(project, selectActiveAssetId(s), cur));
```
(Leave everything between — the cycle guard, `parentGroup` walk, anchor resolve, bake-out/unbake-in chain — unchanged; it all reads the local `objs`, which now points at the active scene.)

- [ ] **Step 6: Run to verify pass + the whole store suite**

Run: `npx vitest run src/ui/store/store.test.ts -t "in-symbol Layers mutators"`
Expected: PASS. Then the whole store suite (existing root reorder/move/reparent — incl. slice-45f drag-reparent — must stay green):
Run: `npx vitest run src/ui/store/store.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck + commit**

```bash
npm run typecheck
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(in-symbol-layers): route reorderSelected/moveObjectToTarget/reparentObject to the active scene"
```

---

### Task 3: e2e + full-suite verification

**Files:**
- Modify: `e2e/symbols.spec.ts`

- [ ] **Step 1: Write the e2e test**

Append to `e2e/symbols.spec.ts`. Create a symbol with TWO parts and two instances, enter it, toggle one internal part's visibility off via the Layers panel, and confirm each instance loses that part.

```ts
test('hide a part inside a symbol via the Layers panel — every instance loses it (author-in-symbol layers)', async ({
  page,
}) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  const tools = page.getByRole('group', { name: 'Tools' });
  const drawRect = async (x0: number, y0: number, x1: number, y1: number) => {
    await tools.getByRole('button', { name: 'Rectangle', exact: true }).click();
    await page.mouse.move(box.x + x0, box.y + y0);
    await page.mouse.down();
    await page.mouse.move(box.x + x1, box.y + y1);
    await page.mouse.up();
  };

  await drawRect(120, 100, 170, 150);
  await drawRect(220, 100, 270, 150);
  await page.locator('[data-savig-object]').nth(0).click();
  await page.locator('[data-savig-object]').nth(1).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Create Symbol', exact: true }).click();
  await page.keyboard.press('Control+d');
  await expect(page.locator('[data-savig-object*="/"]')).toHaveCount(4); // 2 instances x 2 parts

  // Enter the symbol; hide one internal part via its Layers row visibility toggle.
  await page.locator('[data-savig-object*="/"]').last().dblclick();
  await expect(page.getByTestId('edit-breadcrumb')).toBeVisible();
  const layers = page.locator('section[aria-label="Assets"]');
  await layers.getByRole('button', { name: /visibility/i }).first().click();

  // Exit; the hidden part is gone from EVERY instance -> 2 instances x 1 visible part = 2 leaves.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('edit-breadcrumb')).toHaveCount(0);
  await expect(page.locator('[data-savig-object*="/"]')).toHaveCount(2);
});
```
> Verify the Layers panel lives in the `Assets` section and its row visibility control's accessible name (grep `src/ui/components/LayersPanel/LayersPanel.tsx` for the visibility button's `aria-label` — it is `` `${o.name} visibility` ``, so `name: /visibility/i` matches). A hidden object is dropped from the render by `isRenderHidden` in `flattenInstances`, so its composite leaf disappears for every instance. The contract: hiding an internal part via the Layers panel removes it from all instances.

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
Expected: all green. Parity suites unchanged-and-green.

- [ ] **Step 4: Commit**

```bash
git add e2e/symbols.spec.ts
git commit -m "test(in-symbol-layers): e2e hide a part inside a symbol via the Layers panel"
```

---

## Self-Review

**1. Spec coverage** (spec §2 table):
- `toggleObjectVisibility`/`toggleObjectLock`/`renameObject` → Task 1. `reorderSelected`/`moveObjectToTarget`/`reparentObject` → Task 2. §3 parity/undo/edit-propagation → Global Constraints. §4 deferred (clipboard/group/motion/morph) — not implemented. §6 tests → store (T1, T2), e2e (T3). ✅

**2. Placeholder scan:** No TBD/TODO; complete code/tests. One calibration note (e2e Layers section + visibility aria-label) states the confirmed contract. ✅

**3. Type consistency:** every routed action uses `selectActiveObjects(s)` for resolve and `replaceObjectInScene(project, selectActiveAssetId(s), next)` (single-object) or `commitActiveScene(objects)` (array), matching phase-3's `replaceObjectInScene(project: Project, activeAssetId: string | null, next: SceneObject): Project` and 47-edit's `commitActiveScene(nextObjects: SceneObject[]): void`. The `reparentObject` edits are confined to the `objs` local + the final commit. ✅

**4. Parity:** no `flattenInstances`/`computeFrame`/`renderDocument`/runtime change; `hidden` already drives `isRenderHidden`. ✅
