# Symbol Duration Manual Override (47c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `SymbolAsset.duration` a real manual override of a symbol's effective loop/clip length (0 = auto/intrinsic).

**Architecture:** A new engine helper `symbolEffectiveDuration(asset)` (`duration` when `> 0`, else `objectsMaxKeyframeTime`) read at the single `flattenInstances` seam; a `setSymbolDuration(symId, duration)` store action; a "symbol duration" field in the per-instance "Symbol timing" Inspector panel. Preview==export is preserved because the override is read only inside the shared `flattenInstances`; regression-safe because every existing symbol has `duration: 0` → intrinsic.

**Tech Stack:** TypeScript (strict), React, Zustand, Vitest + RTL, Playwright. No new dependencies.

## Global Constraints

- **Preview == export parity preserved by construction:** the override is read ONLY via `symbolEffectiveDuration` inside `flattenInstances` (shared by `computeFrame`/preview and `renderSvgDocument`/export).
- **Regression-safe:** `duration: 0` (every existing symbol) → `symbolEffectiveDuration` returns the intrinsic → byte-unchanged.
- **No new dependencies.**
- **Undoable:** `setSymbolDuration` is one whole-project commit.
- **Commit cadence:** one commit per task (TDD). At plan end: `npm test`, `npm run typecheck`, `npx eslint src e2e`, `npm run e2e` all green.

---

### Task 1: Engine — `symbolEffectiveDuration` + the `flattenInstances` seam

**Files:**
- Modify: `src/engine/symbol.ts` (type import line 10; the `childTime` seam ~line 113–115), `src/engine/types.ts` (the `duration` field comment ~line 309–313)
- Test: `src/engine/symbol.test.ts`

**Interfaces:**
- Produces: `symbolEffectiveDuration(asset: SymbolAsset): number`.
- Consumes: `objectsMaxKeyframeTime` (already imported in symbol.ts).

- [ ] **Step 1: Write the failing tests**

Append to `src/engine/symbol.test.ts` (it already imports `flattenInstances`; add `symbolEffectiveDuration` to that import line — `import { flattenInstances, remapLocalTime, symbolContains, countSymbolInstances, symbolEffectiveDuration } from './symbol';`). Then append:

```ts
describe('symbolEffectiveDuration — manual override (47c)', () => {
  const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });

  it('returns the manual duration when > 0, else the intrinsic objectsMaxKeyframeTime', () => {
    const keyed = createSceneObject('rect-asset', { id: 'k', tracks: { x: [{ time: 0, value: 0, easing: 'linear' }, { time: 3, value: 9, easing: 'linear' }] } });
    const auto = createSymbolAsset({ id: 's1', objects: [keyed], width: 1, height: 1, duration: 0 });
    expect(symbolEffectiveDuration(auto)).toBeCloseTo(3, 6); // intrinsic
    const manual = createSymbolAsset({ id: 's2', objects: [keyed], width: 1, height: 1, duration: 2 });
    expect(symbolEffectiveDuration(manual)).toBe(2); // override
  });

  it('a 0-intrinsic symbol with a manual duration loops (was the 0-duration collapse edge)', () => {
    const inner = createSceneObject('rect-asset', { id: 'inner' }); // no keyframes -> intrinsic 0
    const sym = createSymbolAsset({ id: 'sym', objects: [inner], width: 10, height: 10, duration: 2 });
    const inst = createSceneObject('sym', { id: 'inst', symbolTime: { startOffset: 0, loop: true, speed: 1 } });
    const project = createProject();
    project.assets = [rectAsset, sym];
    project.objects = [inst];
    const leaf = flattenInstances(project, 3).find((l) => l.renderId === 'inst/inner')!; // global time 3
    expect(leaf.localTime).toBe(1); // 3 % 2 via the override (NOT 0, which the intrinsic-0 would collapse to)
  });

  it('without the override a 0-intrinsic looping symbol still collapses to 0 (regression baseline)', () => {
    const inner = createSceneObject('rect-asset', { id: 'inner' });
    const sym = createSymbolAsset({ id: 'sym', objects: [inner], width: 10, height: 10, duration: 0 });
    const inst = createSceneObject('sym', { id: 'inst', symbolTime: { startOffset: 0, loop: true, speed: 1 } });
    const project = createProject();
    project.assets = [rectAsset, sym];
    project.objects = [inst];
    const leaf = flattenInstances(project, 3).find((l) => l.renderId === 'inst/inner')!;
    expect(leaf.localTime).toBe(0);
  });
});
```

