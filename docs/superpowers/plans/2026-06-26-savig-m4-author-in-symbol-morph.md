# Author Inside a Symbol — Phase 9 (final): In-Symbol Advanced Morph Fine-Tuning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route the four advanced morph fine-tuning actions to the active scene so morph tuning works inside a symbol — completing "author inside a symbol".

**Architecture:** Reuse the phase-3 morph-write seam. Each action resolves its object via `selectActiveObjects(s)` (instead of root `project.objects`) and writes the new `shapeTrack` via `replaceObjectInScene(project, selectActiveAssetId(s), next)`. The supporting selectors, Inspector morph controls, Stage correspondence overlay, and Timeline are already active-scene-aware. No engine-render change → preview==export parity untouched.

**Tech Stack:** TypeScript (strict), React, Zustand, Vitest (unit + jsdom), Playwright (e2e). No new dependencies.

## Global Constraints

- **Preview == export parity is sacred.** No change to `flattenInstances`/`computeFrame`/`renderDocument`/`sample.ts`/`samplePath`/runtime.
- **No new dependencies.**
- **Active-scene routed:** resolve via `selectActiveObjects(s)`; write via `replaceObjectInScene(project, selectActiveAssetId(s), next)`.
- **Root behaviour byte-unchanged:** at the root `selectActiveObjects(s) === project.objects` and `replaceObjectInScene(p, null, x) === replaceObject(p, x)`.
- **No other UI change:** `selectEditedShapeKeyframe`/`selectSelectedObject` (selectors), the Inspector morph controls, the Stage correspondence overlay, and the Timeline are already active-scene scoped.
- **Commit cadence:** one commit per task (TDD). At plan end: `npm test`, `npm run typecheck`, `npx eslint src e2e`, `npm run e2e` all green.

---

### Task 1: Route the four morph fine-tuning actions

**Files:**
- Modify: `src/ui/store/store.ts` (`setSelectedShapeKeyframeMorph` ~1911; `setSelectedShapeKeyframeCorrespondence` ~1923; `setSelectedNodeEasing` ~1935; `setCorrespondenceLink` ~1956)
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Consumes: `selectActiveObjects`/`selectActiveAssetId`/`replaceObjectInScene` (in scope); `selectEditedShapeKeyframe` (already active-scene scoped); `flattenInstances` (already imported in the test from phase 8).

- [ ] **Step 1: Write the failing tests**

Append a new describe block to `src/ui/store/store.test.ts` (after the `in-symbol motion paths` block):

