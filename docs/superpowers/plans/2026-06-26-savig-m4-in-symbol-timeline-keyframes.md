# In-Symbol Timeline Keyframe Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route every remaining root-resolved branch of the shared keyframe-manipulation store actions to the active scene, so all timeline keyframe operations work inside a symbol.

**Architecture:** Reuse the active-scene seam uniformly: each routed branch resolves the object via `selectActiveObjects(s)` instead of root `project.objects` and writes via `replaceObjectInScene(project, selectActiveAssetId(s), next)` instead of `replaceObject(project, next)`. Byte-identical at root. No engine-render change → preview==export parity untouched.

**Tech Stack:** TypeScript (strict), React, Zustand, Vitest (unit + jsdom), Playwright (e2e). No new dependencies.

## Global Constraints

- **Preview == export parity is sacred.** No change to `flattenInstances`/`computeFrame`/`renderDocument`/`sample.ts`/runtime. All writes are OBJECT-field track writes.
- **No new dependencies.**
- **Active-scene routed:** resolve via `selectActiveObjects(s)`; write via `replaceObjectInScene(project, selectActiveAssetId(s), next)`.
- **Root behaviour byte-unchanged:** at the root `selectActiveObjects(s) === project.objects` and `replaceObjectInScene(p, null, x) === replaceObject(p, x)`.
- **No UI change:** Timeline + Inspector already active-scene scoped.
- **Already routed (leave unchanged):** the `progress` branches of `copyKeyframe`/`pasteKeyframe`/`retimeSelectedKeyframe`/`removeSelectedProgressKeyframe` (phase 8); the `shape` branch of `setSelectedKeyframeEasing` (phase 9).
- **Commit cadence:** one commit per task (TDD). At plan end: `npm test`, `npm run typecheck`, `npx eslint src e2e`, `npm run e2e` all green.

---

### Task 1: Route the single-lookup keyframe actions (4 removes + rotation mode)

**Files:**
- Modify: `src/ui/store/store.ts` (`removeSelectedColorKeyframe` ~1120; `removeSelectedGradientKeyframe` ~1144; `removeSelectedDashKeyframe` ~1235; `removeSelectedKeyframe` ~1827; `setSelectedKeyframeRotationMode` ~1903)
- Test: `src/ui/store/store.test.ts`

**Interfaces:** Consumes `selectActiveObjects`/`selectActiveAssetId`/`replaceObjectInScene` (in scope); `flattenInstances` (already imported in the test).

- [ ] **Step 1: Write the failing tests**

Append a new describe block to `src/ui/store/store.test.ts` (after the `in-symbol advanced morph fine-tuning` block):

```ts
describe('in-symbol timeline keyframe editing', () => {
  const sk = (time: number, value: number) => ({ time, value, easing: 'linear' as const });
  const ck = (time: number, value: string) => ({ time, value, easing: 'linear' as const });
  // A symbol whose one rect part carries scalar (x, rotation), color (fill), gradient + dash tracks + two instances.
  function symbolWithAnimatedPart() {
    const s = useEditor.getState();
    s.newProject();
    const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
    const part = createSceneObject('rect-asset', {
      id: 'pa',
      name: 'Part',
      zOrder: 0,
      tracks: { x: [sk(0, 0), sk(2, 100)], rotation: [sk(0, 0), sk(2, 90)] },
      colorTracks: { fill: [ck(0, '#ff0000'), ck(2, '#00ff00')] },
      dashOffsetTrack: [sk(0, 0), sk(2, 10)],
    });
    const sym = createSymbolAsset({ id: 'sym', objects: [part], width: 20, height: 20 });
    const p = createProject();
    p.assets = [rectAsset, sym];
    p.objects = [createSceneObject('sym', { id: 'inst1' }), createSceneObject('sym', { id: 'inst2' })];
    s.commit(p);
    s.enterSymbol('sym');
  }
  const symPart = () =>
    (useEditor.getState().history.present.assets.find((a) => a.id === 'sym') as { objects: import('../../engine').SceneObject[] }).objects.find((o) => o.id === 'pa')!;

  it('removeSelectedKeyframe removes a SCALAR keyframe from the symbol object (not root)', () => {
    symbolWithAnimatedPart();
    useEditor.getState().selectKeyframe({ objectId: 'pa', property: 'x', time: 2 });
    useEditor.getState().removeSelectedKeyframe();
    expect(symPart().tracks.x).toHaveLength(1);
    expect(useEditor.getState().history.present.objects.map((o) => o.id)).toEqual(['inst1', 'inst2']); // root untouched
  });

  it('removeSelectedColorKeyframe removes a color keyframe from the symbol object', () => {
    symbolWithAnimatedPart();
    useEditor.getState().selectColorKeyframe({ objectId: 'pa', property: 'fill', time: 2 });
    useEditor.getState().removeSelectedColorKeyframe();
    expect(symPart().colorTracks!.fill).toHaveLength(1);
  });

  it('removeSelectedDashKeyframe removes a dash keyframe from the symbol object', () => {
    symbolWithAnimatedPart();
    useEditor.getState().selectDashKeyframe({ objectId: 'pa', time: 2 });
    useEditor.getState().removeSelectedDashKeyframe();
    expect(symPart().dashOffsetTrack).toHaveLength(1);
  });

  it('setSelectedKeyframeRotationMode sets the rotation keyframe mode on the symbol object', () => {
    symbolWithAnimatedPart();
    useEditor.getState().selectKeyframe({ objectId: 'pa', property: 'rotation', time: 0 });
    useEditor.getState().setSelectedKeyframeRotationMode('raw');
    expect(symPart().tracks.rotation![0].rotationMode).toBe('raw');
  });

  it('every instance reflects an in-symbol keyframe removal (edit-propagation)', () => {
    symbolWithAnimatedPart();
    useEditor.getState().selectKeyframe({ objectId: 'pa', property: 'x', time: 2 });
    useEditor.getState().removeSelectedKeyframe();
    const leaf = flattenInstances(useEditor.getState().history.present, 0).find((l) => l.renderId === 'inst1/pa');
    expect(leaf?.object.tracks.x).toHaveLength(1);
  });
});
```

