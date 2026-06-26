# Author Inside a Symbol — Phase 6: In-Symbol Clipboard (copy/paste) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make object copy/cut/paste operate on a symbol's internal scene when the editor is in symbol edit mode, with a paste-time cycle guard.

**Architecture:** Reuse the active-scene seam. `copySelected` reads `selectActiveObjects(s)` (assets stay global). `paste` routes its object append + incremental zOrder to the active scene via two new pure helpers — `sceneObjectsOf` (read) and `appendToScene` (object-only write) — with `appendObjectToScene` refactored to compose `appendToScene`; assets stay global. A paste-time cycle guard skips symbol-instance entries that would make the active symbol contain itself. `cut` needs no change (it composes copySelected + deleteSelectedObject, both now scene-aware). No engine-render change → preview==export parity untouched.

**Tech Stack:** TypeScript (strict), React, Zustand, Vitest (unit + jsdom), Playwright (e2e). No new dependencies.

## Global Constraints

- **Preview == export parity is sacred.** No change to `flattenInstances`/`computeFrame`/`renderDocument`/runtime.
- **No new dependencies.**
- **Active-scene routed:** read via `selectActiveObjects(s)`/`sceneObjectsOf(project, activeAssetId)`; write objects via `appendToScene(project, activeAssetId, obj)`; assets stay GLOBAL (`project.assets`).
- **Root behaviour byte-unchanged:** `sceneObjectsOf(p, null) === p.objects`; `appendToScene(p, null, o) === { ...p, objects: [...p.objects, o] }`; `appendObjectToScene` byte-identical after refactor.
- **No UI/keyboard change:** `useKeyboard.ts` already calls `copySelected`/`cut`/`paste` with no edit-mode gate.
- **Commit cadence:** one commit per task (TDD). At plan end: `npm test`, `npm run typecheck`, `npx eslint src e2e`, `npm run e2e` all green.

---

### Task 1: Add the `sceneObjectsOf` / `appendToScene` helpers and refactor `appendObjectToScene`

**Files:**
- Modify: `src/ui/store/store.ts` (the helper block near `replaceObjectInScene`/`appendObjectToScene`, ~lines 355–387)

**Interfaces:**
- Produces: `sceneObjectsOf(project: Project, activeAssetId: string | null): SceneObject[]` and `appendToScene(project: Project, activeAssetId: string | null, obj: SceneObject): Project` (module-private, consumed by `paste` in Task 3).
- `appendObjectToScene(project, activeAssetId, asset, obj): Project` — signature unchanged, now composes `appendToScene`.

This task is a pure refactor with no behaviour change, so its "test" is the existing draw test suite (which exercises `appendObjectToScene`) plus typecheck. No new test file.

- [ ] **Step 1: Add the two helpers and refactor `appendObjectToScene`**

In `src/ui/store/store.ts`, replace the existing `appendObjectToScene` definition:

```ts
// Add a freshly-created asset to the GLOBAL assets[] and its object to the ACTIVE scene (root
// project.objects, or the edited symbol's objects[] when activeAssetId is set). Caller commits +
// sets selection. (author-in-symbol draw, phase 2)
function appendObjectToScene(
  project: Project,
  activeAssetId: string | null,
  asset: Asset,
  obj: SceneObject,
): Project {
  const assets = [...project.assets, asset];
  return activeAssetId
    ? {
        ...project,
        assets: assets.map((a) =>
          a.id === activeAssetId && a.kind === 'symbol' ? { ...a, objects: [...a.objects, obj] } : a,
        ),
      }
    : { ...project, assets, objects: [...project.objects, obj] };
}
```

with:

```ts
// The active scene's objects[] from any project + activeAssetId: root project.objects, or the
// edited symbol's objects[] (missing/non-symbol asset -> root). Read dual of appendToScene.
// (author-in-symbol clipboard, phase 6)
function sceneObjectsOf(project: Project, activeAssetId: string | null): SceneObject[] {
  if (!activeAssetId) return project.objects;
  const a = project.assets.find((x) => x.id === activeAssetId);
  return a && a.kind === 'symbol' ? a.objects : project.objects;
}

// Append ONE object to the ACTIVE scene (root project.objects, or the edited symbol's objects[]).
// No asset add. (author-in-symbol clipboard, phase 6)
function appendToScene(project: Project, activeAssetId: string | null, obj: SceneObject): Project {
  if (!activeAssetId) return { ...project, objects: [...project.objects, obj] };
  return {
    ...project,
    assets: project.assets.map((a) =>
      a.id === activeAssetId && a.kind === 'symbol' ? { ...a, objects: [...a.objects, obj] } : a,
    ),
  };
}

// Add a freshly-created asset to the GLOBAL assets[] and its object to the ACTIVE scene. Caller
// commits + sets selection. (author-in-symbol draw, phase 2 — now composes appendToScene)
function appendObjectToScene(
  project: Project,
  activeAssetId: string | null,
  asset: Asset,
  obj: SceneObject,
): Project {
  return appendToScene({ ...project, assets: [...project.assets, asset] }, activeAssetId, obj);
}
```