> Verify `symbol.test.ts` imports `createProject`/`createSceneObject`/`createSymbolAsset`/`createVectorAsset` (it builds symbols already); add any missing to its top `from '../...'`/engine import.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/engine/symbol.test.ts -t "manual override"`
Expected: FAIL — `symbolEffectiveDuration` not exported; the override test gets `0` (the current intrinsic-only behaviour).

- [ ] **Step 3: Add the helper + the seam + the type import**

In `src/engine/symbol.ts`, add `SymbolAsset` to the type import:

```ts
import type { Asset, Project, SceneObject, SymbolTiming } from './types';
```
→
```ts
import type { Asset, Project, SceneObject, SymbolAsset, SymbolTiming } from './types';
```

Add the helper (near `remapLocalTime`):

```ts
/** A symbol's effective timeline length: the manual `duration` override when set (> 0), else the
 *  intrinsic length derived from its objects' keyframes. Read by flattenInstances' time remap so the
 *  override flows to BOTH preview and export. (47c manual-override) */
export function symbolEffectiveDuration(asset: SymbolAsset): number {
  return asset.duration > 0 ? asset.duration : objectsMaxKeyframeTime(asset.objects);
}
```

Change the seam:

```ts
        const childTime = o.symbolTime
          ? remapLocalTime(localTime, o.symbolTime, objectsMaxKeyframeTime(asset.objects))
          : localTime;
```
→
```ts
        const childTime = o.symbolTime
          ? remapLocalTime(localTime, o.symbolTime, symbolEffectiveDuration(asset))
          : localTime;
```

- [ ] **Step 4: Update the field comment in `src/engine/types.ts`**

```ts
  /** The symbol's own timeline length (seconds). Informational — 47c derives the internal scene's
   *  effective duration at runtime from its objects' keyframes (`objectsMaxKeyframeTime`), so this
   *  field is NOT read by the remap; reserved for a future manual-override mechanism. */
  duration: number;
```
→
```ts
  /** The symbol's manual timeline-length override (seconds). 0 = AUTO: the effective duration is the
   *  intrinsic `objectsMaxKeyframeTime(objects)`. > 0 = the symbol's effective loop/clip length, used
   *  by `symbolEffectiveDuration` in the flattenInstances time remap (47c manual-override). */
  duration: number;
```

- [ ] **Step 5: Run to verify pass + the whole engine suite**

Run: `npx vitest run src/engine/symbol.test.ts`
Expected: PASS (the new override tests + all existing flattenInstances/47c tests — duration-0 symbols are unchanged). Then the engine + parity suites:
Run: `npx vitest run src/engine src/services/export src/runtime`
Expected: PASS (export==preview parity unaffected; the existing 47c parity tests still hold).

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck
git add src/engine/symbol.ts src/engine/types.ts src/engine/symbol.test.ts
git commit -m "feat(symbol-duration): symbolEffectiveDuration override read at the flattenInstances seam"
```

---

### Task 2: Store — `setSymbolDuration`

**Files:**
- Modify: `src/ui/store/store.ts` (declaration after `setSymbolTiming(...)` ~line 268; impl after `setSymbolTiming` ~line 1750+)
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Produces: `setSymbolDuration(symId: string, duration: number): void`.

- [ ] **Step 1: Write the failing tests**

Append a new describe block to `src/ui/store/store.test.ts`:

```ts
describe('setSymbolDuration — manual override (47c)', () => {
  function withSymbol() {
    const s = useEditor.getState();
    s.newProject();
    const sym = createSymbolAsset({ id: 'sym', name: 'Sym', objects: [], width: 10, height: 10, duration: 0 });
    const p = createProject();
    p.assets = [sym];
    p.objects = [createSceneObject('sym', { id: 'inst' })];
    s.commit(p);
  }
  const symDur = () => (useEditor.getState().history.present.assets.find((a) => a.id === 'sym') as { duration: number }).duration;

  it('sets the symbol asset duration', () => {
    withSymbol();
    useEditor.getState().setSymbolDuration('sym', 2.5);
    expect(symDur()).toBe(2.5);
  });

  it('clamps a negative duration to 0 (auto)', () => {
    withSymbol();
    useEditor.getState().setSymbolDuration('sym', -1);
    expect(symDur()).toBe(0);
  });

  it('an unchanged value is a no-op (no spurious commit)', () => {
    withSymbol();
    const len = useEditor.getState().history.past?.length ?? 0;
    useEditor.getState().setSymbolDuration('sym', 0); // already 0
    expect((useEditor.getState().history.past?.length ?? 0)).toBe(len); // no new history entry
  });

  it('is undoable', () => {
    withSymbol();
    useEditor.getState().setSymbolDuration('sym', 2);
    useEditor.getState().undo();
    expect(symDur()).toBe(0);
  });
});
```

> If `history.past` is not the field name for the undo stack, adjust the no-op test to assert via the public API (e.g. set to 2, then set to 2 again, then a single `undo()` restores 0 — proving the second call did not push a history entry).

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/store/store.test.ts -t "setSymbolDuration"`
Expected: FAIL — `setSymbolDuration` not defined.

- [ ] **Step 3: Add the declaration**

After `setSymbolTiming(partial: Partial<SymbolTiming>): void;` (~line 268), add:

```ts
  /** Set a symbol's manual duration override (seconds; 0 = auto/intrinsic). Affects every instance. (47c) */
  setSymbolDuration(symId: string, duration: number): void;
```

- [ ] **Step 4: Implement the action**

After the `setSymbolTiming` implementation's closing `},` (~line 1762), add:

```ts
  setSymbolDuration(symId, duration) {
    const s = get();
    const project = s.history.present;
    const sym = project.assets.find((a) => a.id === symId);
    if (!sym || sym.kind !== 'symbol') return;
    const d = Math.max(0, duration); // 0 = auto/intrinsic; negatives clamp to 0
    if (sym.duration === d) return; // no-op -> no spurious commit
    get().commit({ ...project, assets: project.assets.map((a) => (a.id === symId ? { ...a, duration: d } : a)) });
  },
```

- [ ] **Step 5: Run to verify pass + the whole store suite**

Run: `npx vitest run src/ui/store/store.test.ts -t "setSymbolDuration"`
Expected: PASS (all four). Then the whole store suite:
Run: `npx vitest run src/ui/store/store.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(symbol-duration): setSymbolDuration store action"
```

---

### Task 3: Inspector field + RTL + e2e + full verification

**Files:**
- Modify: `src/ui/components/Inspector/Inspector.tsx`
- Test: `src/ui/components/Inspector/Inspector.test.tsx`, `e2e/symbols.spec.ts`

- [ ] **Step 1: Write the failing RTL test**

Append to `src/ui/components/Inspector/Inspector.test.tsx` (mirror an existing symbol-timing test's fixture — a project with a symbol + a selected instance):

```ts
it('sets the symbol duration override from the Symbol timing panel (47c)', async () => {
  const s = useEditor.getState();
  s.newProject();
  const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
  const sym = createSymbolAsset({ id: 'sym', name: 'Sym', objects: [createSceneObject('rect-asset', { id: 'leaf' })], width: 10, height: 10, duration: 0 });
  const p = createProject();
  p.assets = [rectAsset, sym];
  p.objects = [createSceneObject('sym', { id: 'inst' })];
  act(() => { s.commit(p); s.selectObject('inst'); });
  render(<Inspector />);
  const field = screen.getByLabelText('symbol duration'); // NumberField renders <input aria-label={label}>
  await userEvent.clear(field);
  await userEvent.type(field, '2{Enter}'); // NumberField commits on Enter (and blur)
  expect((useEditor.getState().history.present.assets.find((a) => a.id === 'sym') as { duration: number }).duration).toBe(2);
});
```

> Match the existing Inspector test imports/setup (e.g. how the `start offset`/`speed`/`symbol-loop` tests build their fixture and render `<Inspector />`). `NumberField` exposes its input via `aria-label={label}` (existing tests target it with `getByLabelText(label)`), so the field is found by `getByLabelText('symbol duration')` — no test id is needed.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/components/Inspector/Inspector.test.tsx -t "symbol duration"`
Expected: FAIL — no `symbol-duration` field.

