# Author Inside a Symbol — Phase 3: In-Symbol Node-Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the node tool edit a path's nodes (drag/insert/delete/smooth/join + add/remove morph keyframes) *inside* a symbol's scene in edit mode.

**Architecture:** Two store changes: scope `selectedPathCtx` (the single object resolver shared by `setPathData`/`addShapeKeyframe`/`removeShapeKeyframe`) to the active scene, and add a pure `replaceObjectInScene(project, activeAssetId, next)` for the morph-branch object writes (the static-path branch already writes the global asset, so it works once the object is found). Then add `'node'` to `SYMBOL_EDIT_TOOLS` and land in-symbol path draws on `node` again. No engine-render change → preview==export parity untouched.

**Tech Stack:** TypeScript (strict), React, Zustand, Vitest (unit + jsdom), Playwright (e2e). No new dependencies.

## Global Constraints

- **Preview == export parity is sacred.** No change to `flattenInstances`/`computeFrame`/`renderDocument`/runtime.
- **No new dependencies.**
- **Active-scene routed:** `selectedPathCtx` resolves the selected object from `selectActiveObjects` (root or the edited symbol); morph-branch object writes use `replaceObjectInScene`; ASSET writes stay global (unchanged — assets are project-wide).
- **Root behaviour byte-unchanged:** `replaceObjectInScene(project, null, next) === replaceObject(project, next)`; root node-edit is identical to today.
- **Gate:** add `'node'` to `SYMBOL_EDIT_TOOLS`; `motion` stays gated.
- **Commit cadence:** one commit per task (TDD). At plan end: `npm test`, `npm run typecheck`, `npx eslint src e2e`, `npm run e2e` all green; engine/parity suites green.

---

### Task 1: Scene-aware `selectedPathCtx` + `replaceObjectInScene` + route the 3 node-edit writes