- [ ] **Step 2: Typecheck + verify the existing draw suite still passes (proves the refactor is behaviour-preserving)**

Run: `npm run typecheck`
Expected: no errors.
Run: `npx vitest run src/ui/store/store.test.ts -t "author-in-symbol draw|addVectorShape|addPrimitive|addVectorPath"`
Expected: PASS (the draw/create actions that call `appendObjectToScene` are unchanged).

> If the `-t` filter matches nothing in your tree, run the whole file: `npx vitest run src/ui/store/store.test.ts` — it must stay green.

- [ ] **Step 3: Commit**

```bash
git add src/ui/store/store.ts
git commit -m "refactor(store): extract sceneObjectsOf/appendToScene; appendObjectToScene composes them"
```

---

### Task 2: Route `copySelected` to the active scene

**Files:**
- Modify: `src/ui/store/store.ts` (`copySelected`, ~lines 595–607)
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Consumes: `selectActiveObjects(s)` (already imported).

- [ ] **Step 1: Write the failing test**

Append a new describe block to `src/ui/store/store.test.ts` (after the `in-symbol Layers mutators` block). It will also host Task 3's tests.

```ts
describe('in-symbol clipboard (author-in-symbol phase 6)', () => {
  function symbolWithOne() {
    const s = useEditor.getState();
    s.newProject();
    const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
    const part = createSceneObject('rect-asset', { id: 'part', name: 'Part', zOrder: 0 });
    const sym = createSymbolAsset({ id: 'sym', objects: [part], width: 10, height: 10 });
    const p = createProject();
    p.assets = [rectAsset, sym];
    p.objects = [createSceneObject('sym', { id: 'inst1' }), createSceneObject('sym', { id: 'inst2' })];
    s.commit(p);
    s.enterSymbol('sym');
  }
  const symObjs = () =>
    (useEditor.getState().history.present.assets.find((a) => a.id === 'sym') as { objects: import('../../engine').SceneObject[] }).objects;

  it('copySelected snapshots an INTERNAL object inside a symbol (not root)', () => {
    symbolWithOne();
    useEditor.getState().selectObject('part');
    useEditor.getState().copySelected();
    const clip = useEditor.getState().clipboard;
    expect(clip).toHaveLength(1);
    expect(clip![0].object.id).toBe('part'); // the internal object, found via the active scene
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/store/store.test.ts -t "copySelected snapshots an INTERNAL"`
Expected: FAIL — `copySelected` reads root `project.objects`, where `part` is absent, so the clipboard stays null/empty.

- [ ] **Step 3: Route `copySelected`**

Replace the `copySelected` body's read source. Change:

```ts
    const entries = s.selectedObjectIds
      .map((id) => project.objects.find((o) => o.id === id))
```

to:

```ts
    const objects = selectActiveObjects(s);
    const entries = s.selectedObjectIds
      .map((id) => objects.find((o) => o.id === id))
```

(Leave the `.filter`/`.sort`/`.map((obj) => ({ object: obj, asset: project.assets.find(...) }))` tail and the `set({ clipboard: entries, keyframeClipboard: null })` unchanged — the asset lookup stays global.)

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/ui/store/store.test.ts -t "copySelected snapshots an INTERNAL"`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(in-symbol-clipboard): route copySelected to the active scene"
```

---

### Task 3: Route `paste` to the active scene + add the cycle guard

**Files:**
- Modify: `src/ui/store/store.ts` (`paste`, ~lines 612–630)
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Consumes: `sceneObjectsOf`/`appendToScene` (Task 1), `selectActiveAssetId`/`selectActiveObjects` (imported), `isSymbolInstance` (imported), `symbolContains` (imported), `nextZOrder`/`duplicateObject`/`newId`/`DUP_OFFSET` (in scope), `pushToast`.

- [ ] **Step 1: Write the failing tests**

Append to the `in-symbol clipboard (author-in-symbol phase 6)` describe block (so `symbolWithOne`/`symObjs` are in scope):

