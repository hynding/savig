# Author Inside a Symbol — Phase 8: In-Symbol Motion Paths Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make motion paths authorable inside a symbol — un-gate the `motion` tool and route the five motion-path store actions to the active scene.

**Architecture:** Reuse the active-scene seam. Add `'motion'` to `SYMBOL_EDIT_TOOLS`; each motion action resolves its object via `selectActiveObjects(s)` and writes via `replaceObjectInScene(project, selectActiveAssetId(s), next)` (the phase-3/4 single-object seam). The Stage overlay, motion tool draw, Inspector controls, Timeline, and engine render are already active-scene-aware / motion-aware, so no other change. No engine-render change → preview==export parity untouched.

**Tech Stack:** TypeScript (strict), React, Zustand, Vitest (unit + jsdom), Playwright (e2e). No new dependencies.

## Global Constraints

- **Preview == export parity is sacred.** No change to `flattenInstances`/`computeFrame`/`renderDocument`/`sample.ts`/runtime.
- **No new dependencies.**
- **Active-scene routed:** resolve via `selectActiveObjects(s)`; write via `replaceObjectInScene(project, selectActiveAssetId(s), next)`.
- **Root behaviour byte-unchanged:** at the root `selectActiveObjects(s) === project.objects` and `replaceObjectInScene(p, null, x) === replaceObject(p, x)`.
- **No other UI change:** Stage motion-guide overlay reads the edit-scoped `project`; the motion tool draw calls `addMotionPath`; Inspector motion controls + Timeline progress track are 47-edit scoped; `sample.ts` applies `motionPath` (instances animate for free).
- **Commit cadence:** one commit per task (TDD). At plan end: `npm test`, `npm run typecheck`, `npx eslint src e2e`, `npm run e2e` all green.

---

### Task 1: Un-gate `motion` + route the five motion-path actions

**Files:**
- Modify: `src/ui/store/store.ts` (`SYMBOL_EDIT_TOOLS` ~line 317; `addMotionPath`/`removeMotionPath`/`setMotionPathOrient`/`setMotionProgress` ~line 1243–1274; `removeSelectedProgressKeyframe` ~line 1288–1298)
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Consumes: `selectActiveObjects`/`selectActiveAssetId`/`replaceObjectInScene` (already in scope); `flattenInstances` (engine, add to the test import).

- [ ] **Step 1: Write the failing tests**

First, add `flattenInstances` to the engine import at the top of `src/ui/store/store.test.ts`:

```ts
import { createProject, createSceneObject, createSymbolAsset, createGroupObject, createVectorAsset, sampleObject, flattenInstances } from '../../engine';
```

Then append a new describe block (after the `in-symbol group/boolean` block):