> `ColorKeyframeRef` and `DashKeyframeRef` are `{ objectId, property?, time }`-shaped like the others; `selectDashKeyframe` takes `{ objectId, time }`. If a ref factory differs, adjust the literal to match the action's `selectXxxKeyframe` signature (grep the `selectDashKeyframe`/`selectColorKeyframe` declarations).

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/store/store.test.ts -t "in-symbol timeline keyframe editing"`
Expected: FAIL — the actions resolve root `project.objects`, miss `pa`, and no-op (the symbol object's tracks are unchanged).

- [ ] **Step 3: Route the four removes + rotation mode**

In each function, change the object lookup `project.objects.find(...)` → `selectActiveObjects(s).find(...)` and the commit `replaceObject(project, X)` → `replaceObjectInScene(project, selectActiveAssetId(s), X)`. The five functions, with their exact edits:

`removeSelectedColorKeyframe` (~1125, 1129):
```ts
    const obj = project.objects.find((o) => o.id === ref.objectId);
```
→
```ts
    const obj = selectActiveObjects(s).find((o) => o.id === ref.objectId);
```
and
```ts
    get().commit(replaceObject(project, { ...obj, colorTracks: { ...obj.colorTracks, [ref.property]: next } }));
```
→
```ts
    get().commit(replaceObjectInScene(project, selectActiveAssetId(s), { ...obj, colorTracks: { ...obj.colorTracks, [ref.property]: next } }));
