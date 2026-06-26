# Author Inside a Symbol — Phase 1: In-Symbol Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `deleteSelectedObject` work inside a symbol's scene (currently a silent no-op), with a cross-scene, symbol-preserving asset prune that also fixes a latent root-delete bug.

**Architecture:** One pure engine helper `collectReferencedAssetIds(project)` (every assetId referenced across root + all symbol scenes) + a rewrite of the store's `deleteSelectedObject` to target the active scene (47-edit's `selectActiveObjects`/`selectActiveAssetId`), keep the group-cascade, and prune the deleted objects' leaf (vector/svg) assets only when unreferenced anywhere — never pruning symbol/audio assets. No engine-render change → preview==export parity untouched.

**Tech Stack:** TypeScript (strict), React, Zustand, Vitest (unit + jsdom), Playwright (e2e). No new dependencies.

## Global Constraints

- **Preview == export parity is sacred.** No change to `flattenInstances`/`computeFrame`/`renderDocument`/runtime. `collectReferencedAssetIds` is a pure read helper.
- **No new dependencies.**
- **Prune rule:** a deleted object's asset is a *candidate*; KEEP it if `symbol`/`audio` (library defs / audio never pruned by an object delete) OR still referenced in the post-delete project (`collectReferencedAssetIds`); prune only an unreferenced `vector`/`svg` candidate.
- **Active-scene routed:** delete targets the root OR the edited symbol (editPath last). Group-cascade is computed within the active scene's objects.
- **Behaviour changes are corrections** (edit-mode delete works; cross-scene shared asset kept; library symbol kept at 0 instances). No existing test asserts the old behaviour.
- **Commit cadence:** one commit per task (TDD). At plan end: `npm test`, `npm run typecheck`, `npx eslint src e2e`, `npm run e2e` all green; engine/parity suites green.

---

### Task 1: `collectReferencedAssetIds` engine helper

**Files:**
- Modify: `src/engine/removeObject.ts`
- Test: `src/engine/removeObject.test.ts`

**Interfaces:**
- Produces: `collectReferencedAssetIds(project: Project): Set<string>`

- [ ] **Step 1: Write the failing test**

In `src/engine/removeObject.test.ts`: add `collectReferencedAssetIds` to the `./removeObject` import (currently `import { removeObject } from './removeObject';` → `import { removeObject, collectReferencedAssetIds } from './removeObject';`), and add `createSymbolAsset` to the `./project` import (it already imports `createProject`, `createSceneObject`, `createVectorAsset`). Then append:

```ts
describe('collectReferencedAssetIds (author-in-symbol delete)', () => {
  it('collects assetIds from the root scene and symbol scenes', () => {
    const v = createVectorAsset('rect', { id: 'v', shapeType: 'rect' });
    const sym = createSymbolAsset({ id: 'sym', objects: [createSceneObject('v', { id: 'inner' })], width: 10, height: 10 });
    const project = { ...createProject(), assets: [v, sym], objects: [createSceneObject('sym', { id: 'inst' })] };
    const ids = collectReferencedAssetIds(project);
    expect(ids.has('sym')).toBe(true); // referenced by the root instance
    expect(ids.has('v')).toBe(true);   // referenced ONLY inside the symbol
  });
  it('omits a wholly-unused asset', () => {
    const v = createVectorAsset('rect', { id: 'v', shapeType: 'rect' });
    const project = { ...createProject(), assets: [v], objects: [] };
    expect(collectReferencedAssetIds(project).has('v')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/engine/removeObject.test.ts -t "collectReferencedAssetIds"`
Expected: FAIL — not exported.

- [ ] **Step 3: Implement the helper**

In `src/engine/removeObject.ts`, change the type import to include `SceneObject` (`import type { Project, SceneObject } from './types';`) and append:

```ts
/** Every assetId referenced by an object across the WHOLE project — the root scene AND every
 *  SymbolAsset's objects[]. The basis for a cross-scene "is this asset still used?" check
 *  (author-in-symbol delete). */
export function collectReferencedAssetIds(project: Project): Set<string> {
  const ids = new Set<string>();
  const add = (objects: SceneObject[]): void => {
    for (const o of objects) if (o.assetId) ids.add(o.assetId);
  };
  add(project.objects);
  for (const a of project.assets) if (a.kind === 'symbol') add(a.objects);
  return ids;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/engine/removeObject.test.ts`