- [ ] **Step 3: Add `setSymbolDuration` + the field**

In `src/ui/components/Inspector/Inspector.tsx`, add `setSymbolDuration` to the store-action destructure (next to `setSymbolTiming` ~line 121). Then, in the "Symbol timing" panel (after the `speed` row, ~line 483), add the duration field:

```tsx
          <div className={styles.row}>
            <label htmlFor="insp-symbol duration" title="The symbol's loop/clip length (0 = auto from keyframes). Affects every instance.">symbol duration</label>
            <NumberField
              label="symbol duration"
              value={round((assets.find((a) => a.id === obj.assetId) as SymbolAsset | undefined)?.duration ?? 0)}
              step={0.1}
              onCommit={(n) => setSymbolDuration(obj.assetId, n)}
            />
          </div>
```

> `NumberField` takes only `{ label, value, step?, disabled?, onCommit }` (no testid) and renders `<input id={`insp-${label}`} aria-label={label}>`, so the field is reached via its `aria-label` (`"symbol duration"`). The visual `<label htmlFor="insp-symbol duration">` mirrors the existing rows' pattern. Add `SymbolAsset` to the Inspector's `import type { ... } from '../../../engine'` if not already imported.

- [ ] **Step 4: Run to verify pass + the Inspector suite**

Run: `npx vitest run src/ui/components/Inspector/Inspector.test.tsx`
Expected: PASS (the new test + existing symbol-timing/inspector tests).

- [ ] **Step 5: Write the e2e**

Append to `e2e/symbols.spec.ts`:

```ts
test('set a symbol duration override from the Inspector (47c)', async ({ page }) => {
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
  await page.getByRole('button', { name: 'Create Symbol', exact: true }).click(); // selects the new instance

  // The Symbol timing panel exposes the symbol-duration field (aria-label "symbol duration"); set it.
  const field = page.getByLabel('symbol duration');
  await field.fill('2');
  await field.press('Enter');
  await expect(field).toHaveValue('2');
});
```

> If the field does not retain its value after Enter, the store/RTL tests are the authoritative proof of the commit; assert the value persists by re-reading after clicking away.

- [ ] **Step 6: Full-suite verification**

```bash
npm test
npm run typecheck
npx eslint src e2e
npm run e2e
```
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/ui/components/Inspector/Inspector.tsx src/ui/components/Inspector/Inspector.test.tsx e2e/symbols.spec.ts
git commit -m "feat(symbol-duration): Inspector symbol-duration field + e2e"
```

---

## Self-Review

**1. Spec coverage** (spec §2–6): §2.1 engine helper + seam → Task 1. §2.2 setSymbolDuration → Task 2. §2.3 Inspector field → Task 3. §3 parity/regression/undo → Global Constraints + tests (the 0-intrinsic override test + the regression-baseline test). §4 scope (override only; loop-modes/keyframing/project-duration deferred) → not implemented. §6 tests → engine (Task 1), store (Task 2), RTL+e2e (Task 3). ✅

**2. Placeholder scan:** No TBD/TODO; full helper, action, and field code. The notes flag fields to verify (test imports, `history.past` name, NumberField testid prop, NumberField commit-on-Enter-vs-blur). ✅

**3. Type consistency:** `symbolEffectiveDuration(asset: SymbolAsset): number`; `setSymbolDuration(symId: string, duration: number): void`; the seam passes `symbolEffectiveDuration(asset)` (asset is narrowed to `SymbolAsset` in the symbol branch). The Inspector reads the symbol asset's `duration` and calls `setSymbolDuration(obj.assetId, n)`. ✅

**4. Parity:** the override is read only via `symbolEffectiveDuration` inside the shared `flattenInstances`; preview==export preserved; duration-0 symbols byte-unchanged (regression test). ✅