```ts
describe('in-symbol advanced morph fine-tuning (author-in-symbol phase 9)', () => {
  const sq = (off: number): PathData => ({
    closed: true,
    nodes: [
      { anchor: { x: off, y: off } },
      { anchor: { x: off + 10, y: off } },
      { anchor: { x: off + 10, y: off + 10 } },
      { anchor: { x: off, y: off + 10 } },
    ],
  });
  // A symbol whose one path object carries a 2-keyframe shapeTrack (a morph) + two instances.
  function symbolWithMorphPath() {
    const s = useEditor.getState();
    s.newProject();
    const asset = createVectorAsset('path', { id: 'pa-asset', path: sq(0) });
    const k0 = { time: 0, easing: 'linear' as const, path: sq(0) };
    const k1 = { time: 1, easing: 'linear' as const, path: sq(5) };
    const pa = createSceneObject('pa-asset', { id: 'pa', name: 'Path', shapeTrack: [k0, k1] });
    const sym = createSymbolAsset({ id: 'sym', objects: [pa], width: 20, height: 20 });
    const p = createProject();
    p.assets = [asset, sym];
    p.objects = [createSceneObject('sym', { id: 'inst1' }), createSceneObject('sym', { id: 'inst2' })];
    s.commit(p);
    s.enterSymbol('sym');
  }
  const symPart = () =>
    (useEditor.getState().history.present.assets.find((a) => a.id === 'sym') as { objects: import('../../engine').SceneObject[] }).objects.find((o) => o.id === 'pa')!;

  it('setSelectedShapeKeyframeMorph sets morph mode on the SYMBOL object keyframe (not root)', () => {
    symbolWithMorphPath();
    useEditor.getState().selectShapeKeyframe({ objectId: 'pa', time: 0 });
    useEditor.getState().setSelectedShapeKeyframeMorph('resampled');
    expect(symPart().shapeTrack![0].morph).toBe('resampled');
    expect(useEditor.getState().history.present.objects.map((o) => o.id)).toEqual(['inst1', 'inst2']); // root untouched
  });

  it('setSelectedShapeKeyframeCorrespondence sets correspondence on the symbol object keyframe', () => {
    symbolWithMorphPath();
    useEditor.getState().selectShapeKeyframe({ objectId: 'pa', time: 0 });
    useEditor.getState().setSelectedShapeKeyframeCorrespondence([3, 2, 1, 0]);
    expect(symPart().shapeTrack![0].correspondence).toEqual([3, 2, 1, 0]);
  });

  it('setSelectedNodeEasing sets a per-node easing on the symbol object keyframe', () => {
    symbolWithMorphPath();
    useEditor.getState().selectObject('pa');
    useEditor.getState().seek(0); // playhead on k0 so selectEditedShapeKeyframe resolves it
    useEditor.getState().selectNode(0);
    useEditor.getState().setSelectedNodeEasing('easeIn');
    expect(symPart().shapeTrack![0].nodeEasings?.[0]).toBe('easeIn');
  });

  it('setCorrespondenceLink links an A node to a B node on the symbol object keyframe', () => {
    symbolWithMorphPath();
    useEditor.getState().selectShapeKeyframe({ objectId: 'pa', time: 0 });
    useEditor.getState().setCorrespondenceLink(0, 2);
    expect(symPart().shapeTrack![0].correspondence?.[0]).toBe(2);
  });

  it('every instance reflects the symbol morph tuning (edit-propagation via flattenInstances)', () => {
    symbolWithMorphPath();
    useEditor.getState().selectShapeKeyframe({ objectId: 'pa', time: 0 });
    useEditor.getState().setSelectedShapeKeyframeMorph('resampled');
    const leaf = flattenInstances(useEditor.getState().history.present, 0).find((l) => l.renderId === 'inst1/pa');
    expect(leaf?.object.shapeTrack?.[0].morph).toBe('resampled');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/store/store.test.ts -t "in-symbol advanced morph"`
Expected: FAIL — the morph actions resolve root `project.objects` (no `pa` there → `!obj?.shapeTrack` early-returns), so the symbol object's `shapeTrack` is unchanged.

- [ ] **Step 3: Route `setSelectedShapeKeyframeMorph`**

Replace:

```ts
  setSelectedShapeKeyframeMorph(mode) {
    const s = get();
    const ref = s.selectedShapeKeyframe;
    if (!ref) return;
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === ref.objectId);
    if (!obj?.shapeTrack) return;
    const shapeTrack = obj.shapeTrack.map((k) =>
      Math.abs(k.time - ref.time) < KF_EPS ? { ...k, morph: mode } : k,
    );
    get().commit(replaceObject(project, { ...obj, shapeTrack }));
  },
```

with:

```ts
  setSelectedShapeKeyframeMorph(mode) {
    const s = get();
    const ref = s.selectedShapeKeyframe;
    if (!ref) return;
    const project = s.history.present;
    const obj = selectActiveObjects(s).find((o) => o.id === ref.objectId);
    if (!obj?.shapeTrack) return;
    const shapeTrack = obj.shapeTrack.map((k) =>
      Math.abs(k.time - ref.time) < KF_EPS ? { ...k, morph: mode } : k,
    );
    get().commit(replaceObjectInScene(project, selectActiveAssetId(s), { ...obj, shapeTrack }));
  },
```

- [ ] **Step 4: Route `setSelectedShapeKeyframeCorrespondence`**

Replace:

```ts
  setSelectedShapeKeyframeCorrespondence(correspondence) {
    const s = get();
    const ref = s.selectedShapeKeyframe;
    if (!ref) return;
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === ref.objectId);
    if (!obj?.shapeTrack) return;
    const shapeTrack = obj.shapeTrack.map((k) =>
      Math.abs(k.time - ref.time) < KF_EPS ? { ...k, correspondence } : k,
    );
    get().commit(replaceObject(project, { ...obj, shapeTrack }));
  },
```

with:

```ts
  setSelectedShapeKeyframeCorrespondence(correspondence) {
    const s = get();
    const ref = s.selectedShapeKeyframe;
    if (!ref) return;
    const project = s.history.present;
    const obj = selectActiveObjects(s).find((o) => o.id === ref.objectId);
    if (!obj?.shapeTrack) return;
    const shapeTrack = obj.shapeTrack.map((k) =>
      Math.abs(k.time - ref.time) < KF_EPS ? { ...k, correspondence } : k,
    );
    get().commit(replaceObjectInScene(project, selectActiveAssetId(s), { ...obj, shapeTrack }));
  },
```

- [ ] **Step 5: Route `setSelectedNodeEasing`**

Replace:

```ts
  setSelectedNodeEasing(easing) {
    const s = get();
    const idx = s.selectedNodeIndex;
    if (idx == null) return;
    const edited = selectEditedShapeKeyframe(s);
    if (!edited || idx >= edited.kf.path.nodes.length) return;
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === s.selectedObjectId);
    if (!obj?.shapeTrack) return;
    const arr = (edited.kf.nodeEasings ?? []).slice();
    arr[idx] = easing as Easing;
    const nodeEasings = arr.some((e) => e != null) ? arr : undefined;
    const shapeTrack = obj.shapeTrack.map((k, i) => (i === edited.index ? { ...k, nodeEasings } : k));
    get().commit(replaceObject(project, { ...obj, shapeTrack }));
  },
```

with:

```ts
  setSelectedNodeEasing(easing) {
    const s = get();
    const idx = s.selectedNodeIndex;
    if (idx == null) return;
    const edited = selectEditedShapeKeyframe(s);
    if (!edited || idx >= edited.kf.path.nodes.length) return;
    const project = s.history.present;
    const obj = selectActiveObjects(s).find((o) => o.id === s.selectedObjectId);
    if (!obj?.shapeTrack) return;
    const arr = (edited.kf.nodeEasings ?? []).slice();
    arr[idx] = easing as Easing;
    const nodeEasings = arr.some((e) => e != null) ? arr : undefined;
    const shapeTrack = obj.shapeTrack.map((k, i) => (i === edited.index ? { ...k, nodeEasings } : k));
    get().commit(replaceObjectInScene(project, selectActiveAssetId(s), { ...obj, shapeTrack }));
  },
```

- [ ] **Step 6: Route `setCorrespondenceLink`**

Replace:

```ts
  setCorrespondenceLink(aIndex, bIndex) {
    const s = get();
    const ref = s.selectedShapeKeyframe;
    if (!ref) return;
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === ref.objectId);
    if (!obj?.shapeTrack) return;
```

with:

```ts
  setCorrespondenceLink(aIndex, bIndex) {
    const s = get();
    const ref = s.selectedShapeKeyframe;
    if (!ref) return;
    const project = s.history.present;
    const obj = selectActiveObjects(s).find((o) => o.id === ref.objectId);
    if (!obj?.shapeTrack) return;
```

and the final commit line of `setCorrespondenceLink`:

```ts
    get().commit(replaceObject(project, { ...obj, shapeTrack }));
  },
```

with (NOTE: this `replaceObject(project, { ...obj, shapeTrack })` is the last statement of `setCorrespondenceLink`, immediately before `addAudioClip`):

```ts
    get().commit(replaceObjectInScene(project, selectActiveAssetId(s), { ...obj, shapeTrack }));
  },
```

- [ ] **Step 7: Run to verify pass + the whole store suite**