**Files:**
- Modify: `src/ui/store/store.ts`
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Consumes: `selectActiveObjects`/`selectActiveAssetId` (already imported), `replaceObject`/`samplePath`/`removeShapeKeyframeAt`/`upsertShapeKeyframe` (in scope).
- Produces: module helper `replaceObjectInScene(project: Project, activeAssetId: string | null, next: SceneObject): Project`; `selectedPathCtx` now resolves the object from the active scene.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/store/store.test.ts`:

```ts
describe('in-symbol node-edit (author-in-symbol phase 3)', () => {
  function symbolWithPath() {
    const s = useEditor.getState();
    s.newProject();
    const pathAsset = createVectorAsset('path', {
      id: 'path-asset',
      path: { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 20, y: 0 } }] },
    });
    const pathObj = createSceneObject('path-asset', { id: 'p', zOrder: 0 });
    const sym = createSymbolAsset({ id: 'sym', objects: [pathObj], width: 20, height: 10 });
    const p = createProject();
    p.assets = [pathAsset, sym];
    p.objects = [createSceneObject('sym', { id: 'inst1' }), createSceneObject('sym', { id: 'inst2' })];
    s.commit(p);
    s.enterSymbol('sym');
    s.selectObject('p');
  }
  const pathAssetNow = () => useEditor.getState().history.present.assets.find((a) => a.id === 'path-asset') as { path: import('../../engine').PathData };
  const symObj0 = () => (useEditor.getState().history.present.assets.find((a) => a.id === 'sym') as { objects: import('../../engine').SceneObject[] }).objects[0];

  it('setPathData inside a symbol edits the global path asset (static branch)', () => {
    symbolWithPath();
    useEditor.getState().setPathData({ closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 99, y: 0 } }] });
    expect(pathAssetNow().path.nodes).toHaveLength(2);
    expect(pathAssetNow().path.nodes[1].anchor.x).toBe(99);
    expect(useEditor.getState().history.present.objects.map((o) => o.id)).toEqual(['inst1', 'inst2']); // root unchanged
  });

  it('deleteSelectedNode inside a symbol removes a node', () => {
    symbolWithPath();
    useEditor.getState().selectNode(1);
    useEditor.getState().deleteSelectedNode();
    expect(pathAssetNow().path.nodes).toHaveLength(2); // was 3
  });

  it('addShapeKeyframe + setPathData inside a symbol write the morph keyframe onto the SYMBOL object', () => {
    symbolWithPath();
    useEditor.getState().addShapeKeyframe();
    expect(symObj0().shapeTrack && symObj0().shapeTrack!.length).toBeGreaterThan(0); // shapeTrack on the symbol object, not root
    useEditor.getState().setPathData({ closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 50, y: 0 } }] });
    const kf = symObj0().shapeTrack![0];
    expect(kf.path.nodes).toHaveLength(2);
    expect(kf.path.nodes[1].anchor.x).toBe(50); // morph keyframe path updated in the symbol object
  });

  it('removeShapeKeyframe inside a symbol drops the symbol object shapeTrack (last keyframe)', () => {
    symbolWithPath();
    useEditor.getState().addShapeKeyframe();
    useEditor.getState().removeShapeKeyframe();
    expect(symObj0().shapeTrack ?? []).toHaveLength(0); // track removed on the symbol object
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/store/store.test.ts -t "in-symbol node-edit"`
Expected: FAIL — `selectedPathCtx` resolves from the root, finds nothing inside a symbol, so all four no-op (asset/object unchanged).

- [ ] **Step 3: Add `replaceObjectInScene` + scope `selectedPathCtx`**

In `src/ui/store/store.ts`, next to `replaceObject`, add:

```ts
// Replace one object in the ACTIVE scene: root project.objects, or the edited symbol's objects[].
// At the root this is exactly replaceObject. (author-in-symbol node-edit, phase 3)
function replaceObjectInScene(project: Project, activeAssetId: string | null, next: SceneObject): Project {
  if (!activeAssetId) return replaceObject(project, next);
  return {
    ...project,
    assets: project.assets.map((a) =>
      a.id === activeAssetId && a.kind === 'symbol'
        ? { ...a, objects: a.objects.map((o) => (o.id === next.id ? next : o)) }
        : a,
    ),
  };
}
```

Change `selectedPathCtx`'s object lookup from the root to the active scene:

```ts
function selectedPathCtx(get: () => EditorState): { obj: SceneObject; asset: VectorAsset } | null {
  const s = get();
  const obj = selectActiveObjects(s).find((o) => o.id === s.selectedObjectId); // active scene (root or edited symbol)
  if (!obj) return null;
  const asset = s.history.present.assets.find((a) => a.id === obj.assetId); // assets are global
  if (!asset || asset.kind !== 'vector' || asset.shapeType !== 'path') return null;
  return { obj, asset };
}
```

- [ ] **Step 4: Route the morph-branch object writes**

In `setPathData`'s morph branch, change the single commit line (leave all the keyframe-merge logic above it untouched, and leave the `else` static-branch asset write untouched). Find:

```ts
      const shapeTrack = upsertShapeKeyframe(obj.shapeTrack, merged);
      get().commit(replaceObject(project, { ...obj, shapeTrack }));
```
Replace the commit line with:
```ts
      const shapeTrack = upsertShapeKeyframe(obj.shapeTrack, merged);
      get().commit(replaceObjectInScene(project, selectActiveAssetId(s), { ...obj, shapeTrack }));
```

In `addShapeKeyframe`, change its commit:

```ts
    const shapeTrack = upsertShapeKeyframe(obj.shapeTrack ?? [], { time, path: current, easing: 'linear' });
    get().commit(replaceObjectInScene(project, selectActiveAssetId(s), { ...obj, shapeTrack }));
```

In `removeShapeKeyframe`, change BOTH object-writing branches:

```ts
    if (remaining.length === 0) {
      // Write the currently-shown shape back into the base so it does not jump.
      const snapshot = samplePath(track, time);
      const nextAsset = { ...asset, path: snapshot };
      const withAsset = { ...project, assets: project.assets.map((a) => (a.id === asset.id ? nextAsset : a)) };
      get().commit(replaceObjectInScene(withAsset, selectActiveAssetId(s), { ...obj, shapeTrack: undefined }));
    } else {
      get().commit(replaceObjectInScene(project, selectActiveAssetId(s), { ...obj, shapeTrack: remaining }));
    }
    set({ selectedShapeKeyframe: null });
```

- [ ] **Step 5: Run to verify pass + the whole store suite**

Run: `npx vitest run src/ui/store/store.test.ts -t "in-symbol node-edit"`
Expected: PASS. Then the whole store suite (existing root node-edit / morph tests must stay green — at root `replaceObjectInScene` === `replaceObject` and `selectActiveObjects` === `project.objects`):
Run: `npx vitest run src/ui/store/store.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(in-symbol-nodeedit): scope selectedPathCtx + replaceObjectInScene; route setPathData/addShapeKeyframe/removeShapeKeyframe"
```

---

### Task 2: Un-gate the `node` tool + land in-symbol draws on `node`

**Files:**
- Modify: `src/ui/store/store.ts`
- Test: `src/ui/store/store.test.ts` (new node-gate test + update the two phase-2 tests)

**Interfaces:**
- Consumes: `SYMBOL_EDIT_TOOLS` (phase 2), `ToolMode`.

- [ ] **Step 1: Update the phase-2 tests + add the node-gate test**

In `src/ui/store/store.test.ts`:

(a) The phase-2 gate test asserts `node` stays blocked in edit mode — now it's allowed. Find the test named `setActiveTool blocks node/motion in edit mode (deferred), but allows create tools (phase 2)` and replace it with (node now allowed; only `motion` stays gated):

```ts
  it('setActiveTool: in edit mode allows select/create tools + node; only motion stays gated (phase 3)', () => {
    withSymbol();
    const s = useEditor.getState();
    s.enterSymbol('sym');
    s.setActiveTool('motion');
    expect(useEditor.getState().activeTool).toBe('select'); // motion still gated
    s.setActiveTool('rect');
    expect(useEditor.getState().activeTool).toBe('rect'); // create tool allowed
    s.setActiveTool('node');
    expect(useEditor.getState().activeTool).toBe('node'); // node now allowed (node-edit routed)
  });
```

(b) The phase-2 after-draw test asserts an in-symbol `addVectorPath` lands on `select` — now it lands on `node`. Find the test named `addVectorPath inside a symbol appends to the symbol scene and lands on SELECT (not node)` and change its tool assertion (and name):

```ts
  it('addVectorPath inside a symbol appends to the symbol scene and lands on the node tool (phase 3)', () => {
    symbolEditing();
    useEditor.getState().addVectorPath({ closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }] });
    expect(symObjects()).toHaveLength(2);
    expect(useEditor.getState().activeTool).toBe('node');
  });