```ts
  it('paste appends the clone to the SYMBOL scene, not root; instances reflect it', () => {
    symbolWithOne();
    useEditor.getState().selectObject('part');
    useEditor.getState().copySelected();
    useEditor.getState().paste();
    expect(symObjs()).toHaveLength(2); // original + pasted clone, inside the symbol
    expect(useEditor.getState().history.present.objects.map((o) => o.id)).toEqual(['inst1', 'inst2']); // root untouched
  });

  it('cut inside a symbol removes the part AND populates the clipboard (re-pasteable)', () => {
    symbolWithOne();
    useEditor.getState().selectObject('part');
    useEditor.getState().cut();
    expect(symObjs()).toHaveLength(0); // removed from the symbol
    expect(useEditor.getState().clipboard).toHaveLength(1); // copy half worked
    useEditor.getState().paste();
    expect(symObjs()).toHaveLength(1); // re-added by paste
  });

  it('cross-scene paste: copy inside a symbol, exit, paste -> clone lands at the ROOT', () => {
    symbolWithOne();
    useEditor.getState().selectObject('part');
    useEditor.getState().copySelected();
    useEditor.getState().exitSymbol();
    const rootBefore = useEditor.getState().history.present.objects.length;
    useEditor.getState().paste();
    expect(useEditor.getState().history.present.objects.length).toBe(rootBefore + 1); // landed at root
    expect(symObjs()).toHaveLength(1); // symbol unchanged
  });

  it('cycle guard: pasting a root instance of a symbol INTO that symbol is skipped + toasts', () => {
    const s = useEditor.getState();
    s.newProject();
    const sym = createSymbolAsset({ id: 'sym', name: 'Sym', objects: [], width: 10, height: 10 });
    const p = createProject();
    p.assets = [sym];
    p.objects = [createSceneObject('sym', { id: 'inst' })];
    s.commit(p);
    s.selectObject('inst'); // a root instance of sym
    s.copySelected();
    s.enterSymbol('sym'); // now editing sym itself
    const toastsBefore = useEditor.getState().toasts.length;
    s.paste();
    expect(symObjs()).toHaveLength(0); // nothing pasted into sym (would self-contain)
    expect(useEditor.getState().toasts.length).toBe(toastsBefore + 1); // error toast pushed
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/store/store.test.ts -t "in-symbol clipboard"`
Expected: the three new paste/cut tests FAIL (paste appends to root: symbol stays length 1, root grows) and the cycle-guard test FAILS (paste appends the instance into sym → length 1, no toast).

- [ ] **Step 3: Route `paste` + add the cycle guard**

Replace the entire `paste` body:

```ts
  paste() {
    const clip = get().clipboard;
    if (!clip || clip.length === 0) return;
    let project = get().history.present;
    const selectIds: string[] = [];
    for (const entry of clip) {
      const { object, clonedAsset } = duplicateObject(entry.object, entry.asset, { objectId: newId(), assetId: newId() }, DUP_OFFSET);
      const placed = { ...object, zOrder: nextZOrder(project.objects) };
      // Ensure the referenced asset exists: clonedAsset for a vector asset; otherwise
      // re-add the clipboard's shared/svg asset if the project no longer has it (cross-project paste).
      let assets = project.assets;
      if (clonedAsset) assets = [...assets, clonedAsset];
      else if (entry.asset && !assets.some((a) => a.id === placed.assetId)) assets = [...assets, entry.asset];
      project = { ...project, assets, objects: [...project.objects, placed] };
      if (!placed.locked) selectIds.push(placed.id); // don't select a locked clone (Slice-19)
    }
    get().commit(project);
    get().selectObjects(selectIds);
  },
```

with:

```ts
  paste() {
    const s = get();
    const clip = s.clipboard;
    if (!clip || clip.length === 0) return;
    const activeAssetId = selectActiveAssetId(s); // active scene: null at root, symbol id in edit mode
    let project = s.history.present;
    const selectIds: string[] = [];
    let pasted = false;
    let skippedCyclic = false;
    for (const entry of clip) {
      // Cycle guard: pasting a symbol INSTANCE into a symbol that it would (transitively) contain
      // authors a cycle — same rejection as placeSymbolInstance/swapSymbol (47d cycle guard #2).
      if (
        activeAssetId &&
        isSymbolInstance(entry.object, project.assets) &&
        (entry.object.assetId === activeAssetId || symbolContains(entry.object.assetId, activeAssetId, project.assets))
      ) {
        skippedCyclic = true;
        continue;
      }
      const { object, clonedAsset } = duplicateObject(entry.object, entry.asset, { objectId: newId(), assetId: newId() }, DUP_OFFSET);
      const placed = { ...object, zOrder: nextZOrder(sceneObjectsOf(project, activeAssetId)) };
      // Ensure the referenced asset exists: clonedAsset for a vector asset; otherwise re-add the
      // clipboard's shared/svg/symbol asset if the project no longer has it (cross-project paste).
      let withAssets = project;
      if (clonedAsset) withAssets = { ...project, assets: [...project.assets, clonedAsset] };
      else if (entry.asset && !project.assets.some((a) => a.id === placed.assetId)) withAssets = { ...project, assets: [...project.assets, entry.asset] };
      project = appendToScene(withAssets, activeAssetId, placed); // object -> active scene; assets stay global
      pasted = true;
      if (!placed.locked) selectIds.push(placed.id); // don't select a locked clone (Slice-19)
    }
    if (skippedCyclic) get().pushToast('error', "Can't paste a symbol into itself — skipped.");
    if (!pasted) return; // every entry cyclic-skipped -> no commit (avoid an empty undo step) / no select clobber
    get().commit(project);
    get().selectObjects(selectIds);
  },
```