Expected: PASS (new tests + existing `removeObject` tests unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/engine/removeObject.ts src/engine/removeObject.test.ts
git commit -m "feat(in-symbol-delete): collectReferencedAssetIds (cross-scene reference collector)"
```

---

### Task 2: Scene-aware `deleteSelectedObject` with cross-scene prune

**Files:**
- Modify: `src/ui/store/store.ts`
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Consumes: `collectReferencedAssetIds` (Task 1), `selectActiveObjects`/`selectActiveAssetId` (47-edit, already imported).

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/store/store.test.ts`:

```ts
describe('deleteSelectedObject inside a symbol (author-in-symbol delete)', () => {
  function symbolWithTwoParts() {
    const s = useEditor.getState();
    s.newProject();
    const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
    const a = createSceneObject('rect-asset', { id: 'pa', zOrder: 0 });
    const b = createSceneObject('rect-asset', { id: 'pb', zOrder: 1 });
    const sym = createSymbolAsset({ id: 'sym', name: 'S', objects: [a, b], width: 10, height: 10 });
    const p = createProject();
    p.assets = [rectAsset, sym];
    p.objects = [createSceneObject('sym', { id: 'inst1' }), createSceneObject('sym', { id: 'inst2' })];
    s.commit(p);
  }

  it('deletes an internal object from the symbol scene; both instances reflect it; undo restores', () => {
    symbolWithTwoParts();
    const s = useEditor.getState();
    s.enterSymbol('sym');
    s.selectObject('pa');
    s.deleteSelectedObject();
    const sym = useEditor.getState().history.present.assets.find((a) => a.id === 'sym') as { objects: import('../../engine').SceneObject[] };
    expect(sym.objects.map((o) => o.id)).toEqual(['pb']); // pa gone
    expect(useEditor.getState().selectedObjectId).toBeNull();
    s.undo();
    const symBack = useEditor.getState().history.present.assets.find((a) => a.id === 'sym') as { objects: import('../../engine').SceneObject[] };
    expect(symBack.objects.map((o) => o.id)).toEqual(['pa', 'pb']);
  });

  it('keeps a vector asset still used inside a symbol when its ROOT user is deleted (cross-scene)', () => {
    const s = useEditor.getState();
    s.newProject();
    const shared = createVectorAsset('rect', { id: 'shared', shapeType: 'rect' });
    const sym = createSymbolAsset({ id: 'sym', objects: [createSceneObject('shared', { id: 'inner' })], width: 10, height: 10 });
    const p = createProject();
    p.assets = [shared, sym];
    p.objects = [createSceneObject('shared', { id: 'root-obj' }), createSceneObject('sym', { id: 'inst' })];
    s.commit(p);
    s.selectObject('root-obj');
    s.deleteSelectedObject();
    expect(useEditor.getState().history.present.assets.some((a) => a.id === 'shared')).toBe(true); // kept (used in sym)
  });

  it('keeps the SymbolAsset when its last instance is deleted (library persists)', () => {
    const s = useEditor.getState();
    s.newProject();
    const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
    const sym = createSymbolAsset({ id: 'sym', objects: [createSceneObject('rect-asset', { id: 'leaf' })], width: 10, height: 10 });
    const p = createProject();
    p.assets = [rectAsset, sym];
    p.objects = [createSceneObject('sym', { id: 'only' })];
    s.commit(p);
    s.selectObject('only');
    s.deleteSelectedObject();
    expect(useEditor.getState().history.present.objects).toHaveLength(0);
    expect(useEditor.getState().history.present.assets.some((a) => a.id === 'sym')).toBe(true); // symbol kept
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/store/store.test.ts -t "author-in-symbol delete"`
Expected: FAIL — the first test fails (delete no-ops inside a symbol today); the library/cross-scene tests fail (root-only prune drops the asset/symbol).

- [ ] **Step 3: Swap the import and rewrite the action**

In `src/ui/store/store.ts`, replace `  removeObject,` (in the multi-line `from '../../engine'` import block) with `  collectReferencedAssetIds,` (removeObject becomes unused; collectReferencedAssetIds is now used).

Replace the `deleteSelectedObject` implementation with:

```ts
  deleteSelectedObject() {
    const s = get();
    const project = s.history.present;
    const objects = selectActiveObjects(s); // root, or the edited symbol's scene (47-edit)
    const activeId = selectActiveAssetId(s);
    // Selected, non-locked ids that live in the ACTIVE scene.
    const ids = s.selectedObjectIds.filter((id) => {
      const o = objects.find((x) => x.id === id);
      return !!o && !o.locked;
    });
    if (ids.length === 0) return;
    // Cascade: deleting a group CONTAINER removes its whole subtree (recursively for nested
    // groups, 45e) so descendants aren't orphaned with a dangling parentId.
    const toDelete = new Set(ids);
    for (let changed = true; changed; ) {
      changed = false;
      for (const o of objects) {
        if (o.parentId && toDelete.has(o.parentId) && !toDelete.has(o.id)) {
          toDelete.add(o.id);
          changed = true;
        }
      }
    }
    const candidateAssetIds = new Set<string>();
    for (const o of objects) if (toDelete.has(o.id) && o.assetId) candidateAssetIds.add(o.assetId);
    const nextObjects = objects.filter((o) => !toDelete.has(o.id));
    if (nextObjects.length === objects.length) return; // nothing removed
    // Write the active scene back (root project.objects, or the edited symbol asset).
    let nextProject = activeId
      ? {
          ...project,
          assets: project.assets.map((a) =>
            a.id === activeId && a.kind === 'symbol' ? { ...a, objects: nextObjects } : a,
          ),
        }
      : { ...project, objects: nextObjects };
    // Cross-scene, symbol-preserving prune: drop a deleted object's vector/svg asset only when it
    // is referenced nowhere in the post-delete project; never prune symbol (library) / audio assets.
    const referenced = collectReferencedAssetIds(nextProject);
    const prunedAssets = nextProject.assets.filter((a) => {
      if (!candidateAssetIds.has(a.id)) return true;
      if (a.kind === 'symbol' || a.kind === 'audio') return true;
      return referenced.has(a.id);
    });
    nextProject = { ...nextProject, assets: prunedAssets };
    get().commit(nextProject);
    get().selectObject(null);
  },
```

- [ ] **Step 4: Run to verify pass + the whole store suite**

Run: `npx vitest run src/ui/store/store.test.ts -t "author-in-symbol delete"`
Expected: PASS. Then the whole store suite (existing root-delete tests — 1:1 vector pruned, shared svg kept, group-cascade, bulk, locked-skip, no-op — must stay green):
Run: `npx vitest run src/ui/store/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(in-symbol-delete): scene-aware deleteSelectedObject + cross-scene symbol-preserving prune"
```

---

### Task 3: e2e + full-suite verification

**Files:**
- Modify: `e2e/symbols.spec.ts`

- [ ] **Step 1: Write the e2e test**

Append to `e2e/symbols.spec.ts`. Create a symbol from TWO shapes (so it has two internal parts and the instance has two leaves), duplicate the instance, enter edit mode, delete one internal part, confirm both instances lose it.

```ts
test('delete an internal part inside a symbol — both instances lose it (author-in-symbol delete)', async ({
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

  // Two rects -> Create Symbol (2 internal parts) -> duplicate the instance (2 instances).
  await drawRect(120, 100, 170, 150);
  await drawRect(220, 100, 270, 150);
  await page.locator('[data-savig-object]').nth(0).click();
  await page.locator('[data-savig-object]').nth(1).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Create Symbol', exact: true }).click();
  await page.keyboard.press('Control+d');
  // 2 instances x 2 internal parts = 4 composite leaves.
  await expect(page.locator('[data-savig-object*="/"]')).toHaveCount(4);

  // Enter the symbol (double-click a leaf), select ONE internal part, delete it.
  await page.locator('[data-savig-object*="/"]').first().dblclick();
  await expect(page.getByTestId('edit-breadcrumb')).toBeVisible();
  await page.locator('[data-savig-object]:not([data-savig-object*="/"])').first().click();
  await page.keyboard.press('Delete');

  // Exit; each instance now has ONE internal part -> 2 instances x 1 part = 2 composite leaves.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('edit-breadcrumb')).toHaveCount(0);
  await expect(page.locator('[data-savig-object*="/"]')).toHaveCount(2);
});
```
> Verify the Delete key path (`useKeyboard` → `deleteSelectedObject`) fires for a selected internal object in edit mode; if the harness needs the Stage focused, click a leaf first (already done). The contract: deleting one internal part drops it from BOTH instances (4 leaves → 2).

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
git commit -m "test(in-symbol-delete): e2e delete an internal part inside a symbol"
```

---

## Self-Review

**1. Spec coverage** (spec §2–§7):
- §2 `collectReferencedAssetIds` + prune rule → Task 1 (helper) + Task 2 (rule applied). §3 scene-aware delete (active scene, cascade, build next project, prune, commit) → Task 2. §4 behaviour changes (edit-mode delete; cross-scene keep; library keep) → Task 2 tests. §5 no UI change (Global Constraints + no UI task). §6 parity/undo (no engine-render change; one snapshot) → Global Constraints + Task 2. §7 deferred (draw/node/group/clipboard) — not implemented; cut partial behaviour documented in the spec. §9 tests → engine (T1), store (T2), e2e (T3). ✅

**2. Placeholder scan:** No TBD/TODO; complete code/tests. One calibration note (the e2e Delete-key focus) states the contract. ✅

**3. Type consistency:** `collectReferencedAssetIds(project): Set<string>` used identically in Task 1 (def) and Task 2 (consume). The prune predicate (`candidateAssetIds.has(a.id)` → keep symbol/audio → else `referenced.has(a.id)`) matches §2. The import swap removes `removeObject` (now unused) and adds `collectReferencedAssetIds`. ✅

**4. Parity:** no `flattenInstances`/`computeFrame`/`renderDocument`/runtime change; `collectReferencedAssetIds` is a pure read. ✅
