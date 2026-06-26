# Author Inside a Symbol — Phase 7: In-Symbol Group / Boolean Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `groupSelected` / `ungroupSelected` / `booleanOp` operate on a symbol's internal scene in edit mode.

**Architecture:** Reuse the active-scene seam. group/ungroup are pure `objects[]` restructures → scope reads to `selectActiveObjects(s)`, write via `commitActiveScene`. `booleanOp` passes a scene-scoped project to `booleanOpEngine` (so the world-bake resolves intra-symbol groups), writes the result object to the active scene via a new pure `withSceneObjects` helper, adds the new asset globally, and prunes orphaned source assets cross-scene (phase-1's `collectReferencedAssetIds` predicate). No engine-render change → preview==export parity untouched.

**Tech Stack:** TypeScript (strict), React, Zustand, Vitest (unit + jsdom), Playwright (e2e). No new dependencies.

## Global Constraints

- **Preview == export parity is sacred.** No change to `flattenInstances`/`computeFrame`/`renderDocument`/runtime, and none to `engine/geom/boolean.ts`.
- **No new dependencies.**
- **Active-scene routed:** read via `selectActiveObjects(s)`; write the whole array via `commitActiveScene(objects)` or pure `withSceneObjects(project, activeAssetId, objects)`; new ASSETS stay GLOBAL (`project.assets`).
- **Root behaviour byte-unchanged** for group/ungroup and the boolean bake/zOrder/removal; the boolean asset prune becomes the documented cross-scene improvement (a shared vector asset is no longer wrongly pruned).
- **No UI/keyboard change:** the Inspector multi-select panel already reads `selectActiveObjects`; Cmd+G / Cmd+Shift+G already fire in edit mode.
- **Commit cadence:** one commit per task (TDD). At plan end: `npm test`, `npm run typecheck`, `npx eslint src e2e`, `npm run e2e` all green.

---

### Task 1: `withSceneObjects` helper, `commitActiveScene` refactor, route `groupSelected` / `ungroupSelected`

**Files:**
- Modify: `src/ui/store/store.ts` (helper block near `appendToScene` ~line 355–390; `commitActiveScene` ~line 540–552; `groupSelected` ~line 1372–1399; `ungroupSelected` ~line 1400–1430)
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Produces: `withSceneObjects(project: Project, activeAssetId: string | null, objects: SceneObject[]): Project` (module-private; consumed by `booleanOp` in Task 2).
- Consumes: `selectActiveObjects`/`selectActiveAssetId`/`commitActiveScene`/`groupAABB`/`objectAABB`/`groupBBox`/`createGroupObject`/`bakeGroupIntoChild`/`resolveObjectAnchor`/`sampleObject` (all in scope).

- [ ] **Step 1: Write the failing tests**

Append a new describe block to `src/ui/store/store.test.ts` (after the `in-symbol clipboard` block). It will also host Task 2's boolean tests.

```ts
describe('in-symbol group/boolean (author-in-symbol phase 7)', () => {
  const square = (sz: number, off: number): PathData => ({
    closed: true,
    nodes: [
      { anchor: { x: off, y: off } },
      { anchor: { x: off + sz, y: off } },
      { anchor: { x: off + sz, y: off + sz } },
      { anchor: { x: off, y: off + sz } },
    ],
  });
  // A symbol with two overlapping vector-path parts (pa 0..10, pb 5..15) + two instances.
  function symbolWithTwoParts() {
    const s = useEditor.getState();
    s.newProject();
    const paAsset = createVectorAsset('path', { id: 'pa-asset', path: square(10, 0) });
    const pbAsset = createVectorAsset('path', { id: 'pb-asset', path: square(10, 5) });
    const pa = createSceneObject('pa-asset', { id: 'pa', name: 'A', zOrder: 0 });
    const pb = createSceneObject('pb-asset', { id: 'pb', name: 'B', zOrder: 1 });
    const sym = createSymbolAsset({ id: 'sym', objects: [pa, pb], width: 20, height: 20 });
    const p = createProject();
    p.assets = [paAsset, pbAsset, sym];
    p.objects = [createSceneObject('sym', { id: 'inst1' }), createSceneObject('sym', { id: 'inst2' })];
    s.commit(p);
    s.enterSymbol('sym');
  }
  const symObjs = () =>
    (useEditor.getState().history.present.assets.find((a) => a.id === 'sym') as { objects: import('../../engine').SceneObject[] }).objects;

  it('groupSelected groups two INTERNAL objects inside the symbol (not root)', () => {
    symbolWithTwoParts();
    useEditor.getState().selectObjects(['pa', 'pb']);
    useEditor.getState().groupSelected();
    const objs = symObjs();
    const group = objs.find((o) => o.isGroup);
    expect(group).toBeTruthy();
    expect(objs.find((o) => o.id === 'pa')!.parentId).toBe(group!.id);
    expect(objs.find((o) => o.id === 'pb')!.parentId).toBe(group!.id);
    expect(useEditor.getState().history.present.objects.map((o) => o.id)).toEqual(['inst1', 'inst2']); // root untouched
  });

  it('ungroupSelected dissolves an INTERNAL group inside the symbol', () => {
    symbolWithTwoParts();
    useEditor.getState().selectObjects(['pa', 'pb']);
    useEditor.getState().groupSelected();
    const gid = symObjs().find((o) => o.isGroup)!.id;
    useEditor.getState().selectObject(gid);
    useEditor.getState().ungroupSelected();
    const objs = symObjs();
    expect(objs.some((o) => o.isGroup)).toBe(false); // container gone
    expect(objs.find((o) => o.id === 'pa')!.parentId ?? null).toBeNull(); // child freed
    expect(objs.map((o) => o.id).sort()).toEqual(['pa', 'pb']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/store/store.test.ts -t "in-symbol group/boolean"`
Expected: FAIL — group/ungroup resolve the root `project.objects`, find no `pa`/`pb`, and no-op (the symbol's objects stay `['pa','pb']` ungrouped / unchanged).

- [ ] **Step 3: Add `withSceneObjects` and refactor `commitActiveScene`**

In `src/ui/store/store.ts`, immediately AFTER the `appendToScene` function (the helper block near line 380), add:

```ts
// Write the active scene's WHOLE objects[] into a project (root project.objects, or the edited
// symbol's objects[]). The array-write dual of sceneObjectsOf. (author-in-symbol group/boolean, phase 7)
function withSceneObjects(project: Project, activeAssetId: string | null, objects: SceneObject[]): Project {
  if (!activeAssetId) return { ...project, objects };
  return {
    ...project,
    assets: project.assets.map((a) =>
      a.id === activeAssetId && a.kind === 'symbol' ? { ...a, objects } : a,
    ),
  };
}
```

Then replace the `commitActiveScene` body:

```ts
  commitActiveScene(nextObjects) {
    const s = get();
    const id = selectActiveAssetId(s);
    const project = s.history.present;
    if (!id) {
      get().commit({ ...project, objects: nextObjects });
      return;
    }
    const assets = project.assets.map((a) =>
      a.id === id && a.kind === 'symbol' ? { ...a, objects: nextObjects } : a,
    );
    get().commit({ ...project, assets });
  },
```

with:

```ts
  commitActiveScene(nextObjects) {
    const s = get();
    get().commit(withSceneObjects(s.history.present, selectActiveAssetId(s), nextObjects));
  },
```

- [ ] **Step 4: Route `groupSelected`**

In `groupSelected`, add an active-scene local and re-scope the three scene reads + the commit. Change the head:

```ts
  groupSelected() {
    const s = get();
    const project = s.history.present;
    const time = snapToFrame(s.time, project.meta.fps);
```

to add the local:

```ts
  groupSelected() {
    const s = get();
    const project = s.history.present;
    const activeObjects = selectActiveObjects(s);
    const time = snapToFrame(s.time, project.meta.fps);
```

Then change `const targets = s.selectedObjectIds.map((id) => project.objects.find((o) => o.id === id))` →
`const targets = s.selectedObjectIds.map((id) => activeObjects.find((o) => o.id === id))`.

Change `groupAABB(o, project.objects, project.assets, time)` → `groupAABB(o, activeObjects, project.assets, time)`.

Change `const objects = [...project.objects.map((o) => (ids.has(o.id) ? { ...o, parentId: gid } : o)), group];` →
`const objects = [...activeObjects.map((o) => (ids.has(o.id) ? { ...o, parentId: gid } : o)), group];`.

Change `get().commit({ ...project, objects });` → `get().commitActiveScene(objects);`.

- [ ] **Step 5: Route `ungroupSelected`**

In `ungroupSelected`, add the same local and re-scope the two reads + commit. Change the head:

```ts
  ungroupSelected() {
    const s = get();
    const project = s.history.present;
    const time = snapToFrame(s.time, project.meta.fps);
    const groups = s.selectedObjectIds
      .map((id) => project.objects.find((o) => o.id === id))
```

to:

```ts
  ungroupSelected() {
    const s = get();
    const project = s.history.present;
    const activeObjects = selectActiveObjects(s);
    const time = snapToFrame(s.time, project.meta.fps);
    const groups = s.selectedObjectIds
      .map((id) => activeObjects.find((o) => o.id === id))
```

Change `const objects = project.objects` (the start of the `.map(...).filter(...)` chain that bakes/reparents/drops) → `const objects = activeObjects`.

Change `get().commit({ ...project, objects });` → `get().commitActiveScene(objects);`.

- [ ] **Step 6: Run to verify pass + the whole store suite**

Run: `npx vitest run src/ui/store/store.test.ts -t "in-symbol group/boolean"`
Expected: PASS (group + ungroup). Then the whole store suite (existing root group/ungroup + `commitActiveScene` tests must stay green):
Run: `npx vitest run src/ui/store/store.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck + commit**

```bash
npm run typecheck
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(in-symbol-group-boolean): withSceneObjects + route groupSelected/ungroupSelected to the active scene"
```

---

### Task 2: Route `booleanOp` to the active scene + cross-scene asset prune

**Files:**
- Modify: `src/ui/store/store.ts` (`booleanOp` ~line 1521–1593)
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Consumes: `withSceneObjects` (Task 1), `selectActiveObjects`/`selectActiveAssetId`/`booleanOpEngine`/`collectReferencedAssetIds`/`ringArea`/`pathBounds`/`createVectorAsset`/`createSceneObject`/`nextZOrder`/`DEFAULT_TRANSFORM` (all in scope).

- [ ] **Step 1: Write the failing tests**

Append to the `in-symbol group/boolean (author-in-symbol phase 7)` describe block (so `symbolWithTwoParts`/`symObjs`/`square` are in scope):

```ts
  it('booleanOp union replaces two INTERNAL sources with one result inside the symbol', () => {
    symbolWithTwoParts();
    useEditor.getState().selectObjects(['pa', 'pb']);
    useEditor.getState().booleanOp('union');
    const objs = symObjs();
    expect(objs).toHaveLength(1); // 2 sources -> 1 result, inside the symbol
    expect(objs.some((o) => o.id === 'pa' || o.id === 'pb')).toBe(false); // sources gone
    const result = objs[0];
    const resultAsset = useEditor.getState().history.present.assets.find((a) => a.id === result.assetId);
    expect(resultAsset?.kind).toBe('vector'); // new GLOBAL vector asset
    expect(useEditor.getState().history.present.objects.map((o) => o.id)).toEqual(['inst1', 'inst2']); // root untouched
  });

  it('booleanOp cross-scene prune: keeps a source asset still referenced at the root, prunes a symbol-only one', () => {
    const s = useEditor.getState();
    s.newProject();
    const sharedAsset = createVectorAsset('path', { id: 'shared-asset', path: square(10, 0) });
    const pbAsset = createVectorAsset('path', { id: 'pb-asset', path: square(10, 5) });
    const pa = createSceneObject('shared-asset', { id: 'pa', zOrder: 0 }); // boolean source, asset shared with root
    const pb = createSceneObject('pb-asset', { id: 'pb', zOrder: 1 }); // boolean source, symbol-only asset
    const sym = createSymbolAsset({ id: 'sym', objects: [pa, pb], width: 20, height: 20 });
    const p = createProject();
    p.assets = [sharedAsset, pbAsset, sym];
    p.objects = [
      createSceneObject('shared-asset', { id: 'root-user', zOrder: 0 }), // root object also uses shared-asset
      createSceneObject('sym', { id: 'inst' }),
    ];
    s.commit(p);
    s.enterSymbol('sym');
    s.selectObjects(['pa', 'pb']);
    s.booleanOp('union');
    const assets = useEditor.getState().history.present.assets;
    expect(assets.some((a) => a.id === 'shared-asset')).toBe(true); // kept: still used by root-user
    expect(assets.some((a) => a.id === 'pb-asset')).toBe(false); // pruned: symbol-only source
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/store/store.test.ts -t "booleanOp union replaces two INTERNAL|cross-scene prune"`
Expected: FAIL — `booleanOp` reads root `project.objects`; inside a symbol the eligible ids aren't found (`< 2` → early return), so the symbol keeps both parts and no result asset is created.

- [ ] **Step 3: Route `booleanOp`**

In `booleanOp`, add the active-scene locals to the head. Change:

```ts
  booleanOp(op) {
    const s = get();
    const project = s.history.present;
    const time = snapToFrame(s.time, project.meta.fps);
    const eligible = s.selectedObjectIds
      .map((id) => project.objects.find((o) => o.id === id))
```

to:

```ts
  booleanOp(op) {
    const s = get();
    const project = s.history.present;
    const activeObjects = selectActiveObjects(s);
    const activeAssetId = selectActiveAssetId(s);
    const time = snapToFrame(s.time, project.meta.fps);
    const eligible = s.selectedObjectIds
      .map((id) => activeObjects.find((o) => o.id === id))
```

Change the engine call to pass a scene-scoped project:

```ts
    const rings = booleanOpEngine(project, eligible, op, time); // world space
```

to:

```ts
    const rings = booleanOpEngine({ ...project, objects: activeObjects }, eligible, op, time); // world space (active scene)
```

Change both zOrder reads — `name: \`${label} ${nextZOrder(project.objects) + 1}\`` and `zOrder: nextZOrder(project.objects)` — to use `activeObjects`:

```ts
    const obj = createSceneObject(asset.id, {
      name: `${label} ${nextZOrder(activeObjects) + 1}`,
      zOrder: nextZOrder(activeObjects),
      anchorMode: 'fraction',
      anchorX: 0.5,
      anchorY: 0.5,
      base: { ...DEFAULT_TRANSFORM, x: box.minX, y: box.minY },
    });
```

Then replace the destructive-replace tail — from `const removed = new Set(...)` through the final `set({ selectedObjectId: obj.id, ... })`:

```ts
    const removed = new Set(eligible.map((o) => o.id));
    const objects = [...project.objects.filter((o) => !removed.has(o.id)), obj];
    // Prune ONLY the source objects' now-unreferenced assets (vector assets are 1:1 with
    // objects), mirroring removeObject's convention so destructive boolean ops don't accrete
    // orphans. Scoped to the removed sources' assets so unrelated assets (e.g. audio referenced
    // by audioClips, or assets shared with surviving objects) are untouched.
    const orphanedAssetIds = new Set(
      eligible
        .map((o) => o.assetId)
        .filter((aid) => !objects.some((o) => o.assetId === aid)),
    );
    const assets = [...project.assets.filter((a) => !orphanedAssetIds.has(a.id)), asset];
    get().commit({ ...project, assets, objects });
    set({ selectedObjectId: obj.id, selectedObjectIds: [obj.id], selectedKeyframe: null, selectedNodeIndex: null });
```

with:

```ts
    const removed = new Set(eligible.map((o) => o.id));
    const nextObjects = [...activeObjects.filter((o) => !removed.has(o.id)), obj];
    // Write the result object to the ACTIVE scene + add the new vector asset GLOBAL.
    let nextProject = withSceneObjects(project, activeAssetId, nextObjects);
    nextProject = { ...nextProject, assets: [...nextProject.assets, asset] };
    // Cross-scene, symbol-preserving prune of the now-orphaned SOURCE vector assets (phase-1 style):
    // keep a source asset if it is still referenced anywhere (root + every symbol scene); never prune
    // symbol (library) / audio assets (the sources are vector anyway).
    const candidateAssetIds = new Set(eligible.map((o) => o.assetId));
    const referenced = collectReferencedAssetIds(nextProject);
    nextProject = {
      ...nextProject,
      assets: nextProject.assets.filter((a) => {
        if (!candidateAssetIds.has(a.id)) return true;
        if (a.kind === 'symbol' || a.kind === 'audio') return true;
        return referenced.has(a.id);
      }),
    };
    get().commit(nextProject);
    set({ selectedObjectId: obj.id, selectedObjectIds: [obj.id], selectedKeyframe: null, selectedNodeIndex: null });
```

- [ ] **Step 4: Run to verify pass + the whole store suite**

Run: `npx vitest run src/ui/store/store.test.ts -t "in-symbol group/boolean"`
Expected: PASS (group, ungroup, union, cross-scene prune). Then the whole store suite (existing root `booleanOp (slice 46)` tests — replace, prune, undo — must stay green; vector assets are 1:1 so the cross-scene predicate gives the same result at the root):
Run: `npx vitest run src/ui/store/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(in-symbol-group-boolean): route booleanOp to the active scene + cross-scene asset prune"
```

---

### Task 3: e2e + full-suite verification

**Files:**
- Modify: `e2e/symbols.spec.ts`

- [ ] **Step 1: Write the e2e test**

Append to `e2e/symbols.spec.ts`. Create a symbol with TWO overlapping parts and two instances, enter it, select both, Union → the symbol now renders ONE merged part, so each instance shows one leaf (2 total).

```ts
test('union two parts inside a symbol — every instance renders one merged part (author-in-symbol boolean)', async ({
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

  // Two OVERLAPPING rects so union yields a single region.
  await drawRect(120, 100, 180, 160);
  await drawRect(150, 130, 210, 190);
  await page.locator('[data-savig-object]').nth(0).click();
  await page.locator('[data-savig-object]').nth(1).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Create Symbol', exact: true }).click();
  await page.keyboard.press('Control+d');
  await expect(page.locator('[data-savig-object*="/"]')).toHaveCount(4); // 2 instances x 2 parts

  // Enter the symbol, select both internal parts, Union them.
  await page.locator('[data-savig-object*="/"]').last().dblclick();
  await expect(page.getByTestId('edit-breadcrumb')).toBeVisible();
  const internal = page.locator('[data-savig-object]:not([data-savig-object*="/"])');
  await internal.nth(0).click();
  await internal.nth(1).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Union', exact: true }).click();

  // Exit; the symbol now has ONE part -> 2 instances x 1 part = 2 leaves.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('edit-breadcrumb')).toHaveCount(0);
  await expect(page.locator('[data-savig-object*="/"]')).toHaveCount(2);
});
```

> The Inspector's Union button is enabled because its `canBool` gate reads `selectActiveObjects` (the symbol's two vector parts). A rect is a vector asset, so both parts are eligible. After Union the two source path/rect objects are replaced by one result object → one leaf per instance.

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
git commit -m "test(in-symbol-group-boolean): e2e union two parts inside a symbol"
```

---

## Self-Review

**1. Spec coverage** (spec §2–6):
- §2.1 group/ungroup routing → Task 1. §2.2 booleanOp (scene-scoped engine + active-scene write + cross-scene prune) → Task 2. §2.3 `withSceneObjects` + `commitActiveScene` refactor → Task 1. §3 parity/undo/no-UI → Global Constraints. §4 scope (in: 3 actions + helper + prune; deferred: motion/morph) — implemented; deferred not in scope. §6 tests → store (Task 1 group/ungroup, Task 2 union/cross-scene prune), e2e (Task 3). ✅

**2. Placeholder scan:** No TBD/TODO; every code step shows full code. The e2e note states the confirmed `canBool`/Union-button contract. ✅

**3. Type consistency:** `withSceneObjects(project: Project, activeAssetId: string | null, objects: SceneObject[]): Project` defined in Task 1, consumed verbatim in Task 2. `booleanOpEngine({ ...project, objects: activeObjects }, eligible, op, time)` matches the engine signature `booleanOp(project: Project, objs: SceneObject[], op: BoolOp, time: number): PathData[]`. The prune predicate mirrors phase-1 delete (store.ts ~884): `candidateAssetIds`/`collectReferencedAssetIds(nextProject)`/keep-if-symbol-or-audio/`referenced.has`. ✅

**4. Parity:** no `flattenInstances`/`computeFrame`/`renderDocument`/`engine/geom/boolean.ts` change; the engine is called with a scene-scoped project (pure read). ✅
