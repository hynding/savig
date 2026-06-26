# Per-Instance Ping-Pong Loop Mode (47c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A looping symbol instance can bounce (ping-pong) instead of wrapping.

**Architecture:** Add an optional `SymbolTiming.pingPong`; `remapLocalTime` bounces when `loop && pingPong` (read only inside the shared `flattenInstances` → preview==export). `setSymbolTiming` merges the field; the Inspector "Symbol timing" panel gets a checkbox. Default-off → regression-safe.

**Tech Stack:** TypeScript (strict), React, Zustand, Vitest + RTL, Playwright. No new dependencies.

## Global Constraints

- **Preview == export preserved by construction:** `pingPong` is read only via `remapLocalTime` inside the shared `flattenInstances`.
- **Regression-safe:** `pingPong` absent (every existing instance) → existing wrap/one-shot path → byte-identical.
- **No new dependencies.** Undoable (one `commitActiveScene`).
- **Commit cadence:** one commit per task (TDD). At plan end: `npm test`, `npm run typecheck`, `npx eslint src e2e`, `npm run e2e` all green.

---

### Task 1: Engine — `SymbolTiming.pingPong` + `remapLocalTime` bounce

**Files:**
- Modify: `src/engine/types.ts` (`SymbolTiming`), `src/engine/symbol.ts` (`remapLocalTime`)
- Test: `src/engine/symbol.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/engine/symbol.test.ts` (inside or after the existing `remapLocalTime (slice 47c)` describe):

```ts
describe('remapLocalTime ping-pong (47c)', () => {
  const bounce = { startOffset: 0, loop: true, pingPong: true, speed: 1 };
  it('plays forward then mirrors back over a 2*duration period', () => {
    expect(remapLocalTime(2, bounce, 10)).toBeCloseTo(2, 6); // forward
    expect(remapLocalTime(10, bounce, 10)).toBeCloseTo(10, 6); // peak
    expect(remapLocalTime(12, bounce, 10)).toBeCloseTo(8, 6); // mirrored (2*10 - 12)
    expect(remapLocalTime(18, bounce, 10)).toBeCloseTo(2, 6); // mirrored
    expect(remapLocalTime(20, bounce, 10)).toBeCloseTo(0, 6); // cycle restart
  });
  it('ping-pong with loop off falls through to one-shot', () => {
    expect(remapLocalTime(12, { startOffset: 0, loop: false, pingPong: true, speed: 1 }, 10)).toBeCloseTo(10, 6);
  });
  it('without pingPong the wrap path is unchanged (regression baseline)', () => {
    expect(remapLocalTime(12, { startOffset: 0, loop: true, speed: 1 }, 10)).toBeCloseTo(2, 6);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/engine/symbol.test.ts -t "ping-pong"`
Expected: FAIL — `pingPong` not in the type / not honored; `remapLocalTime(12, bounce, 10)` returns 2 (wrap), not 8.

- [ ] **Step 3: Add the field**

In `src/engine/types.ts`, in `SymbolTiming` (after `loop`):

```ts
  /** true = loop the symbol's internal timeline; false = play once and hold the last frame. */
  loop: boolean;
```
→
```ts
  /** true = loop the symbol's internal timeline; false = play once and hold the last frame. */
  loop: boolean;
  /** When looping, bounce (play forward then backward) instead of wrapping. Absent/false = wrap. (47c) */
  pingPong?: boolean;
```

- [ ] **Step 4: Add the bounce branch**

In `src/engine/symbol.ts`, `remapLocalTime`:

```ts
  if (symbolDuration <= 0) return 0; // static symbol
  return timing.loop ? t % symbolDuration : Math.min(t, symbolDuration); // t > 0, so the mod is in range
```
→
```ts
  if (symbolDuration <= 0) return 0; // static symbol
  if (timing.loop && timing.pingPong) {
    const m = t % (2 * symbolDuration); // t > 0 so m is in [0, 2*dur)
    return m <= symbolDuration ? m : 2 * symbolDuration - m; // forward, then mirrored back
  }
  return timing.loop ? t % symbolDuration : Math.min(t, symbolDuration); // t > 0, so the mod is in range
```

- [ ] **Step 5: Run to verify pass + the engine suite**

Run: `npx vitest run src/engine/symbol.test.ts`
Expected: PASS (ping-pong + all existing remap/flatten tests). Then:
Run: `npx vitest run src/engine src/services/export src/runtime`
Expected: PASS (parity unaffected).

- [ ] **Step 6: Typecheck + commit**

```bash
npm run typecheck
git add src/engine/types.ts src/engine/symbol.ts src/engine/symbol.test.ts
git commit -m "feat(symbol-pingpong): SymbolTiming.pingPong + remapLocalTime bounce branch"
```

---

### Task 2: Store — `setSymbolTiming` merges `pingPong`

**Files:**
- Modify: `src/ui/store/store.ts` (`setSymbolTiming`)
- Test: `src/ui/store/store.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/ui/store/store.test.ts`:

```ts
describe('setSymbolTiming ping-pong (47c)', () => {
  it('sets pingPong on the selected instance and preserves the other timing fields', () => {
    const s = useEditor.getState();
    s.newProject();
    const sym = createSymbolAsset({ id: 'sym', name: 'Sym', objects: [], width: 10, height: 10 });
    const p = createProject();
    p.assets = [sym];
    p.objects = [createSceneObject('sym', { id: 'inst' })];
    s.commit(p);
    s.selectObject('inst');
    s.setSymbolTiming({ loop: true, speed: 2 });
    s.setSymbolTiming({ pingPong: true });
    const inst = useEditor.getState().history.present.objects.find((o) => o.id === 'inst')!;
    expect(inst.symbolTime?.pingPong).toBe(true);
    expect(inst.symbolTime?.loop).toBe(true); // preserved
    expect(inst.symbolTime?.speed).toBe(2); // preserved
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/store/store.test.ts -t "setSymbolTiming ping-pong"`
Expected: FAIL — `pingPong` is dropped by the merge (undefined).

- [ ] **Step 3: Add `pingPong` to the merge**

In `setSymbolTiming`:

```ts
    const next: SymbolTiming = {
      startOffset: Math.max(0, partial.startOffset ?? cur.startOffset),
      loop: partial.loop ?? cur.loop,
      speed: Math.max(1e-3, partial.speed ?? cur.speed),
    };
```
→
```ts
    const next: SymbolTiming = {
      startOffset: Math.max(0, partial.startOffset ?? cur.startOffset),
      loop: partial.loop ?? cur.loop,
      speed: Math.max(1e-3, partial.speed ?? cur.speed),
      pingPong: partial.pingPong ?? cur.pingPong ?? false,
    };
```

- [ ] **Step 4: Run to verify pass + the store suite**

Run: `npx vitest run src/ui/store/store.test.ts -t "setSymbolTiming"`
Expected: PASS. Then the whole store suite:
Run: `npx vitest run src/ui/store/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(symbol-pingpong): setSymbolTiming merges pingPong"
```

---

### Task 3: Inspector checkbox + RTL + e2e + full verification

**Files:**
- Modify: `src/ui/components/Inspector/Inspector.tsx`
- Test: `src/ui/components/Inspector/Inspector.test.tsx`, `e2e/symbols.spec.ts`

- [ ] **Step 1: Write the failing RTL test**

Append to `src/ui/components/Inspector/Inspector.test.tsx`:

```ts
it('toggles ping-pong from the Symbol timing panel (47c)', async () => {
  const s = useEditor.getState();
  s.newProject();
  const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
  const sym = createSymbolAsset({ id: 'sym', name: 'Sym', objects: [createSceneObject('rect-asset', { id: 'leaf' })], width: 10, height: 10 });
  const p = createProject();
  p.assets = [rectAsset, sym];
  p.objects = [createSceneObject('sym', { id: 'inst' })];
  act(() => { s.commit(p); s.selectObject('inst'); });
  render(<Inspector />);
  await userEvent.click(screen.getByTestId('symbol-pingpong'));
  expect(useEditor.getState().history.present.objects.find((o) => o.id === 'inst')!.symbolTime?.pingPong).toBe(true);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/components/Inspector/Inspector.test.tsx -t "ping-pong"`
Expected: FAIL — no `symbol-pingpong` checkbox.

- [ ] **Step 3: Add the checkbox**

In `src/ui/components/Inspector/Inspector.tsx`, after the loop row (the `data-testid="symbol-loop"` `<div className={styles.row}>…</div>`), add:

```tsx
          <div className={styles.row}>
            <label htmlFor="insp-symbol-pingpong">ping-pong</label>
            <input
              id="insp-symbol-pingpong"
              data-testid="symbol-pingpong"
              type="checkbox"
              checked={obj.symbolTime?.pingPong ?? false}
              onChange={(e) => setSymbolTiming({ pingPong: e.target.checked })}
            />
          </div>
```

- [ ] **Step 4: Run to verify pass + the Inspector suite**

Run: `npx vitest run src/ui/components/Inspector/Inspector.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write the e2e**

Append to `e2e/symbols.spec.ts`:

```ts
test('toggle ping-pong on a symbol instance (47c)', async ({ page }) => {
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

  const pingpong = page.getByTestId('symbol-pingpong');
  await pingpong.check();
  await expect(pingpong).toBeChecked();
});
```

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
git commit -m "feat(symbol-pingpong): Inspector ping-pong checkbox + e2e"
```

---

## Self-Review

**1. Spec coverage** (spec §2–6): §2.1 type+remap → Task 1. §2.2 setSymbolTiming → Task 2. §2.3 checkbox → Task 3. §3 parity/regression/undo → Global Constraints + the regression-baseline test. §4 scope (ping-pong only) → not exceeded. §6 tests → engine (Task 1), store (Task 2), RTL+e2e (Task 3). ✅

**2. Placeholder scan:** No TBD/TODO; full type/branch/merge/checkbox code + exact bounce assertions. ✅

**3. Type consistency:** `SymbolTiming.pingPong?: boolean`; `remapLocalTime(parentTime, timing, symbolDuration)` unchanged signature; `setSymbolTiming` merge adds `pingPong: partial.pingPong ?? cur.pingPong ?? false`; checkbox `data-testid="symbol-pingpong"`. ✅

**4. Parity:** the bounce is read only via `remapLocalTime` inside the shared `flattenInstances`; default-off → existing instances byte-unchanged. ✅