> Note: `pasted` (not `selectIds.length`) gates the commit — a non-cyclic LOCKED clone is pasted but not selected, so it must still commit. Only when EVERY entry was cyclic-skipped (`pasted` stays false) do we toast and return without an empty commit or a selection clobber.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/ui/store/store.test.ts -t "in-symbol clipboard"`
Expected: PASS (all five: copy + the three paste/cut + cycle guard).

- [ ] **Step 5: Run the whole store suite (root copy/paste regression check)**

Run: `npx vitest run src/ui/store/store.test.ts`
Expected: PASS — the existing root copy/paste tests (e.g. `paste` stacking, locked-clone, cross-project) must stay green, proving root behaviour is byte-unchanged.

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(in-symbol-clipboard): route paste to the active scene + paste-time cycle guard"
```

---

### Task 4: e2e + full-suite verification

**Files:**
- Modify: `e2e/symbols.spec.ts`

- [ ] **Step 1: Write the e2e test**

Append to `e2e/symbols.spec.ts`. Create a symbol with ONE part and two instances, enter it, select the internal part, copy + paste → the symbol gains a second part, so each instance renders two leaves (4 total).

```ts
test('copy + paste an internal part inside a symbol — every instance gains it (author-in-symbol clipboard)', async ({
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
  await page.locator('[data-savig-object]').first().click();
  await page.getByRole('button', { name: 'Create Symbol', exact: true }).click();
  await page.keyboard.press('Control+d');
  await expect(page.locator('[data-savig-object*="/"]')).toHaveCount(2); // 2 instances x 1 part

  // Enter the symbol, select the internal part, copy + paste it.
  await page.locator('[data-savig-object*="/"]').last().dblclick();
  await expect(page.getByTestId('edit-breadcrumb')).toBeVisible();
  await page.locator('[data-savig-object]:not([data-savig-object*="/"])').first().click();
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');

  // Exit; the symbol now has 2 parts -> 2 instances x 2 parts = 4 leaves.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('edit-breadcrumb')).toHaveCount(0);
  await expect(page.locator('[data-savig-object*="/"]')).toHaveCount(4);
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
Expected: all green. Parity suites unchanged-and-green.

- [ ] **Step 4: Commit**

```bash
git add e2e/symbols.spec.ts
git commit -m "test(in-symbol-clipboard): e2e copy+paste an internal part inside a symbol"
```

---

## Self-Review

**1. Spec coverage** (spec §2–6):
- §2.1 copySelected → Task 2. §2.2 paste routing + helpers → Tasks 1, 3. §2.3 cycle guard → Task 3. §3 cut/parity/undo → cut covered transitively (tested in Task 3), parity in Global Constraints. §4 scope (in: copy/paste/guard/helpers; deferred: group/boolean/motion/morph) — implemented; deferred not in scope. §6 tests → store (Tasks 2, 3: copy, paste, cut, cross-scene, cycle), e2e (Task 4). ✅

**2. Placeholder scan:** No TBD/TODO; every code step shows the full code. The one calibration note (e2e `-t` filter fallback) gives an explicit alternative command. ✅

**3. Type consistency:** `sceneObjectsOf(project: Project, activeAssetId: string | null): SceneObject[]` and `appendToScene(project: Project, activeAssetId: string | null, obj: SceneObject): Project` are defined in Task 1 and consumed verbatim in Task 3. `appendObjectToScene` keeps its 4-arg signature. The cycle guard uses `isSymbolInstance(obj, assets)` and `symbolContains(childId, containerId, assets)` exactly as `placeSymbolInstance` (store.ts:1457) does. `pushToast('error', msg)` matches store.ts:2000. ✅

**4. Parity:** no `flattenInstances`/`computeFrame`/`renderDocument`/runtime change; helpers are pure store functions. ✅