```

`removeSelectedGradientKeyframe` (~1149, 1157-1162): change `const obj = project.objects.find((o) => o.id === ref.objectId);` → `const obj = selectActiveObjects(s).find((o) => o.id === ref.objectId);`, and the `get().commit(replaceObject(project, {` (the multi-line gradient commit) → `get().commit(replaceObjectInScene(project, selectActiveAssetId(s), {`.

`removeSelectedDashKeyframe` (~1240, 1243-1245): change `const obj = project.objects.find((o) => o.id === ref.objectId);` → `const obj = selectActiveObjects(s).find((o) => o.id === ref.objectId);`, and `get().commit(\n      replaceObject(project, { ...obj, dashOffsetTrack: next.length > 0 ? next : undefined }),` → `replaceObjectInScene(project, selectActiveAssetId(s), { ...obj, dashOffsetTrack: next.length > 0 ? next : undefined }),`.

`removeSelectedKeyframe` (~1832, 1836): change `const obj = project.objects.find((o) => o.id === ref.objectId);` → `selectActiveObjects(s).find(...)`, and `get().commit(replaceObject(project, { ...obj, tracks: { ...obj.tracks, [ref.property]: next } }));` → `get().commit(replaceObjectInScene(project, selectActiveAssetId(s), { ...obj, tracks: { ...obj.tracks, [ref.property]: next } }));`.

`setSelectedKeyframeRotationMode` (~1908, 1912): change `const obj = project.objects.find((o) => o.id === ref.objectId);` → `selectActiveObjects(s).find(...)`, and `get().commit(replaceObject(project, { ...obj, tracks: { ...obj.tracks, rotation: next } }));` → `get().commit(replaceObjectInScene(project, selectActiveAssetId(s), { ...obj, tracks: { ...obj.tracks, rotation: next } }));`.

> Each `const obj = project.objects.find((o) => o.id === ref.objectId);` is NOT unique across the file, so apply these as the smallest replacements that include the distinctive surrounding commit line, or replace the whole function body. Verify by re-reading the function after each edit.

- [ ] **Step 4: Run to verify pass + the whole store suite**

Run: `npx vitest run src/ui/store/store.test.ts -t "in-symbol timeline keyframe editing"`
Expected: PASS (all five Task-1 tests). Then the whole store suite (existing root remove/rotation tests must stay green):
Run: `npx vitest run src/ui/store/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(in-symbol-timeline-kf): route the per-type keyframe removes + rotation mode to the active scene"
```

---

### Task 2: Route the shared multi-branch ops (`setSelectedKeyframeEasing`, `copyKeyframe`, `retimeSelectedKeyframe`, `pasteKeyframe`)

**Files:**
- Modify: `src/ui/store/store.ts`
- Test: `src/ui/store/store.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to the `in-symbol timeline keyframe editing` describe block (so `symbolWithAnimatedPart`/`symPart` are in scope):

```ts
  it('setSelectedKeyframeEasing sets a SCALAR keyframe easing on the symbol object', () => {
    symbolWithAnimatedPart();
    useEditor.getState().selectKeyframe({ objectId: 'pa', property: 'x', time: 2 });
    useEditor.getState().setSelectedKeyframeEasing('easeIn');
    expect(symPart().tracks.x!.find((k) => k.time === 2)!.easing).toBe('easeIn');
  });

  it('setSelectedKeyframeEasing sets a COLOR keyframe easing on the symbol object', () => {
    symbolWithAnimatedPart();
    useEditor.getState().selectColorKeyframe({ objectId: 'pa', property: 'fill', time: 2 });
    useEditor.getState().setSelectedKeyframeEasing('easeIn');
    expect(symPart().colorTracks!.fill.find((k) => k.time === 2)!.easing).toBe('easeIn');
  });

  it('retimeSelectedKeyframe moves a SCALAR keyframe of the symbol object', () => {
    symbolWithAnimatedPart();
    useEditor.getState().selectKeyframe({ objectId: 'pa', property: 'x', time: 2 });
    useEditor.getState().retimeSelectedKeyframe(3);
    const times = symPart().tracks.x!.map((k) => k.time);
    expect(times).toContain(3);
    expect(times).not.toContain(2);
  });

  it('copyKeyframe + pasteKeyframe round-trip a SCALAR keyframe inside the symbol', () => {
    symbolWithAnimatedPart();
    useEditor.getState().selectKeyframe({ objectId: 'pa', property: 'x', time: 2 });
    useEditor.getState().copyKeyframe();
    useEditor.getState().seek(5);
    useEditor.getState().pasteKeyframe();
    expect(symPart().tracks.x!.map((k) => k.time)).toContain(5); // pasted onto the symbol object at the new time
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/store/store.test.ts -t "in-symbol timeline keyframe editing"`
Expected: the four new tests FAIL (easing/retime/copy-paste resolve root, miss `pa`, no-op).

- [ ] **Step 3: Route `setSelectedKeyframeEasing` (5 non-shape branches)**

For EACH of the `selectedProgressKeyframe`, `selectedColorKeyframe`, `selectedGradientKeyframe`, `selectedDashKeyframe`, and the trailing `selectedKeyframe` (scalar) branch, change `const obj = project.objects.find((o) => o.id === ref.objectId);` → `const obj = selectActiveObjects(s).find((o) => o.id === ref.objectId);` and that branch's `get().commit(replaceObject(project, X))` → `get().commit(replaceObjectInScene(project, selectActiveAssetId(s), X))`. (The `selectedShapeKeyframe` branch is already routed — leave it.) The scalar tail's commit is `get().commit(replaceObject(project, { ...obj, tracks: { ...obj.tracks, [ref.property]: next } }));`.

- [ ] **Step 4: Route `copyKeyframe`**

`copyKeyframe` snapshots into `keyframeClipboard` with no commit; its 5 non-progress branches each look up `p.objects.find((o) => o.id === r.objectId)` (the progress branch already uses `selectActiveObjects(s)`). Since `p.objects.find((o) => o.id === r.objectId)` is unique to `copyKeyframe`, replace all occurrences:

Run (as an Edit with replace_all): change every `p.objects.find((o) => o.id === r.objectId)` → `selectActiveObjects(s).find((o) => o.id === r.objectId)`.

- [ ] **Step 5: Route `retimeSelectedKeyframe` (5 non-progress branches)**

For EACH of the `selectedKeyframe` (scalar), `selectedShapeKeyframe`, `selectedColorKeyframe`, `selectedGradientKeyframe`, `selectedDashKeyframe` branches, change `const obj = project.objects.find((o) => o.id === r.objectId);` → `const obj = selectActiveObjects(s).find((o) => o.id === r.objectId);` and that branch's `get().commit(replaceObject(project, X))` → `get().commit(replaceObjectInScene(project, selectActiveAssetId(s), X))`. (The `selectedProgressKeyframe` branch is already routed — leave it.)

- [ ] **Step 6: Route `pasteKeyframe` (shared lookup + the 5 switch writes)**

Replace the non-progress tail of `pasteKeyframe` — from the shared lookup through the end of the switch:

```ts
    const obj = project.objects.find((o) => o.id === clip.objectId);
    if (!obj) return;
    switch (clip.kind) {
      case 'scalar': {
        const next = upsertKeyframe(obj.tracks[clip.property] ?? [], { ...clip.keyframe, time });
        get().commit(replaceObject(project, { ...obj, tracks: { ...obj.tracks, [clip.property]: next } }));
        get().selectKeyframe({ objectId: obj.id, property: clip.property, time });
        return;
      }
      case 'dash': {
        const next = upsertKeyframe(obj.dashOffsetTrack ?? [], { ...clip.keyframe, time });
        get().commit(replaceObject(project, { ...obj, dashOffsetTrack: next }));
        get().selectDashKeyframe({ objectId: obj.id, time });
        return;
      }
      case 'color': {
        const next = upsertColorKeyframe(obj.colorTracks?.[clip.property] ?? [], { ...clip.keyframe, time });
        get().commit(replaceObject(project, { ...obj, colorTracks: { ...obj.colorTracks, [clip.property]: next } }));
        get().selectColorKeyframe({ objectId: obj.id, property: clip.property, time });
        return;
      }
      case 'gradient': {
        const next = upsertGradientKeyframe(obj.gradientTracks?.[clip.property] ?? [], { ...clip.keyframe, time });
        get().commit(replaceObject(project, { ...obj, gradientTracks: { ...obj.gradientTracks, [clip.property]: next } }));
        get().selectGradientKeyframe({ objectId: obj.id, property: clip.property, time });
        return;
      }
      case 'shape': {
        const next = upsertShapeKeyframe(obj.shapeTrack ?? [], { ...clip.keyframe, time });
        get().commit(replaceObject(project, { ...obj, shapeTrack: next }));
        get().selectShapeKeyframe({ objectId: obj.id, time });
        return;
```

with (lookup → active scene; all five commits → `replaceObjectInScene`):

```ts
    const obj = selectActiveObjects(s).find((o) => o.id === clip.objectId);
    if (!obj) return;
    const aid = selectActiveAssetId(s);
    switch (clip.kind) {
      case 'scalar': {
        const next = upsertKeyframe(obj.tracks[clip.property] ?? [], { ...clip.keyframe, time });
        get().commit(replaceObjectInScene(project, aid, { ...obj, tracks: { ...obj.tracks, [clip.property]: next } }));
        get().selectKeyframe({ objectId: obj.id, property: clip.property, time });
        return;
      }
      case 'dash': {
        const next = upsertKeyframe(obj.dashOffsetTrack ?? [], { ...clip.keyframe, time });
        get().commit(replaceObjectInScene(project, aid, { ...obj, dashOffsetTrack: next }));
        get().selectDashKeyframe({ objectId: obj.id, time });
        return;
      }
      case 'color': {
        const next = upsertColorKeyframe(obj.colorTracks?.[clip.property] ?? [], { ...clip.keyframe, time });
        get().commit(replaceObjectInScene(project, aid, { ...obj, colorTracks: { ...obj.colorTracks, [clip.property]: next } }));
        get().selectColorKeyframe({ objectId: obj.id, property: clip.property, time });
        return;
      }
      case 'gradient': {
        const next = upsertGradientKeyframe(obj.gradientTracks?.[clip.property] ?? [], { ...clip.keyframe, time });
        get().commit(replaceObjectInScene(project, aid, { ...obj, gradientTracks: { ...obj.gradientTracks, [clip.property]: next } }));
        get().selectGradientKeyframe({ objectId: obj.id, property: clip.property, time });
        return;
      }
      case 'shape': {
        const next = upsertShapeKeyframe(obj.shapeTrack ?? [], { ...clip.keyframe, time });
        get().commit(replaceObjectInScene(project, aid, { ...obj, shapeTrack: next }));
        get().selectShapeKeyframe({ objectId: obj.id, time });
        return;
```

- [ ] **Step 7: Run to verify pass + the whole store suite**

Run: `npx vitest run src/ui/store/store.test.ts -t "in-symbol timeline keyframe editing"`
Expected: PASS (all nine). Then the whole store suite (existing root easing/retime/copy/paste tests must stay green):
Run: `npx vitest run src/ui/store/store.test.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck + commit**

```bash
npm run typecheck
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(in-symbol-timeline-kf): route setSelectedKeyframeEasing/copyKeyframe/retimeSelectedKeyframe/pasteKeyframe (all track types) to the active scene"
```

---

### Task 3: e2e + full-suite verification

**Files:**
- Modify: `e2e/symbols.spec.ts`

- [ ] **Step 1: Write the e2e test**

Append to `e2e/symbols.spec.ts`. Inside a symbol, create an animated scalar property on the internal part (autoKey move at two playhead times → two scalar keyframes), then delete one keyframe via the Timeline → the keyframe count drops.

```ts
test('delete a keyframe inside a symbol — the in-symbol Timeline op takes effect (in-symbol timeline keyframe editing)', async ({
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
  await page.mouse.move(box.x + 170, box.y + 150);
  await page.mouse.up();
  await page.locator('[data-savig-object]').first().click();
  await page.getByRole('button', { name: 'Create Symbol', exact: true }).click();
  await page.keyboard.press('Control+d');
  await expect(page.locator('[data-savig-object*="/"]')).toHaveCount(2); // 2 instances x 1 part

  // Enter the symbol, select the internal part, and create two scalar keyframes via autoKey moves
  // at two playhead times (the Timeline + autoKey are active-scene scoped).
  await page.locator('[data-savig-object*="/"]').last().dblclick();
  await expect(page.getByTestId('edit-breadcrumb')).toBeVisible();
  const part = page.locator('[data-savig-object]:not([data-savig-object*="/"])').first();
  await part.click();
  // Move at t=0.
  await page.keyboard.press('ArrowRight');
  // Advance the playhead and move again -> a second keyframe.
  await page.getByTestId('timeline-ruler').click({ position: { x: 120, y: 10 } });
  await page.keyboard.press('ArrowRight');
  const kfs = page.locator('[data-testid^="keyframe-"]');
  await expect(kfs).toHaveCount(2); // two scalar keyframes on the in-symbol Timeline

  // Select one keyframe and delete it -> the in-symbol remove takes effect.
  await kfs.first().click();
  await page.keyboard.press('Delete');
  await expect(kfs).toHaveCount(1);
});
```

> The keyframe-row dot testids follow `keyframe-<property>-<time>` (the Timeline renders them for the active scene). If the autoKey nudge or the keyframe testid prefix differs, the store tests in Tasks 1–2 are the authoritative proof of routing; adjust the nudge mechanism (the move must commit a keyframe with autoKey on, default) and the `keyframe-` locator prefix (grep the Timeline component) so two keyframes appear, then delete one.

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
git commit -m "test(in-symbol-timeline-kf): e2e delete a keyframe inside a symbol"
```

---

## Self-Review

**1. Spec coverage** (spec §2): §2.1 removes → Task 1. §2.2 easing (incl. progress) + rotation → Task 1 (rotation) + Task 2 (easing). §2.3 copy/retime/paste → Task 2. §3 parity/propagation → Global Constraints + propagation test. §4 scope (already-routed branches left unchanged) → Global Constraints. §6 tests → store (Tasks 1–2), e2e (Task 3). ✅

**2. Placeholder scan:** No TBD/TODO; the full before/after is given for `pasteKeyframe`, and the seam edit is specified per branch for the others with exact commit lines. The e2e note gives a fallback + the authoritative store tests. ✅

**3. Type consistency:** every routed branch swaps `project.objects.find`→`selectActiveObjects(s).find` and `replaceObject(project, x)`→`replaceObjectInScene(project, selectActiveAssetId(s), x)` (or the hoisted `aid` in pasteKeyframe). `RotationMode = 'shortest' | 'raw'` (test uses `'raw'`); `Keyframe = { time, value: number, easing, rotationMode? }`; `ColorKeyframe = { time, value: string, easing }`; `KeyframeRef = { objectId, property, time }`. ✅

**4. Parity:** no engine path changed; all writes are object-field track writes the existing render path applies. ✅
