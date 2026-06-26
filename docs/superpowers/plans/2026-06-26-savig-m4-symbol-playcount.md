# Per-Instance Play-Count-N Loop Mode Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A looping symbol instance can play N cycles then hold the final frame.

**Architecture:** One default-absent field `SymbolTiming.playCount` + one clamp in `remapLocalTime`
(read only inside the shared `flattenInstances` → preview==export). Store merge + Inspector field.

**Tech Stack:** React 18 + TS strict, Zustand, Vitest + RTL, Playwright.

## Global Constraints

- preview == export parity is non-negotiable (preserved: single `remapLocalTime` seam, default-off gate).
- TS strict; no `any`. Follow the ping-pong slice's patterns exactly.

---

### Task 1: Engine — `playCount` field + `remapLocalTime` clamp

**Files:**
- Modify: `src/engine/types.ts` (`SymbolTiming`), `src/engine/symbol.ts` (`remapLocalTime`).
- Test: `src/engine/symbol.test.ts`.

**Interfaces:**
- Produces: `SymbolTiming.playCount?: number`; `remapLocalTime` unchanged signature.

- [ ] **Step 1: Write the failing engine tests**

Append to `src/engine/symbol.test.ts`:

```ts
describe('remapLocalTime play-count (47c)', () => {
  const dur = 10;
  it('wrap loop with playCount holds the last frame after N cycles', () => {
    const tm = { startOffset: 0, loop: true, speed: 1, playCount: 2 };
    expect(remapLocalTime(15, tm, dur)).toBeCloseTo(5, 4); // mid 2nd cycle
    expect(remapLocalTime(20, tm, dur)).toBeCloseTo(10, 4); // exhausted -> hold dur
    expect(remapLocalTime(100, tm, dur)).toBeCloseTo(10, 4);
  });
  it('ping-pong with playCount holds the start frame after N there-and-back cycles', () => {
    const tm = { startOffset: 0, loop: true, speed: 1, pingPong: true, playCount: 1 };
    expect(remapLocalTime(5, tm, dur)).toBeCloseTo(5, 4); // forward
    expect(remapLocalTime(15, tm, dur)).toBeCloseTo(5, 4); // reverse 2*10-15
    expect(remapLocalTime(20, tm, dur)).toBeCloseTo(0, 4); // exhausted -> hold 0
    expect(remapLocalTime(50, tm, dur)).toBeCloseTo(0, 4);
  });
  it('playCount absent leaves wrap/ping-pong unchanged (regression baseline)', () => {
    expect(remapLocalTime(25, { startOffset: 0, loop: true, speed: 1 }, dur)).toBeCloseTo(5, 4);
    expect(remapLocalTime(20, { startOffset: 0, loop: false, speed: 1, playCount: 2 }, dur)).toBeCloseTo(10, 4); // loop off -> one-shot
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/engine/symbol.test.ts -t "play-count"`
Expected: FAIL — `playCount` not on the type / clamp not implemented (the `t=20` wrap case returns 0 from `20%10` instead of 10).

- [ ] **Step 3: Add the field**

In `src/engine/types.ts`, inside `SymbolTiming`, after `pingPong?`:

```ts
  /** When looping, play this many full cycles then hold the final frame. Absent / 0 = loop forever.
   *  One cycle = the timeline once (wrap) or there-and-back (ping-pong). (47c) */
  playCount?: number;
```

- [ ] **Step 4: Add the clamp in `remapLocalTime`**

In `src/engine/symbol.ts`, replace the body after the `symbolDuration <= 0` guard:

```ts
  if (symbolDuration <= 0) return 0; // static symbol
  if (!timing.loop) return Math.min(t, symbolDuration); // one-shot: play once, hold last frame
  if (timing.playCount && timing.playCount > 0) {
    const cycle = timing.pingPong ? 2 * symbolDuration : symbolDuration;
    if (t >= timing.playCount * cycle) return timing.pingPong ? 0 : symbolDuration; // exhausted: hold final frame
  }
  if (timing.pingPong) {
    const m = t % (2 * symbolDuration); // t > 0 so m is in [0, 2*dur)
    return m <= symbolDuration ? m : 2 * symbolDuration - m; // forward, then mirrored back
  }
  return t % symbolDuration; // t > 0, so the mod is in range
```

(This replaces the current `if (timing.loop && timing.pingPong) {…} return timing.loop ? … : …` tail
— behaviour is identical for `playCount` absent.)