```
> `symObjects` and `symbolEditing` are the helpers already defined in the `in-symbol draw (author-in-symbol phase 2)` describe block — keep this updated test inside that block.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/store/store.test.ts -t "only motion stays gated|lands on the node tool"`
Expected: FAIL — `node` is still gated (stays `select`); the in-symbol path draw still lands on `select`.

- [ ] **Step 3: Un-gate `node` + revert the after-draw tool**

In `src/ui/store/store.ts`, add `'node'` to `SYMBOL_EDIT_TOOLS`:

```ts
const SYMBOL_EDIT_TOOLS: ReadonlySet<ToolMode> = new Set([
  'select', 'rect', 'ellipse', 'polygon', 'star', 'line', 'pen', 'brush', 'node',
]);
```

In `addVectorPath` and `addPrimitive`, change the after-draw tool from `activeId ? 'select' : 'node'` back to `'node'` (node editing now works inside a symbol):

```ts
    set({ selectedObjectId: obj.id, selectedObjectIds: [obj.id], selectedKeyframe: null, selectedNodeIndex: null, activeTool: 'node' });
```
(apply to both `addVectorPath` and `addPrimitive`).

- [ ] **Step 4: Run to verify pass + the whole store suite**

Run: `npx vitest run src/ui/store/store.test.ts`
Expected: PASS (the updated phase-2 tests + the new gate assertion + everything else).

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(in-symbol-nodeedit): allow node tool in edit mode; in-symbol path draws land on node"
```

---

### Task 3: e2e + full-suite verification

**Files:**
- Modify: `e2e/symbols.spec.ts`

- [ ] **Step 1: Write the e2e test**

Append to `e2e/symbols.spec.ts`. Create a symbol whose internal is a path (draw with the pen or just draw a rect — a rect's geometry isn't node-editable, so use the pen, OR simpler: draw a line/polygon which produces a path). To keep it robust, draw a **polygon** (produces a path object), Create Symbol, duplicate, enter, switch to the node tool, delete a node, confirm both instances still render (the part simplified). Since asserting node count visually is brittle, assert the breadcrumb flow + that the node tool is selectable in edit mode and a delete doesn't crash and both instances persist.

```ts
test('node-edit a path inside a symbol — the node tool is usable in edit mode (author-in-symbol node-edit)', async ({
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

  // Draw a polygon (a path object) -> Create Symbol -> duplicate -> two instances.
  await tools.getByRole('button', { name: 'Polygon', exact: true }).click();
  await page.mouse.move(box.x + 140, box.y + 120);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 180);
  await page.mouse.up();
  await tools.getByRole('button', { name: 'Select', exact: true }).click();
  await page.locator('[data-savig-object]').first().click();
  await page.getByRole('button', { name: 'Create Symbol', exact: true }).click();
  await page.keyboard.press('Control+d');
  await expect(page.locator('[data-savig-object*="/"]')).toHaveCount(2);

  // Enter the symbol; the node tool is now selectable in edit mode.
  await page.locator('[data-savig-object*="/"]').last().dblclick();
  await expect(page.getByTestId('edit-breadcrumb')).toBeVisible();
  await page.locator('[data-savig-object]:not([data-savig-object*="/"])').first().click();
  await tools.getByRole('button', { name: 'Node', exact: true }).click();
  // The node overlay renders for the in-symbol path (node-edit is routed).
  await expect(page.getByTestId('node-overlay')).toBeVisible();

  // Exit; both instances still present.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('edit-breadcrumb')).toHaveCount(0);
  await expect(page.locator('[data-savig-object*="/"]')).toHaveCount(2);
});
```
> Verify the Polygon / Select / Node tool button accessible names against the real ToolPalette (grep `src/ui/components/Toolbar/ToolPalette.tsx` for the button labels); adjust if they differ. The `node-overlay` testid exists in `Stage.tsx`. The contract: the node tool is selectable in edit mode and its overlay renders for an in-symbol path.

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
git commit -m "test(in-symbol-nodeedit): e2e node tool usable + overlay renders inside a symbol"
```

