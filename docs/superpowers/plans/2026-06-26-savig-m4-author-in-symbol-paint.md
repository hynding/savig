# Author Inside a Symbol — Phase 4: In-Symbol Paint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the appearance actions (fill/stroke color, gradient, stroke style, dash) and `setAnchor` edit a symbol's internal parts in edit mode.

**Architecture:** Reuse phase-3's `replaceObjectInScene`. Each appearance action resolves the selected object from the active scene (`selectActiveObjects`) instead of the root, and routes its *object* writes through `replaceObjectInScene(project, selectActiveAssetId(s), …)`; its *asset* writes (static style) stay global and need no change. No engine-render change → preview==export parity untouched.

**Tech Stack:** TypeScript (strict), React, Zustand, Vitest (unit + jsdom), Playwright (e2e). No new dependencies.

## Global Constraints

- **Preview == export parity is sacred.** No change to `flattenInstances`/`computeFrame`/`renderDocument`/runtime.
- **No new dependencies.**
- **Active-scene routed:** each action resolves the object via `selectActiveObjects(s)`; object writes use `replaceObjectInScene(project, selectActiveAssetId(s), next)` (phase 3); asset writes (`project.assets.map(...)`) stay global.
- **Root behaviour byte-unchanged:** at the root `selectActiveObjects(s)` === `project.objects` and `replaceObjectInScene(p, null, x)` === `replaceObject(p, x)`.
- **No UI change:** the Inspector controls already call these actions.
- **Commit cadence:** one commit per task (TDD). At plan end: `npm test`, `npm run typecheck`, `npx eslint src e2e`, `npm run e2e` all green; engine/parity suites green.

---

### Task 1: Route the single-write appearance actions (`setVectorStyle`, `setVectorColor`, `setStrokeDashoffset`, `setAnchor`)