- [ ] **Step 5: Run engine tests**

Run: `npx vitest run src/engine/symbol.test.ts`
Expected: PASS (play-count + all existing remapLocalTime/ping-pong/flattenInstances tests).

- [ ] **Step 6: Commit**

```bash
git add src/engine/types.ts src/engine/symbol.ts src/engine/symbol.test.ts
git commit -m "feat(symbol-playcount): SymbolTiming.playCount + remapLocalTime finite-cycle clamp"
```

---

### Task 2: Store — `setSymbolTiming` merges `playCount`

**Files:**
- Modify: `src/ui/store/store.ts` (`setSymbolTiming`, ~line 1758).
- Test: `src/ui/store/store.test.ts`.

**Interfaces:**
- Consumes: `Partial<SymbolTiming>` (now includes `playCount`).

- [ ] **Step 1: Write the failing store tests**

Append to `src/ui/store/store.test.ts` a `describe('setSymbolTiming play-count (47c)')` mirroring the
existing ping-pong describe's setup (newProject; a symbol `sym` with `objects: []`; an instance
`inst`; commit; selectObject('inst')):

```ts
describe('setSymbolTiming play-count (47c)', () => {
  const setup = () => {
    const s = useEditor.getState();
    s.newProject();
    const sym = createSymbolAsset({ id: 'sym', name: 'Sym', objects: [], width: 10, height: 10 });
    const p = createProject();
    p.assets = [sym];
    p.objects = [createSceneObject('sym', { id: 'inst' })];
    s.commit(p);
    s.selectObject('inst');
    return s;
  };
  const inst = () => useEditor.getState().history.present.objects.find((o) => o.id === 'inst')!;

  it('stores an integer playCount and preserves other fields', () => {
    const s = setup();
    s.setSymbolTiming({ loop: true, speed: 2 });
    s.setSymbolTiming({ playCount: 3 });
    expect(inst().symbolTime?.playCount).toBe(3);
    expect(inst().symbolTime?.loop).toBe(true);
    expect(inst().symbolTime?.speed).toBe(2);
  });
  it('clears playCount when set to 0 (field absent, loops forever)', () => {
    const s = setup();
    s.setSymbolTiming({ playCount: 3 });
    s.setSymbolTiming({ playCount: 0 });
    expect(inst().symbolTime?.playCount).toBeUndefined();
  });
  it('floors a fractional playCount and clamps negatives to absent', () => {
    const s = setup();
    s.setSymbolTiming({ playCount: 2.9 });
    expect(inst().symbolTime?.playCount).toBe(2);
    s.setSymbolTiming({ playCount: -5 });
    expect(inst().symbolTime?.playCount).toBeUndefined();
  });
  it('preserves an existing pingPong:true when setting playCount', () => {
    const s = setup();
    s.setSymbolTiming({ pingPong: true });
    s.setSymbolTiming({ playCount: 2 });
    expect(inst().symbolTime?.pingPong).toBe(true);
    expect(inst().symbolTime?.playCount).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/ui/store/store.test.ts -t "play-count"`
Expected: FAIL — playCount not merged.

- [ ] **Step 3: Merge playCount in `setSymbolTiming`**

In `src/ui/store/store.ts`, in `setSymbolTiming`, after computing `cur`, add the clamp and the
conditional spread inside `next` (after the pingPong spread):

```ts
    const pc = partial.playCount !== undefined ? Math.max(0, Math.floor(partial.playCount)) : cur.playCount;
    const next: SymbolTiming = {
      startOffset: Math.max(0, partial.startOffset ?? cur.startOffset),
      loop: partial.loop ?? cur.loop,
      speed: Math.max(1e-3, partial.speed ?? cur.speed),
      ...((partial.pingPong ?? cur.pingPong) ? { pingPong: true } : {}),
      // Only carry playCount when > 0 so the field stays absent by default (0 clears -> loop forever).
      ...(pc && pc > 0 ? { playCount: pc } : {}),
    };
```

- [ ] **Step 4: Run store tests**

Run: `npx vitest run src/ui/store/store.test.ts -t "setSymbolTiming"`
Expected: PASS (play-count + ping-pong + existing).

- [ ] **Step 5: Commit**

```bash
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(symbol-playcount): setSymbolTiming merges playCount (int-clamped, 0 clears)"
```