Run: `npx vitest run src/ui/store/store.test.ts -t "in-symbol advanced morph"`
Expected: PASS (all five). Then the whole store suite (existing root morph/correspondence tests must stay green):
Run: `npx vitest run src/ui/store/store.test.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck + commit**

```bash
npm run typecheck
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(in-symbol-morph): route the 4 morph fine-tuning actions to the active scene"
```

---

### Task 2: e2e + full-suite verification

**Files:**
- Modify: `e2e/symbols.spec.ts`

- [ ] **Step 1: Write the e2e test**

Append to `e2e/symbols.spec.ts`. Enter the symbol via a FILLED rect (clickable), then draw a PATH INSIDE the symbol (so it stays selected after drawing — avoiding the fill:none re-selection problem, mirroring phase-3 node-edit), author a 2-keyframe morph, select the first shape keyframe, and click "Suggest correspondence" → the summary shows "suggested · N nodes" (proving `setSelectedShapeKeyframeCorrespondence` routes inside the symbol).

```ts
test('tune a morph inside a symbol — Suggest correspondence works in edit mode (author-in-symbol morph)', async ({
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

  // A filled rect to enter the symbol through (its leaf is clickable).
  await tools.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(box.x + 120, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 160);
  await page.mouse.up();
  await page.locator('[data-savig-object]').first().click();
  await page.getByRole('button', { name: 'Create Symbol', exact: true }).click();
  await page.keyboard.press('Control+d');
  await expect(page.locator('[data-savig-object*="/"]')).toHaveCount(2); // 2 instances x 1 part

  // Enter the symbol via a filled leaf, then draw a PATH inside (it stays selected after drawing).
  await page.locator('[data-savig-object*="/"]').last().dblclick();
  await expect(page.getByTestId('edit-breadcrumb')).toBeVisible();
  await tools.getByRole('button', { name: 'Pen', exact: true }).click();
  await page.mouse.click(box.x + 240, box.y + 80);
  await page.mouse.click(box.x + 340, box.y + 120);
  await page.mouse.dblclick(box.x + 400, box.y + 80);

  // Author a 2-keyframe morph: add a shape keyframe, advance the playhead, drag a node.
  await page.getByRole('button', { name: /add shape keyframe/i }).click();
  await page.getByTestId('timeline-ruler').click({ position: { x: 120, y: 10 } });
  const node = page.getByTestId('node-1');
  const nb = (await node.boundingBox())!;
  await page.mouse.move(nb.x + nb.width / 2, nb.y + nb.height / 2);
  await page.mouse.down();
  await page.mouse.move(nb.x + 60, nb.y + 60);
  await page.mouse.up();
  await expect(page.getByText(/morph: 2 keyframe/i)).toBeVisible();

  // Select the first shape keyframe and Suggest correspondence -> the summary appears.
  await page.locator('[data-testid^="shape-keyframe-"]').first().click();
  await page.getByRole('button', { name: 'Suggest correspondence' }).click();
  await expect(page.getByText(/suggested · \d+ nodes/)).toBeVisible();
});
```

> The morph controls and "Suggest correspondence" button read `selectActiveObjects` (the symbol's path), and `setSelectedShapeKeyframeCorrespondence` (called by the Suggest button) is now routed to the active scene, so the suggested correspondence is stored on the symbol object and the summary reflects it. If `node-1`/timeline interactions prove flaky inside a symbol, the store tests in Task 1 are the authoritative proof of routing; adjust the node index / drag distance as needed to reach `morph: 2 keyframe(s)`.

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
Expected: all green. Parity suites unchanged-and-green (`e2e/correspondence.spec.ts` — the root morph/correspondence export-parity test — still passes).

- [ ] **Step 4: Commit**

```bash
git add e2e/symbols.spec.ts
git commit -m "test(in-symbol-morph): e2e tune a morph inside a symbol (Suggest correspondence)"
```

---

## Self-Review

**1. Spec coverage** (spec §2–6):
- §2 route the 4 actions → Task 1 Steps 3–6. §3 parity/propagation/undo → Global Constraints + the propagation test. §4 scope (in: 4 actions; deferred: general timeline keyframe editing) — implemented; deferred not in scope. §6 tests → store (Task 1: 4 actions + propagation), e2e (Task 2). ✅

**2. Placeholder scan:** No TBD/TODO; every code step shows full before/after code. The e2e note states the confirmed control/button contract + a fallback. ✅

**3. Type consistency:** every routed action keeps its signature and swaps `project.objects.find`→`selectActiveObjects(s).find` and `replaceObject(project, x)`→`replaceObjectInScene(project, selectActiveAssetId(s), x)` — matching `replaceObjectInScene(project: Project, activeAssetId: string | null, next: SceneObject): Project`. `MorphMode = 'corresponded' | 'resampled'` (test uses `'resampled'`); `ShapeKeyframe` requires `{ time, path, easing }` (fixtures use `easing: 'linear' as const`); `ShapeKeyframeRef = { objectId, time }`; `selectEditedShapeKeyframe` already reads `selectActiveObjects`. ✅

**4. Parity:** no `flattenInstances`/`computeFrame`/`renderDocument`/`sample.ts`/`samplePath` change; morph metadata is object data the existing render path already applies. ✅