```ts
describe('in-symbol motion paths (author-in-symbol phase 8)', () => {
  const guide: PathData = { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }] };
  // A symbol with one rect part + two instances.
  function symbolWithPart() {
    const s = useEditor.getState();
    s.newProject();
    const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
    const part = createSceneObject('rect-asset', { id: 'pa', name: 'Part', zOrder: 0 });
    const sym = createSymbolAsset({ id: 'sym', objects: [part], width: 20, height: 20 });
    const p = createProject();
    p.assets = [rectAsset, sym];
    p.objects = [createSceneObject('sym', { id: 'inst1' }), createSceneObject('sym', { id: 'inst2' })];
    s.commit(p);
    s.enterSymbol('sym');
  }
  const symPart = () =>
    (useEditor.getState().history.present.assets.find((a) => a.id === 'sym') as { objects: import('../../engine').SceneObject[] }).objects.find((o) => o.id === 'pa')!;

  it('addMotionPath attaches a motion path to a SYMBOL-internal object (not root)', () => {
    symbolWithPart();
    useEditor.getState().addMotionPath('pa', guide);
    expect(symPart().motionPath?.path.nodes.map((n) => n.anchor)).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    expect(symPart().motionPath?.progress.length).toBe(2); // seeded 0->1 track
    expect(useEditor.getState().history.present.objects.map((o) => o.id)).toEqual(['inst1', 'inst2']); // root untouched
  });

  it('setMotionPathOrient flips orient on the symbol object', () => {
    symbolWithPart();
    useEditor.getState().addMotionPath('pa', guide);
    useEditor.getState().setMotionPathOrient('pa', true);
    expect(symPart().motionPath?.orient).toBe(true);
  });

  it('setMotionProgress (autoKey) upserts a progress keyframe on the symbol object', () => {
    symbolWithPart();
    useEditor.getState().addMotionPath('pa', guide); // seeds value 0 at t0
    if (!useEditor.getState().autoKey) useEditor.getState().toggleAutoKey(); // autoKey defaults true; ensure it
    useEditor.getState().selectObject('pa');
    useEditor.getState().setMotionProgress(0.5); // at current time (t0) -> upsert
    const prog = symPart().motionPath!.progress;
    expect(prog.some((k) => k.value === 0.5)).toBe(true);
  });

  it('removeMotionPath clears the symbol object motion path', () => {
    symbolWithPart();
    useEditor.getState().addMotionPath('pa', guide);
    useEditor.getState().removeMotionPath('pa');
    expect(symPart().motionPath).toBeUndefined();
  });

  it('removeSelectedProgressKeyframe removes a progress keyframe from the symbol object', () => {
    symbolWithPart();
    useEditor.getState().addMotionPath('pa', guide); // 2 progress kfs
    const t1 = symPart().motionPath!.progress[1].time;
    useEditor.getState().selectProgressKeyframe({ objectId: 'pa', time: t1 });
    useEditor.getState().removeSelectedProgressKeyframe();
    expect(symPart().motionPath!.progress.length).toBe(1);
  });

  it('every instance reflects the symbol motion path (edit-propagation via flattenInstances)', () => {
    symbolWithPart();
    useEditor.getState().addMotionPath('pa', guide);
    const leaves = flattenInstances(useEditor.getState().history.present, 0);
    const leaf = leaves.find((l) => l.renderId === 'inst1/pa');
    expect(leaf?.object.motionPath).toBeTruthy(); // the instance's internal leaf carries the motion path
  });

  it('setActiveTool("motion") is allowed in edit mode (no longer gated)', () => {
    symbolWithPart();
    useEditor.getState().setActiveTool('motion');
    expect(useEditor.getState().activeTool).toBe('motion');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/store/store.test.ts -t "in-symbol motion paths"`
Expected: FAIL — the motion actions resolve the root `project.objects` (no `pa` there → no-op), and `setActiveTool('motion')` is gated back to `select`.

- [ ] **Step 3: Un-gate the `motion` tool**

In `src/ui/store/store.ts`, change `SYMBOL_EDIT_TOOLS`:

```ts
const SYMBOL_EDIT_TOOLS: ReadonlySet<ToolMode> = new Set([
  'select', 'rect', 'ellipse', 'polygon', 'star', 'line', 'pen', 'brush', 'node',
]);
```

to:

```ts
const SYMBOL_EDIT_TOOLS: ReadonlySet<ToolMode> = new Set([
  'select', 'rect', 'ellipse', 'polygon', 'star', 'line', 'pen', 'brush', 'node', 'motion',
]);
```

(Also update the comment above it: `node/motion are gated` → `node + motion now routed`; tidy only.)

- [ ] **Step 4: Route the five motion-path actions**

Replace `addMotionPath`:

```ts
  addMotionPath(objectId, path) {
    const s = get();
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === objectId);
    if (!obj) return;
    const t0 = snapToFrame(s.time, project.meta.fps);
    const t1 = snapToFrame(s.time + 1, project.meta.fps);
    const progress = [createKeyframe(t0, 0), createKeyframe(t1, 1)];
    get().commit(replaceObject(project, { ...obj, motionPath: { path, orient: false, progress } }));
  },
```