**Files:**
- Modify: `src/ui/store/store.ts`
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Consumes: `replaceObjectInScene`/`selectActiveObjects`/`selectActiveAssetId` (already in store).

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/store/store.test.ts`:

```ts
describe('in-symbol paint (author-in-symbol phase 4)', () => {
  function symbolWithRect() {
    const s = useEditor.getState();
    s.newProject();
    const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
    const rectObj = createSceneObject('rect-asset', { id: 'r', zOrder: 0 });
    rectObj.shapeBase = { width: 10, height: 10 };
    const sym = createSymbolAsset({ id: 'sym', objects: [rectObj], width: 10, height: 10 });
    const p = createProject();
    p.assets = [rectAsset, sym];
    p.objects = [createSceneObject('sym', { id: 'inst1' }), createSceneObject('sym', { id: 'inst2' })];
    s.commit(p);
    s.enterSymbol('sym');
    s.selectObject('r');
  }
  const symObj0 = () => (useEditor.getState().history.present.assets.find((a) => a.id === 'sym') as { objects: import('../../engine').SceneObject[] }).objects[0];
  const rectAssetNow = () => useEditor.getState().history.present.assets.find((a) => a.id === 'rect-asset') as import('../../engine').VectorAsset;

  it('setVectorColor (auto-key on) writes a colorTracks keyframe onto the SYMBOL object', () => {
    symbolWithRect();
    useEditor.getState().setVectorColor('fill', '#ff0000');
    expect(symObj0().colorTracks?.fill ?? []).toHaveLength(1);
    expect(useEditor.getState().history.present.objects.map((o) => o.id)).toEqual(['inst1', 'inst2']); // root untouched
  });

  it('setVectorColor (auto-key off) writes the SYMBOL vector asset style.fill', () => {
    symbolWithRect();
    useEditor.getState().toggleAutoKey(); // off
    useEditor.getState().setVectorColor('fill', '#00ff00');
    expect(rectAssetNow().style.fill).toBe('#00ff00');
  });

  it('setVectorStyle updates the vector asset style globally', () => {
    symbolWithRect();
    useEditor.getState().setVectorStyle({ strokeWidth: 9 });
    expect(rectAssetNow().style.strokeWidth).toBe(9);
  });

  it('setStrokeDashoffset (auto-key on) writes a dashOffsetTrack onto the SYMBOL object', () => {
    symbolWithRect();
    useEditor.getState().setStrokeDashoffset(2);
    expect(symObj0().dashOffsetTrack ?? []).toHaveLength(1);
  });

  it('setAnchor writes anchorX/anchorY onto the SYMBOL object (not root)', () => {
    symbolWithRect();
    useEditor.getState().setAnchor(3, 4);
    expect(symObj0().anchorX).toBe(3);
    expect(symObj0().anchorY).toBe(4);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/store/store.test.ts -t "in-symbol paint"`
Expected: FAIL — these resolve the object from the root, find nothing inside a symbol, and no-op.

- [ ] **Step 3: Route `setVectorStyle` (object resolve only — asset write is global)**

```ts
  setVectorStyle(updates) {
    const s = get();
    const project = s.history.present;
    const obj = selectActiveObjects(s).find((o) => o.id === s.selectedObjectId);
    if (!obj) return;
    const asset = project.assets.find((a) => a.id === obj.assetId);
    if (!asset || asset.kind !== 'vector') return;
    const next = { ...asset, style: { ...asset.style, ...updates } };
    get().commit({ ...project, assets: project.assets.map((a) => (a.id === asset.id ? next : a)) });
  },
```

- [ ] **Step 4: Route `setVectorColor` (object resolve + colorTracks write)**

```ts
  setVectorColor(property, value) {
    const s = get();
    const project = s.history.present;
    const obj = selectActiveObjects(s).find((o) => o.id === s.selectedObjectId);
    if (!obj) return;
    if (!s.autoKey) {
      get().setVectorStyle({ [property]: value });
      return;
    }
    const time = snapToFrame(s.time, project.meta.fps);
    const next = upsertColorKeyframe(obj.colorTracks?.[property] ?? [], { time, value, easing: 'linear' });
    const colorTracks = { ...obj.colorTracks, [property]: next };
    get().commit(replaceObjectInScene(project, selectActiveAssetId(s), { ...obj, colorTracks }));
  },
```

- [ ] **Step 5: Route `setStrokeDashoffset` (object resolve + dashOffsetTrack write)**

```ts
  setStrokeDashoffset(value) {
    const s = get();
    const project = s.history.present;
    const obj = selectActiveObjects(s).find((o) => o.id === s.selectedObjectId);
    if (!obj) return;
    if (!s.autoKey) {
      get().setVectorStyle({ strokeDashoffset: value });
      return;
    }
    const time = snapToFrame(s.time, project.meta.fps);
    const existing = obj.dashOffsetTrack ?? [];
    const priorEasing = existing.find((k) => Math.abs(k.time - time) < KF_EPS)?.easing ?? 'linear';
    const next = upsertKeyframe(existing, createKeyframe(time, value, { easing: priorEasing }));
    get().commit(replaceObjectInScene(project, selectActiveAssetId(s), { ...obj, dashOffsetTrack: next }));
  },
```

- [ ] **Step 6: Route `setAnchor`**

```ts
  setAnchor(anchorX, anchorY) {
    const s = get();
    const project = s.history.present;
    const obj = selectActiveObjects(s).find((o) => o.id === s.selectedObjectId);
    if (!obj) return;
    get().commit(replaceObjectInScene(project, selectActiveAssetId(s), { ...obj, anchorX, anchorY }));
  },
```

- [ ] **Step 7: Run to verify pass + the whole store suite**

Run: `npx vitest run src/ui/store/store.test.ts -t "in-symbol paint"`
Expected: PASS. Then the whole store suite (existing root paint/anchor tests must stay green):
Run: `npx vitest run src/ui/store/store.test.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck + commit**

```bash
npm run typecheck
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(in-symbol-paint): route setVectorStyle/setVectorColor/setStrokeDashoffset/setAnchor to the active scene"
```

---

### Task 2: Route the dual-write actions (`setVectorGradient`, `setStrokeDasharray`)

These have a "clear" branch that writes BOTH the asset and the object in one commit — route the object half through `replaceObjectInScene` on the asset-updated project.

**Files:**
- Modify: `src/ui/store/store.ts`
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Consumes: `replaceObjectInScene`/`selectActiveObjects`/`selectActiveAssetId`.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/store/store.test.ts`, inside the `in-symbol paint (author-in-symbol phase 4)` describe block (so `symbolWithRect`/`symObj0` are in scope):

```ts
  it('setVectorGradient (auto-key on) writes a gradientTracks keyframe onto the SYMBOL object', () => {
    symbolWithRect();
    useEditor.getState().setVectorGradient('fill', {
      type: 'linear', x1: 0, y1: 0.5, x2: 1, y2: 0.5,
      stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }],
    });
    expect(symObj0().gradientTracks?.fill ?? []).toHaveLength(1);
  });

  it('setVectorGradient(undefined) clears the gradient track on the SYMBOL object', () => {
    symbolWithRect();
    useEditor.getState().setVectorGradient('fill', {
      type: 'linear', x1: 0, y1: 0.5, x2: 1, y2: 0.5,
      stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }],
    });
    expect(symObj0().gradientTracks?.fill ?? []).toHaveLength(1);
    useEditor.getState().setVectorGradient('fill', undefined);
    expect(symObj0().gradientTracks?.fill ?? []).toHaveLength(0);
  });

  it('setStrokeDasharray(undefined) clears the dashOffsetTrack on the SYMBOL object', () => {
    symbolWithRect();
    useEditor.getState().setStrokeDashoffset(2); // create a dashOffsetTrack on the symbol object
    expect(symObj0().dashOffsetTrack ?? []).toHaveLength(1);
    useEditor.getState().setStrokeDasharray(undefined); // clear
    expect(symObj0().dashOffsetTrack ?? []).toHaveLength(0);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/store/store.test.ts -t "gradientTracks keyframe onto the SYMBOL|clears the gradient track|clears the dashOffsetTrack"`
Expected: FAIL — these resolve the object from the root inside a symbol.

- [ ] **Step 3: Route `setVectorGradient`**

Replace the `setVectorGradient` implementation. Change the object resolve to the active scene; route the clear branch's object write through `replaceObjectInScene` on the asset-updated project; route the auto-key branch's object write through `replaceObjectInScene`:

```ts
  setVectorGradient(property, gradient) {
    const s = get();
    const project = s.history.present;
    const obj = selectActiveObjects(s).find((o) => o.id === s.selectedObjectId);
    if (!obj) return;
    const asset = project.assets.find((a) => a.id === obj.assetId);
    if (!asset || asset.kind !== 'vector') return;
    const styleKey = property === 'fill' ? 'fillGradient' : 'strokeGradient';

    if (gradient === undefined) {
      // Switch to solid paint: clear BOTH the static gradient (asset) and any animated track (object).
      const nextStyle = { ...asset.style, [styleKey]: undefined };
      const withAssets = {
        ...project,
        assets: project.assets.map((a) => (a.id === asset.id ? { ...asset, style: nextStyle } : a)),
      };
      const gradientTracks = { ...obj.gradientTracks };
      delete gradientTracks[property];
      const nextObj = {
        ...obj,
        gradientTracks: Object.keys(gradientTracks).length > 0 ? gradientTracks : undefined,
      };
      get().commit(replaceObjectInScene(withAssets, selectActiveAssetId(s), nextObj));
      set({ selectedGradientKeyframe: null });
      return;
    }

    if (!s.autoKey) {
      get().setVectorStyle({ [styleKey]: gradient });
      return;
    }
    const time = snapToFrame(s.time, project.meta.fps);
    const existing = obj.gradientTracks?.[property] ?? [];
    const priorEasing = existing.find((k) => Math.abs(k.time - time) < KF_EPS)?.easing ?? 'linear';
    const next = upsertGradientKeyframe(existing, { time, gradient, easing: priorEasing });
    const gradientTracks = { ...obj.gradientTracks, [property]: next };
    get().commit(replaceObjectInScene(project, selectActiveAssetId(s), { ...obj, gradientTracks }));
  },
```

- [ ] **Step 4: Route `setStrokeDasharray`**

Replace the `setStrokeDasharray` implementation (the `set` branch stays — it calls `setVectorStyle`, already scoped; the clear branch routes the object write):

```ts
  setStrokeDasharray(dasharray) {
    if (dasharray !== undefined) {
      get().setVectorStyle({ strokeDasharray: dasharray });
      return;
    }
    // Clearing the dash also clears the (now-meaningless) offset animation.
    const s = get();
    const project = s.history.present;
    const obj = selectActiveObjects(s).find((o) => o.id === s.selectedObjectId);
    if (!obj) return;
    const asset = project.assets.find((a) => a.id === obj.assetId);
    if (!asset || asset.kind !== 'vector') return;
    const withAssets = {
      ...project,
      assets: project.assets.map((a) =>
        a.id === asset.id ? { ...asset, style: { ...asset.style, strokeDasharray: undefined } } : a,
      ),
    };
    get().commit(replaceObjectInScene(withAssets, selectActiveAssetId(s), { ...obj, dashOffsetTrack: undefined }));
    set({ selectedDashKeyframe: null });
  },
```

- [ ] **Step 5: Run to verify pass + the whole store suite**

Run: `npx vitest run src/ui/store/store.test.ts -t "in-symbol paint"`
Expected: PASS. Then the whole store suite:
Run: `npx vitest run src/ui/store/store.test.ts`
Expected: PASS (existing root gradient/dash tests unchanged).

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(in-symbol-paint): route setVectorGradient/setStrokeDasharray (incl. dual-write clear branches) to the active scene"
```

---

### Task 3: e2e + full-suite verification

**Files:**
- Modify: `e2e/symbols.spec.ts`

- [ ] **Step 1: Write the e2e test**

Append to `e2e/symbols.spec.ts`. Create a filled-rect symbol with two instances, enter it, change the internal rect's fill via the Inspector, and assert a composite leaf's rendered fill reflects the new colour.

```ts
test('recolor a part inside a symbol — both instances render the new fill (author-in-symbol paint)', async ({
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

  await tools.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(box.x + 120, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 160);
  await page.mouse.up();
  await page.locator('[data-savig-object]').first().click();
  await page.getByRole('button', { name: 'Create Symbol', exact: true }).click();
  await page.keyboard.press('Control+d');
  await expect(page.locator('[data-savig-object*="/"]')).toHaveCount(2);

  // Enter the symbol, select the internal rect, set its fill via the Inspector.
  await page.locator('[data-savig-object*="/"]').last().dblclick();
  await expect(page.getByTestId('edit-breadcrumb')).toBeVisible();
  await page.locator('[data-savig-object]:not([data-savig-object*="/"])').first().click();
  const fill = page.getByLabelText('fill');
  await fill.fill('#ff0000');
  await fill.blur();

  // Exit; both instances now render the recolored part.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('edit-breadcrumb')).toHaveCount(0);
  await expect(page.locator('[data-savig-object*="/"]')).toHaveCount(2);
  const leafFill = await page.locator('[data-savig-object*="/"] rect').first().getAttribute('fill');
  expect(leafFill).toBe('#ff0000');
});
```
> Confirmed: the Inspector solid-fill control is `<input type="color" aria-label="fill">`, enabled (a drawn rect's default `style.fill` is `#cccccc`, not `'none'`); `getByLabelText('fill').fill('#ff0000')` fires `setVectorColor('fill', '#ff0000')`. With auto-key on (default) that writes a `colorTracks.fill` keyframe whose value renders at t=0; the imperative painter sets the leaf rect's `fill` attribute. A rect renders as `<rect>` (`ShapeTag = shapeType === 'rect' ? 'rect' : 'ellipse'`), so `[data-savig-object*="/"] rect` selects the instance leaf shape.

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
git commit -m "test(in-symbol-paint): e2e recolor a part inside a symbol, all instances reflect it"
```

---

## Self-Review

**1. Spec coverage** (spec §3 table):
- `setVectorStyle` (scope), `setVectorColor` (scope + colorTracks), `setStrokeDashoffset` (scope + dashOffsetTrack), `setAnchor` (scope + replaceObjectInScene) → Task 1. `setVectorGradient` (scope + clear-dual + autoKey track), `setStrokeDasharray` (scope + clear-dual) → Task 2. §4 parity/undo/edit-propagation → Global Constraints. §5 deferred (clipboard/group/layers/motion/morph-fine-tuning) — not implemented. §7 tests → store (T1, T2), e2e (T3). ✅

**2. Placeholder scan:** No TBD/TODO; complete code/tests. One calibration note (e2e fill-control type / leaf-shape tag) states the contract. ✅

**3. Type consistency:** every routed action uses `selectActiveObjects(s).find(...)` for resolve and `replaceObjectInScene(project, selectActiveAssetId(s), next)` (or `…(withAssets, …)`) for object writes — matching phase 3's `replaceObjectInScene(project: Project, activeAssetId: string | null, next: SceneObject): Project`. The static-asset writes (`project.assets.map`) are unchanged. ✅

**4. Parity:** no `flattenInstances`/`computeFrame`/`renderDocument`/runtime change; the new objects/assets render through the existing path. ✅