---

### Task 3: Inspector field + RTL + e2e

**Files:**
- Modify: `src/ui/components/Inspector/Inspector.tsx` (Symbol-timing panel, after the speed row ~494).
- Test: `src/ui/components/Inspector/Inspector.test.tsx`, `e2e/symbols.spec.ts`.

- [ ] **Step 1: Write the failing RTL test**

Append to `Inspector.test.tsx` (mirror the ping-pong RTL test's setup — newProject, a rect vector
asset, a symbol with one leaf, an instance `inst`, commit, selectObject('inst')); commit the
`NumberField` labelled "play count" to 3 and assert:

```tsx
it('sets play count from the Symbol timing panel (47c)', async () => {
  // …setup identical to the ping-pong RTL test (instance 'inst' selected)…
  render(<Inspector />);
  const field = screen.getByLabelText('play count');
  await userEvent.clear(field);
  await userEvent.type(field, '3');
  await userEvent.tab(); // commit on blur
  expect(useEditor.getState().history.present.objects.find((o) => o.id === 'inst')!.symbolTime?.playCount).toBe(3);
});
```

NOTE before running: verify how the existing speed `NumberField` test (if any) commits — `NumberField`
commits via `onCommit` (the spec shows `onCommit={(n)=>…}`). Check whether the panel's other
NumberField tests use `getByLabelText(label)` and `.tab()`/Enter to commit; mirror that exact
interaction (the duration-override slice added a NumberField test — copy its commit gesture).

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/ui/components/Inspector/Inspector.test.tsx -t "play count"`
Expected: FAIL — no "play count" field yet.

- [ ] **Step 3: Add the field**

In `src/ui/components/Inspector/Inspector.tsx`, after the speed `<div className={styles.row}>` block
(ending ~line 494) and before the symbol-duration row:

```tsx
          <div className={styles.row}>
            <label htmlFor="insp-symbol-playcount" title="Loop this many times then hold the last frame (0 = loop forever).">play count</label>
            <NumberField
              label="play count"
              value={round(obj.symbolTime?.playCount ?? 0)}
              step={1}
              onCommit={(n) => setSymbolTiming({ playCount: n })}
            />
          </div>
```

- [ ] **Step 4: Run RTL**

Run: `npx vitest run src/ui/components/Inspector/Inspector.test.tsx -t "play count"`
Expected: PASS.

- [ ] **Step 5: Add the e2e**

Append to `e2e/symbols.spec.ts` a test mirroring the ping-pong e2e (draw rect → Create Symbol → the
instance stays selected) that sets the play-count field and asserts it reflects the value:

```ts
test('the Symbol timing panel sets play count on an instance (slice 47c)', async ({ page }) => {
  // …addInitScript + goto + draw rect + Create Symbol (instance selected)…
  const field = page.getByLabelText('play count');
  await expect(field).toBeVisible();
  await field.fill('3');
  await field.blur();
  await expect(field).toHaveValue('3');
});
```

NOTE: confirm the NumberField renders an `<input>` reachable by `getByLabelText('play count')` and how
it echoes a committed value (the duration-override e2e, if present, is the model; otherwise assert via
the value round-trip after blur).

- [ ] **Step 6: Verify e2e (kill stale vite first)**

Run: `pkill -f vite; npx playwright test e2e/symbols.spec.ts -g "play count"`
Expected: PASS.

- [ ] **Step 7: Full verification + commit**

Run: `npx vitest run && npm run typecheck && npx eslint src/engine/symbol.ts src/engine/types.ts src/ui/store/store.ts src/ui/components/Inspector/Inspector.tsx`
Expected: all green.

```bash
git add src/ui/components/Inspector/Inspector.tsx src/ui/components/Inspector/Inspector.test.tsx e2e/symbols.spec.ts
git commit -m "feat(symbol-playcount): Inspector play-count field + RTL + e2e"
```

---

## Self-Review

- **Spec coverage:** field (T1), clamp (T1), merge (T2), Inspector (T3), all test layers — covered.
- **Placeholder scan:** the two "NOTE before running" items are real verification steps (mirror the
  existing NumberField commit gesture) with a concrete model (the duration-override NumberField
  test/e2e) — not placeholders.
- **Type consistency:** `playCount?: number` is consistent across the type, the merge clamp, and the
  Inspector `onCommit`. The `remapLocalTime` signature is unchanged.