---

## Self-Review

**1. Spec coverage** (spec §3–§5):
- §3.1 scope `selectedPathCtx` → Task 1. §3.2 `replaceObjectInScene` + route the 3 writes → Task 1. §3.3 un-gate `node` + land draws on `node` → Task 2. §4 parity/undo/edit-propagation (no engine-render change) → Global Constraints. §5 deferred (advanced morph fine-tuning, paint, motion, clipboard, group, layers) — not implemented; safe no-op documented in the spec. §7 tests → store (T1, T2), e2e (T3). ✅

**2. Placeholder scan:** No TBD/TODO; complete code/tests. One calibration note (e2e tool-button names) states the contract. ✅

**3. Type consistency:** `replaceObjectInScene(project, activeAssetId, next): Project` used identically (def in Task 1, consumed in the three routed writes). `selectActiveAssetId(s)` is the `activeAssetId` arg everywhere. `SYMBOL_EDIT_TOOLS` gains `'node'`; the after-draw tool is `'node'` in both `addVectorPath`/`addPrimitive`. The updated phase-2 tests reference the existing `symbolEditing`/`symObjects` helpers. ✅

**4. Parity:** no `flattenInstances`/`computeFrame`/`renderDocument`/runtime change; the Stage node overlay already reads the active-scene-scoped `selectEditablePath`. ✅
