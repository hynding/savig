# Savig M4 — Per-Instance Ping-Pong Loop Mode (47c follow-up)

**Date:** 2026-06-26
**Milestone:** M4 (grouping, layers & nested symbols)
**Status:** design — the second 47c per-instance-timing follow-up (after the duration override). Adds a
ping-pong (bounce) loop mode to a symbol instance's internal clock.

---

## 1. Motivation

A looping symbol instance currently wraps (`t % duration`): it jumps from the last frame back to the
first each cycle. A ping-pong / bounce mode plays the timeline forward then backward (0→dur→0→dur…) for
a smooth back-and-forth — common for idle/oscillating motion. It is a focused extension of the existing
per-instance `loop`.

## 2. Architecture

Same parity-safe pattern the duration override proved: the new behaviour is read only inside
`remapLocalTime` (called by the shared `flattenInstances`), gated on a default-off field.

### 2.1 Engine — `SymbolTiming.pingPong` + `remapLocalTime`

Add an optional field to `SymbolTiming`:

```ts
/** When looping, bounce (forward then backward) instead of wrapping. Absent/false = wrap. */
pingPong?: boolean;
```

`remapLocalTime` gains a bounce branch (only when `loop && pingPong`):

```ts
export function remapLocalTime(parentTime: number, timing: SymbolTiming, symbolDuration: number): number {
  const t = (parentTime - timing.startOffset) * timing.speed;
  if (t <= 0) return 0;
  if (symbolDuration <= 0) return 0;
  if (timing.loop && timing.pingPong) {
    const m = t % (2 * symbolDuration); // t > 0 so the mod is in [0, 2*dur)
    return m <= symbolDuration ? m : 2 * symbolDuration - m; // forward then mirrored back
  }
  return timing.loop ? t % symbolDuration : Math.min(t, symbolDuration);
}
```

`pingPong` absent/false → the existing `loop ? t % dur : min(t, dur)` path, byte-identical. `pingPong`
only matters when `loop` is true (a ping-pong with `loop: false` falls through to one-shot, which is the
sensible interpretation — there is nothing to bounce without looping).

### 2.2 Store — `setSymbolTiming` merges `pingPong`

`setSymbolTiming(partial)` already merges the timing fields; add `pingPong`:

```ts
const next: SymbolTiming = {
  startOffset: Math.max(0, partial.startOffset ?? cur.startOffset),
  loop: partial.loop ?? cur.loop,
  speed: Math.max(1e-3, partial.speed ?? cur.speed),
  pingPong: partial.pingPong ?? cur.pingPong ?? false,
};
```

### 2.3 Inspector — ping-pong checkbox

A "ping-pong" checkbox in the "Symbol timing" panel, mirroring the loop checkbox:

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

## 3. Parity, regression-safety, undo

- **Parity (preview == export):** `remapLocalTime` is read only inside the shared `flattenInstances`
  (both `computeFrame`/preview and `renderSvgDocument`/export) — so the bounce flows to both identically.
- **Regression-safe:** `pingPong` absent (every existing instance) → the existing branch → byte-identical;
  the existing 47c remap/parity tests are unaffected.
- **Undo:** the toggle is one `commitActiveScene` (via `setSymbolTiming`) — undoable.

## 4. Scope (this slice) vs deferred

**In:** `SymbolTiming.pingPong` + the `remapLocalTime` bounce branch; `setSymbolTiming` merge; the
Inspector checkbox; tests (engine + store + RTL + e2e).

**Deferred (other 47c):** play-count-N (loop N times then hold); random-start (per-instance phase);
keyframing `symbolTime`; symbol-instance duration in `computeProjectDuration`.

## 5. Risks / tradeoffs

- **Bounce math:** the `m <= dur ? m : 2*dur - m` reflection over a `2*dur` period is the standard
  triangle wave; at the seam (`m === dur`) both branches give `dur` (continuous), and `m → 2*dur` gives
  `0` (continuous with the next cycle's start).
- **ping-pong with loop off:** falls through to one-shot (no bounce without a loop) — documented; the UI
  leaves the checkbox enabled but it has no effect until loop is on (matches how speed/offset are always
  editable).

## 6. Testing strategy

- `src/engine/symbol.test.ts`:
  - `remapLocalTime` with `{ loop: true, pingPong: true }` over duration 10: at `t=2`→2 (forward), at
    `t=12`→8 (mirrored: 2*10 - 12), at `t=18`→2 (still mirrored), at `t=20`→0 (cycle restart), at
    `t=10`→10 (peak).
  - `pingPong` with `loop: false` falls through to one-shot (`min(t, dur)`).
  - `pingPong` absent → the wrap path unchanged (regression baseline).
- `store.test.ts`: `setSymbolTiming({ pingPong: true })` sets it on the selected instance; preserves the
  other timing fields; undoable.
- RTL (`Inspector.test.tsx`): the Symbol timing panel shows a "ping-pong" checkbox; toggling it calls
  `setSymbolTiming({ pingPong: true })` (the instance's `symbolTime.pingPong` updates).
- e2e (`symbols.spec.ts`): create a symbol + instance, toggle the ping-pong checkbox → it reflects
  checked (the toggle persists).
