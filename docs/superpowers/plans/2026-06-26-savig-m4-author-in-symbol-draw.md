# Author Inside a Symbol — Phase 2: In-Symbol Draw Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the geometry-create tools (rect/ellipse/polygon/star/line/pen/brush) draw new objects *inside* a symbol's scene in edit mode — every instance immediately shows the new part.

**Architecture:** One pure module helper `appendObjectToScene(project, activeAssetId, asset, obj)` (asset → global `project.assets`; object → the active scene's objects — root or the edited symbol). Route `addVectorShape`/`addVectorPath`/`addPrimitive` through it (zOrder over the active scene; after-draw tool = `select` inside a symbol vs the existing `node` for paths at the root), and relax 47-edit's `setActiveTool` gate to allow the create tools while keeping `node`/`motion` gated. No engine-render change → preview==export parity untouched; new objects render via the existing `flattenInstances` and propagate to all instances for free.

**Tech Stack:** TypeScript (strict), React, Zustand, Vitest (unit + jsdom), Playwright (e2e). No new dependencies.

## Global Constraints

- **Preview == export parity is sacred.** No change to `flattenInstances`/`computeFrame`/`renderDocument`/runtime.
- **No new dependencies.**
- **Asset/object split:** a new asset is always added to the GLOBAL `project.assets`; the new object goes to the ACTIVE scene (root `project.objects`, or the edited symbol's `objects[]` when `selectActiveAssetId` is non-null).
- **Root behaviour is byte-unchanged** when not in edit mode (`activeAssetId === null` → `appendObjectToScene` returns today's project; paths/primitives still land on the `node` tool at the root).
- **Tool gate:** in edit mode allow `select` + the create tools (`rect`,`ellipse`,`polygon`,`star`,`line`,`pen`,`brush`); keep `node`/`motion` gated (their edit actions aren't routed yet).
- **Commit cadence:** one commit per task (TDD). At plan end: `npm test`, `npm run typecheck`, `npx eslint src e2e`, `npm run e2e` all green; engine/parity suites green.

---

### Task 1: `appendObjectToScene` + route the three create actions

**Files:**
- Modify: `src/ui/store/store.ts`
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Consumes: `selectActiveObjects`/`selectActiveAssetId` (47-edit, already imported), `createVectorAsset`/`createSceneObject`/`nextZOrder`/`DEFAULT_TRANSFORM`/`pathBounds`/`primitivePathFromSpec`/`PATH_DEFAULT_STYLE` (already in scope).
- Produces: module helper `appendObjectToScene(project: Project, activeAssetId: string | null, asset: Asset, obj: SceneObject): Project`.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/store/store.test.ts`:

```ts
describe('in-symbol draw (author-in-symbol phase 2)', () => {
  function symbolEditing() {
    const s = useEditor.getState();
    s.newProject();
    const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
    const sym = createSymbolAsset({ id: 'sym', objects: [createSceneObject('rect-asset', { id: 'leaf' })], width: 10, height: 10 });
    const p = createProject();
    p.assets = [rectAsset, sym];
    p.objects = [createSceneObject('sym', { id: 'inst1' }), createSceneObject('sym', { id: 'inst2' })];
    s.commit(p);
    s.enterSymbol('sym');
  }
  const symObjects = () => (useEditor.getState().history.present.assets.find((a) => a.id === 'sym') as { objects: import('../../engine').SceneObject[] }).objects;

  it('addVectorShape appends a rect to the edited symbol scene + the asset globally; root untouched', () => {
    symbolEditing();
    const beforeAssets = useEditor.getState().history.present.assets.length;
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 20, height: 20 });
    expect(symObjects()).toHaveLength(2); // leaf + new rect
    expect(useEditor.getState().history.present.assets.length).toBe(beforeAssets + 1); // new vector asset global
    expect(useEditor.getState().history.present.objects.map((o) => o.id)).toEqual(['inst1', 'inst2']); // root unchanged
    expect(useEditor.getState().selectedObjectId).toBe(symObjects()[1].id); // the new object selected
  });

  it('addVectorPath inside a symbol appends to the symbol scene and lands on SELECT (not node)', () => {
    symbolEditing();
    useEditor.getState().addVectorPath({ closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }] });
    expect(symObjects()).toHaveLength(2);
    expect(useEditor.getState().activeTool).toBe('select');
  });

  it('addPrimitive inside a symbol appends to the symbol scene', () => {
    symbolEditing();
    useEditor.getState().addPrimitive({ kind: 'polygon', cx: 100, cy: 100, radius: 40, rotation: 0, sides: 5, cornerRadius: 0 });
    expect(symObjects()).toHaveLength(2);
  });

  it('at the root, addVectorPath still lands on the node tool (unchanged)', () => {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorPath({ closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }] });
    expect(useEditor.getState().activeTool).toBe('node');
    expect(useEditor.getState().history.present.objects).toHaveLength(1); // object at root
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/store/store.test.ts -t "in-symbol draw"`
Expected: FAIL — the in-symbol tests fail (today the create actions append to root; the symbol scene is unchanged; the path lands on `node`).

- [ ] **Step 3: Add the helper**

In `src/ui/store/store.ts`, near the other module-level helpers (`replaceObject`, `nextZOrder`), add (ensure `Asset` is imported in the `import type { … } from '../../engine';` block — it is used elsewhere in the file):

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

- [ ] **Step 4: Route `addVectorShape`**

Replace the `addVectorShape` implementation with:

```ts
  addVectorShape(shapeType, bounds) {
    const s = get();
    const project = s.history.present;
    const objects = selectActiveObjects(s);
    const activeId = selectActiveAssetId(s);
    const asset = createVectorAsset(shapeType);
    const shapeBase =
      shapeType === 'ellipse'
        ? { radiusX: bounds.width / 2, radiusY: bounds.height / 2 }
        : { width: bounds.width, height: bounds.height };
    const obj = createSceneObject(asset.id, {
      name: `${asset.name} ${nextZOrder(objects) + 1}`,
      zOrder: nextZOrder(objects),
      anchorMode: 'fraction',
      anchorX: 0.5,
      anchorY: 0.5,
      base: { ...DEFAULT_TRANSFORM, x: bounds.x, y: bounds.y },
      shapeBase,
    });
    get().commit(appendObjectToScene(project, activeId, asset, obj));
    set({ selectedObjectId: obj.id, selectedObjectIds: [obj.id], selectedKeyframe: null, activeTool: 'select' });
  },
```

- [ ] **Step 5: Route `addVectorPath`**

Replace the `addVectorPath` implementation with:

```ts
  addVectorPath(path, styleSeed) {
    if (path.nodes.length < 2) return;
    const s = get();
    const project = s.history.present;
    const objects = selectActiveObjects(s);
    const activeId = selectActiveAssetId(s);
    const box = pathBounds(path);
    const normalized: PathData = {
      closed: path.closed,
      nodes: path.nodes.map((n) => ({
        anchor: { x: n.anchor.x - box.x, y: n.anchor.y - box.y },
        ...(n.in ? { in: n.in } : {}),
        ...(n.out ? { out: n.out } : {}),
      })),
    };
    const asset = createVectorAsset('path', { path: normalized, style: { ...PATH_DEFAULT_STYLE, ...styleSeed } });
    const obj = createSceneObject(asset.id, {
      name: `${asset.name} ${nextZOrder(objects) + 1}`,
      zOrder: nextZOrder(objects),
      anchorMode: 'fraction',
      anchorX: 0.5,
      anchorY: 0.5,
      base: { ...DEFAULT_TRANSFORM, x: box.x, y: box.y },
    });
    get().commit(appendObjectToScene(project, activeId, asset, obj));
    set({ selectedObjectId: obj.id, selectedObjectIds: [obj.id], selectedKeyframe: null, selectedNodeIndex: null, activeTool: activeId ? 'select' : 'node' });
  },
```

- [ ] **Step 6: Route `addPrimitive`**

Replace the `addPrimitive` implementation with:

```ts
  addPrimitive(spec) {
    const s = get();
    const project = s.history.present;
    const objects = selectActiveObjects(s);
    const activeId = selectActiveAssetId(s);
    const path = primitivePathFromSpec(spec); // stage frame
    if (path.nodes.length < 2) return;
    const box = pathBounds(path);
    const normalized: PathData = {
      closed: path.closed,
      nodes: path.nodes.map((n) => ({
        anchor: { x: n.anchor.x - box.x, y: n.anchor.y - box.y },
        ...(n.in ? { in: n.in } : {}),
        ...(n.out ? { out: n.out } : {}),
      })),
    };
    const local: PrimitiveSpec = { ...spec, cx: spec.cx - box.x, cy: spec.cy - box.y };
    const asset = createVectorAsset('path', { path: normalized, style: { ...PATH_DEFAULT_STYLE }, primitive: local });
    const obj = createSceneObject(asset.id, {
      name: `${asset.name} ${nextZOrder(objects) + 1}`,
      zOrder: nextZOrder(objects),
      anchorMode: 'fraction',
      anchorX: 0.5,
      anchorY: 0.5,
      base: { ...DEFAULT_TRANSFORM, x: box.x, y: box.y },
    });
    get().commit(appendObjectToScene(project, activeId, asset, obj));
    set({ selectedObjectId: obj.id, selectedObjectIds: [obj.id], selectedKeyframe: null, selectedNodeIndex: null, activeTool: activeId ? 'select' : 'node' });
  },
```

- [ ] **Step 7: Run to verify pass + the whole store suite**

Run: `npx vitest run src/ui/store/store.test.ts -t "in-symbol draw"`
Expected: PASS. Then the whole store suite (existing root-draw tests must stay green):
Run: `npx vitest run src/ui/store/store.test.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck + commit**

```bash
npm run typecheck
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(in-symbol-draw): route addVectorShape/addVectorPath/addPrimitive to the active scene"
```

---

### Task 2: Relax the `setActiveTool` gate

**Files:**
- Modify: `src/ui/store/store.ts`
- Test: `src/ui/store/store.test.ts` (new test + update the existing 47-edit gate test)

**Interfaces:**
- Consumes: `ToolMode` (defined in store.ts).

- [ ] **Step 1: Update the existing gate test + add the new one**

In `src/ui/store/store.test.ts`, the existing 47-edit test (named `setActiveTool refuses non-select tools in edit mode`) uses `setActiveTool('rect')` — now allowed. Replace its body to assert a STILL-gated tool stays blocked, and add a new test for the create tools:

```ts
  it('setActiveTool blocks node/motion in edit mode (deferred), but allows create tools (phase 2)', () => {
    withSymbol();
    const s = useEditor.getState();
    s.enterSymbol('sym');
    s.setActiveTool('node');
    expect(useEditor.getState().activeTool).toBe('select'); // node still gated
    s.setActiveTool('motion');
    expect(useEditor.getState().activeTool).toBe('select'); // motion still gated
    s.setActiveTool('rect');
    expect(useEditor.getState().activeTool).toBe('rect'); // create tool now allowed
    s.setActiveTool('pen');
    expect(useEditor.getState().activeTool).toBe('pen'); // pen allowed
  });
```
> Replace the OLD `it('setActiveTool refuses non-select tools in edit mode', …)` test entirely with the above (do not keep both — the old one asserts `rect` stays `select`, which is no longer true). Find it by its name in the edit-mode describe block.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/store/store.test.ts -t "blocks node/motion in edit mode"`
Expected: FAIL — `setActiveTool('rect')` is still gated (stays `select`).

- [ ] **Step 3: Relax the gate**

In `src/ui/store/store.ts`, add the allowed-set constant near the top-level helpers (after the `ToolMode` type / near `TRANSIENT_DEFAULTS`), and change the gate:

```ts
// Tools usable INSIDE a symbol in edit mode: select + the geometry-create tools. node/motion are
// gated until their edit actions are routed (author-in-symbol phases). (phase 2)
const SYMBOL_EDIT_TOOLS: ReadonlySet<ToolMode> = new Set([
  'select', 'rect', 'ellipse', 'polygon', 'star', 'line', 'pen', 'brush',
]);
```

```ts
  setActiveTool(tool) {
    if (get().editPath.length > 0 && !SYMBOL_EDIT_TOOLS.has(tool)) return; // edit mode: create tools ok; node/motion gated (deferred)
    // The correspondence overlay only renders in the node tool; leaving the node tool
    // hides it, so clear the edit flag too (keeps the "Edit links" toggle consistent).
    set(tool === 'node' ? { activeTool: tool } : { activeTool: tool, correspondenceEditing: false });
  },
```

- [ ] **Step 4: Run to verify pass + the whole store suite**

Run: `npx vitest run src/ui/store/store.test.ts`
Expected: PASS (the new gate test + all existing tests, including the unchanged root tool tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(in-symbol-draw): allow create tools in edit mode (node/motion still gated)"
```

---

### Task 3: e2e + full-suite verification

**Files:**
- Modify: `e2e/symbols.spec.ts`

- [ ] **Step 1: Write the e2e test**

Append to `e2e/symbols.spec.ts`. Create a symbol with two instances, enter it, draw a NEW rectangle inside, confirm every instance gains the extra leaf.

```ts
test('draw a NEW rectangle inside a symbol — every instance gains it (author-in-symbol draw)', async ({
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

  // One rect -> Create Symbol -> duplicate -> two instances (1 leaf each).
  await drawRect(120, 100, 170, 150);
  await page.locator('[data-savig-object]').first().click();
  await page.getByRole('button', { name: 'Create Symbol', exact: true }).click();
  await page.keyboard.press('Control+d');
  await expect(page.locator('[data-savig-object*="/"]')).toHaveCount(2); // 2 instances x 1 part

  // Enter the symbol; draw a SECOND rectangle inside it.
  await page.locator('[data-savig-object*="/"]').last().dblclick();
  await expect(page.getByTestId('edit-breadcrumb')).toBeVisible();
  await drawRect(40, 40, 90, 90); // inside the symbol scene

  // Exit; each instance now has TWO parts -> 2 instances x 2 parts = 4 composite leaves.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('edit-breadcrumb')).toHaveCount(0);
  await expect(page.locator('[data-savig-object*="/"]')).toHaveCount(4);
});
```
> The Rectangle tool button must be reachable while in edit mode (the gate now allows it). The contract: a rectangle drawn inside the symbol appears in every instance (2 leaves → 4).

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
git commit -m "test(in-symbol-draw): e2e draw a new rect inside a symbol, all instances gain it"
```

---

## Self-Review

**1. Spec coverage** (spec §2–§6):
- §2 `appendObjectToScene` (asset global / object active scene) → Task 1. §3 routing the three create actions (active-scene zOrder + after-draw tool conditional) → Task 1. §4 un-gating the create tools (node/motion gated) → Task 2. §5 parity/undo/edit-propagation (no engine-render change; one commit) → Global Constraints + Tasks. §6 deferred (node-edit/motion/group/clipboard) — not implemented. §8 tests → store (T1, T2), e2e (T3). ✅

**2. Placeholder scan:** No TBD/TODO; complete code/tests. One calibration note (e2e Rectangle-button reachability) states the contract. ✅

**3. Type consistency:** `appendObjectToScene(project, activeAssetId, asset, obj): Project` used identically (def in Task 1, consumed by all three routed actions). `SYMBOL_EDIT_TOOLS: ReadonlySet<ToolMode>` with the 8 tools matches the gate predicate. After-draw tool `activeId ? 'select' : 'node'` is consistent in `addVectorPath`/`addPrimitive`. The `PrimitiveSpec` polygon literal `{ kind, cx, cy, radius, rotation, sides, cornerRadius }` matches the existing addPrimitive tests. ✅

**4. Parity:** no `flattenInstances`/`computeFrame`/`renderDocument`/runtime change; new objects render through the existing path. ✅
