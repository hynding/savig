# Per-Instance Random-Start Phase Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A symbol instance can start partway into its internal timeline (a `phase` offset) so clones
desync.

**Architecture:** Default-absent `SymbolTiming.phase` added to `t` in `remapLocalTime` (the single
shared seam → preview==export). Store merge + Inspector field. Mirrors the ping-pong/play-count slices.

**Tech Stack:** React 18 + TS strict, Zustand, Vitest + RTL, Playwright.

## Global Constraints
- preview == export parity non-negotiable (single `remapLocalTime` seam, default-off gate).
- TS strict; reuse the ping-pong/play-count patterns exactly.

---

### Task 1: Engine — `phase` field + `remapLocalTime`

**Files:** Modify `src/engine/types.ts`, `src/engine/symbol.ts`; Test `src/engine/symbol.test.ts`.

- [ ] **Step 1: Failing engine tests** — append to symbol.test.ts:

```ts
describe('remapLocalTime phase (47c)', () => {
  const dur = 10;
  it('wrap loop with phase starts partway in and wraps', () => {
    const tm = { startOffset: 0, loop: true, speed: 1, phase: 3 };
    expect(remapLocalTime(0, tm, dur)).toBeCloseTo(3, 4);  // started 3 in
    expect(remapLocalTime(8, tm, dur)).toBeCloseTo(1, 4);  // (8+3) % 10
  });
  it('one-shot with phase starts partway and clamps to dur', () => {
    const tm = { startOffset: 0, loop: false, speed: 1, phase: 4 };
    expect(remapLocalTime(0, tm, dur)).toBeCloseTo(4, 4);
    expect(remapLocalTime(10, tm, dur)).toBeCloseTo(10, 4); // min(14,10)
  });
  it('phase is added after the speed scale', () => {
    const tm = { startOffset: 0, loop: true, speed: 2, phase: 1 };
    expect(remapLocalTime(2, tm, dur)).toBeCloseTo(5, 4); // 2*2 + 1
  });
  it('phase absent is unchanged (regression baseline)', () => {
    expect(remapLocalTime(3, { startOffset: 0, loop: true, speed: 1 }, dur)).toBeCloseTo(3, 4);
  });
});
```

- [ ] **Step 2: Run → fails** (`npx vitest run src/engine/symbol.test.ts -t "phase"`): `parentTime=0` returns 0 today, not 3.

- [ ] **Step 3:** In `types.ts` `SymbolTiming`, after `playCount?`:

```ts
  /** Seconds to advance this instance's internal clock at the start, so clones of one symbol desync.
   *  Added to the elapsed internal time before looping/clamping. Absent / 0 = start at frame 0. (47c) */
  phase?: number;
```

- [ ] **Step 4:** In `symbol.ts` `remapLocalTime`, change the first line:

```ts
  const t = (parentTime - timing.startOffset) * timing.speed + (timing.phase ?? 0);
```

(everything below the `if (t <= 0)` line is unchanged.)

- [ ] **Step 5: Run engine tests** (`npx vitest run src/engine/symbol.test.ts`): PASS.

- [ ] **Step 6: Commit** `feat(symbol-phase): SymbolTiming.phase + remapLocalTime head-start`.

---

### Task 2: Store — `setSymbolTiming` merges `phase`

**Files:** Modify `src/ui/store/store.ts` (`setSymbolTiming`); Test `src/ui/store/store.test.ts`.

- [ ] **Step 1: Failing store tests** — append `describe('setSymbolTiming phase (47c)')` mirroring the
play-count describe's `setup`/`inst` helpers:

```ts
it('stores a non-negative phase and preserves other fields', () => {
  const s = setup(); s.setSymbolTiming({ loop: true }); s.setSymbolTiming({ phase: 3 });
  expect(inst().symbolTime?.phase).toBe(3); expect(inst().symbolTime?.loop).toBe(true);
});
it('clears phase when set to 0', () => {
  const s = setup(); s.setSymbolTiming({ phase: 3 }); s.setSymbolTiming({ phase: 0 });
  expect(inst().symbolTime?.phase).toBeUndefined();
});
it('clamps a negative phase to absent', () => {
  const s = setup(); s.setSymbolTiming({ phase: -2 }); expect(inst().symbolTime?.phase).toBeUndefined();
});
it('preserves pingPong/playCount when setting phase', () => {
  const s = setup(); s.setSymbolTiming({ pingPong: true, playCount: 2 }); s.setSymbolTiming({ phase: 1 });
  expect(inst().symbolTime?.pingPong).toBe(true); expect(inst().symbolTime?.playCount).toBe(2); expect(inst().symbolTime?.phase).toBe(1);
});
```

(Add a fresh `describe('setSymbolTiming phase (47c)')` wrapper with its own `setup`/`inst` like the
play-count block, OR reuse by placing these inside a new describe with copied helpers.)

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3:** In `setSymbolTiming`, after the `pc` line add `ph` and a spread:

```ts
    const ph = partial.phase !== undefined ? Math.max(0, partial.phase) : cur.phase;
```
and inside `next`, after the playCount spread:
```ts
      ...(ph && ph > 0 ? { phase: ph } : {}),
```

- [ ] **Step 4: Run → PASS** (`-t "setSymbolTiming"`).

- [ ] **Step 5: Commit** `feat(symbol-phase): setSymbolTiming merges phase (>=0 clamp, 0 clears)`.

---

### Task 3: Inspector field + RTL + e2e

**Files:** Modify `src/ui/components/Inspector/Inspector.tsx`; Test `Inspector.test.tsx`, `e2e/symbols.spec.ts`.

- [ ] **Step 1: Failing RTL test** — mirror the play-count RTL test ('sets play count…'), labelled "phase", commit 3, assert `symbolTime?.phase === 3`.

- [ ] **Step 2: Run → fails.**

- [ ] **Step 3:** In Inspector.tsx, after the play-count row, before the symbol-duration row:

```tsx
          <div className={styles.row}>
            <label htmlFor="insp-symbol-phase" title="Start this far (seconds) into the loop — desyncs clones.">phase</label>
            <NumberField label="phase" value={round(obj.symbolTime?.phase ?? 0)} step={0.1} onCommit={(n) => setSymbolTiming({ phase: n })} />
          </div>
```

- [ ] **Step 4: Run RTL → PASS.**

- [ ] **Step 5: e2e** — append to symbols.spec.ts a test mirroring the play-count e2e: draw rect →
Create Symbol → `page.getByLabel('phase').fill('3'); .press('Enter')`; `expect(field).toHaveValue('3')`.

- [ ] **Step 6:** `pkill -f vite; npx playwright test e2e/symbols.spec.ts -g "phase"` → PASS.

- [ ] **Step 7: Full verify + commit** — `npx vitest run && npm run typecheck && npx eslint <touched>`;
`feat(symbol-phase): Inspector phase field + RTL + e2e`.

---

## Self-Review
- Spec coverage: field/add (T1), merge (T2), Inspector (T3) + all test layers — covered.
- Placeholders: none (the play-count RTL/e2e tests are the cited models).
- Type consistency: `phase?: number` consistent across type, merge clamp, Inspector onCommit.