with:

```ts
  addMotionPath(objectId, path) {
    const s = get();
    const project = s.history.present;
    const obj = selectActiveObjects(s).find((o) => o.id === objectId);
    if (!obj) return;
    const t0 = snapToFrame(s.time, project.meta.fps);
    const t1 = snapToFrame(s.time + 1, project.meta.fps);
    const progress = [createKeyframe(t0, 0), createKeyframe(t1, 1)];
    get().commit(replaceObjectInScene(project, selectActiveAssetId(s), { ...obj, motionPath: { path, orient: false, progress } }));
  },
```

Replace `removeMotionPath`:

```ts
  removeMotionPath(objectId) {
    const s = get();
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === objectId);
    if (!obj?.motionPath) return;
    get().commit(replaceObject(project, { ...obj, motionPath: undefined }));
  },
```

with:

```ts
  removeMotionPath(objectId) {
    const s = get();
    const project = s.history.present;
    const obj = selectActiveObjects(s).find((o) => o.id === objectId);
    if (!obj?.motionPath) return;
    get().commit(replaceObjectInScene(project, selectActiveAssetId(s), { ...obj, motionPath: undefined }));
  },
```

Replace `setMotionPathOrient`:

```ts
  setMotionPathOrient(objectId, orient) {
    const s = get();
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === objectId);
    if (!obj?.motionPath) return;
    get().commit(replaceObject(project, { ...obj, motionPath: { ...obj.motionPath, orient } }));
  },
```

with:

```ts
  setMotionPathOrient(objectId, orient) {
    const s = get();
    const project = s.history.present;
    const obj = selectActiveObjects(s).find((o) => o.id === objectId);
    if (!obj?.motionPath) return;
    get().commit(replaceObjectInScene(project, selectActiveAssetId(s), { ...obj, motionPath: { ...obj.motionPath, orient } }));
  },
```

Replace `setMotionProgress`:

```ts
  setMotionProgress(value) {
    const s = get();
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === s.selectedObjectId);
    if (!obj?.motionPath || !s.autoKey) return;
    const time = snapToFrame(s.time, project.meta.fps);
    const progress = upsertKeyframe(obj.motionPath.progress, createKeyframe(time, value));
    get().commit(replaceObject(project, { ...obj, motionPath: { ...obj.motionPath, progress } }));
  },
```

with:

```ts
  setMotionProgress(value) {
    const s = get();
    const project = s.history.present;
    const obj = selectActiveObjects(s).find((o) => o.id === s.selectedObjectId);
    if (!obj?.motionPath || !s.autoKey) return;
    const time = snapToFrame(s.time, project.meta.fps);
    const progress = upsertKeyframe(obj.motionPath.progress, createKeyframe(time, value));
    get().commit(replaceObjectInScene(project, selectActiveAssetId(s), { ...obj, motionPath: { ...obj.motionPath, progress } }));
  },
```

Replace `removeSelectedProgressKeyframe`:

```ts
  removeSelectedProgressKeyframe() {
    const s = get();
    const ref = s.selectedProgressKeyframe;
    if (!ref) return;
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === ref.objectId);
    if (!obj?.motionPath) return;
    const progress = removeKeyframeAt(obj.motionPath.progress, ref.time);
    get().commit(replaceObject(project, { ...obj, motionPath: { ...obj.motionPath, progress } }));
    set({ selectedProgressKeyframe: null });
  },
```

with:

```ts
  removeSelectedProgressKeyframe() {
    const s = get();
    const ref = s.selectedProgressKeyframe;
    if (!ref) return;
    const project = s.history.present;
    const obj = selectActiveObjects(s).find((o) => o.id === ref.objectId);
    if (!obj?.motionPath) return;
    const progress = removeKeyframeAt(obj.motionPath.progress, ref.time);
    get().commit(replaceObjectInScene(project, selectActiveAssetId(s), { ...obj, motionPath: { ...obj.motionPath, progress } }));
    set({ selectedProgressKeyframe: null });
  },
```

- [ ] **Step 5: Run to verify pass + the whole store suite**

Run: `npx vitest run src/ui/store/store.test.ts -t "in-symbol motion paths"`
Expected: PASS (all seven). Then the whole store suite (existing root motion tests must stay green):
Run: `npx vitest run src/ui/store/store.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(in-symbol-motion): un-gate the motion tool + route the 5 motion-path actions to the active scene"
```

---

### Task 2: e2e + full-suite verification

**Files:**
- Modify: `e2e/symbols.spec.ts`

- [ ] **Step 1: Write the e2e test**

Append to `e2e/symbols.spec.ts`. Create a symbol with one part and two instances, enter it, select the part, switch to the Motion Path tool, draw a guide (two clicks + a double-click, mirroring `e2e/motion-path.spec.ts`) → the `motion-guide` overlay appears.

```ts
test('draw a motion path inside a symbol — the tool is usable and the guide overlay appears (author-in-symbol motion)', async ({
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

  // Enter the symbol, select the internal part, draw a motion guide with the Motion Path tool.
  await page.locator('[data-savig-object*="/"]').last().dblclick();
  await expect(page.getByTestId('edit-breadcrumb')).toBeVisible();
  await page.locator('[data-savig-object]:not([data-savig-object*="/"])').first().click();
  await tools.getByRole('button', { name: 'Motion Path', exact: true }).click();
  await page.mouse.click(box.x + 240, box.y + 220);
  await page.mouse.click(box.x + 320, box.y + 250);
  await page.mouse.dblclick(box.x + 400, box.y + 220);

  // The motion guide overlay renders for the selected internal object inside the symbol.
  await expect(page.getByTestId('motion-guide')).toBeVisible();
});
```

> The Motion Path tool button lives in the Tools group (name "Motion Path"). It is now allowed in edit mode (`SYMBOL_EDIT_TOOLS` includes `motion`). The draw commits via `usePathTools` → `addMotionPath(selectedObjectId, path)` (routed to the active scene), and the Stage overlay (`data-testid="motion-guide"`) reads the edit-scoped `project`, so it renders for the symbol-internal selected object.

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
Expected: all green. Parity suites unchanged-and-green (`e2e/motion-path.spec.ts` — the root motion export-parity test — still passes).

- [ ] **Step 4: Commit**

```bash
git add e2e/symbols.spec.ts
git commit -m "test(in-symbol-motion): e2e draw a motion path inside a symbol"
```

---

## Self-Review

**1. Spec coverage** (spec §2–6):
- §2.1 un-gate motion → Task 1 Step 3. §2.2 route the 5 actions → Task 1 Step 4. §3 parity/propagation/undo → Global Constraints + the propagation test. §4 scope (in: gate + 5 actions; deferred: timeline keyframe drag, morph) — implemented; deferred not in scope. §6 tests → store (Task 1: 5 actions + propagation + tool-ungate), e2e (Task 2). ✅

**2. Placeholder scan:** No TBD/TODO; every code step shows full before/after code. The e2e note states the confirmed tool-button + overlay contract. ✅

**3. Type consistency:** every routed action keeps its signature and swaps `project.objects.find`→`selectActiveObjects(s).find` and `replaceObject(project, x)`→`replaceObjectInScene(project, selectActiveAssetId(s), x)` — matching the phase-3 `replaceObjectInScene(project: Project, activeAssetId: string | null, next: SceneObject): Project`. `flattenInstances(project, time): InstanceLeaf[]` with `leaf.renderId`/`leaf.object` matches `engine/symbol.ts`. ✅

**4. Parity:** no `flattenInstances`/`computeFrame`/`renderDocument`/`sample.ts` change; motion paths are object data the existing render path already applies. ✅
