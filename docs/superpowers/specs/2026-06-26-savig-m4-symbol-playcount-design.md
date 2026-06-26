# Savig M4 — Per-Instance Play-Count-N Loop Mode (47c follow-up)

**Date:** 2026-06-26
**Milestone:** M4 (grouping, layers & nested symbols)
**Status:** design — the THIRD 47c per-instance-timing follow-up (after duration-override + ping-pong).

---

## 1. Motivation

A looping instance currently loops FOREVER (wrap or ping-pong). Play-count-N lets a looping instance
play a fixed number of cycles and then **hold the final frame** — e.g. an intro flourish that bounces
3 times and stops. It is a focused extension of the existing per-instance `loop`, on the same
`remapLocalTime` seam the duration-override and ping-pong slices proved.

## 2. Architecture

Same parity-safe pattern: the new behaviour is read only inside `remapLocalTime` (called by the shared
`flattenInstances`), gated on a default-absent field.

### 2.1 Engine — `SymbolTiming.playCount` + `remapLocalTime`

Add an optional field to `SymbolTiming`:

```ts
/** When looping, play this many full cycles then hold the final frame. Absent / 0 = loop forever.
 *  One cycle = the timeline once (wrap) or there-and-back (ping-pong). (47c) */
playCount?: number;
```

`remapLocalTime` gains a finite-cycle clamp, applied only while looping and only when `playCount > 0`:

```ts
export function remapLocalTime(parentTime: number, timing: SymbolTiming, symbolDuration: number): number {
  const t = (parentTime - timing.startOffset) * timing.speed;
  if (t <= 0) return 0;
  if (symbolDuration <= 0) return 0;
  if (!timing.loop) return Math.min(t, symbolDuration); // one-shot
  if (timing.playCount && timing.playCount > 0) {
    const cycle = timing.pingPong ? 2 * symbolDuration : symbolDuration;
    if (t >= timing.playCount * cycle) return timing.pingPong ? 0 : symbolDuration; // exhausted: hold final frame
  }
  if (timing.pingPong) {
    const m = t % (2 * symbolDuration);
    return m <= symbolDuration ? m : 2 * symbolDuration - m;
  }
  return t % symbolDuration;
}
```

- **Byte-identical when `playCount` absent/0** (the new block is skipped) → existing instances and the
  47c parity/remap tests are unaffected.
- **`playCount` only matters while looping** — a one-shot already plays once and holds, so `playCount`
  with `loop: false` falls through to the existing one-shot (consistent with how `pingPong` requires
  `loop`).
- **A cycle** = the full timeline traversal: wrap → `dur` (0→dur); ping-pong → `2·dur` (0→dur→0). After
  `N` cycles the held frame is the cycle's END: wrap holds `dur` (last frame); ping-pong holds `0`
  (back at the start, where the Nth bounce lands). Documented.

### 2.2 Store — `setSymbolTiming` merges `playCount`

```ts
const pc = partial.playCount !== undefined ? Math.max(0, Math.floor(partial.playCount)) : cur.playCount;
const next: SymbolTiming = {
  startOffset: …, loop: …, speed: …,
  ...((partial.pingPong ?? cur.pingPong) ? { pingPong: true } : {}),
  ...(pc && pc > 0 ? { playCount: pc } : {}), // absent by default; 0 clears (loop forever)
};
```

Integer-clamped, non-negative; `0` (or a negative/fractional that floors to 0) clears the field → the
conditional spread keeps it absent → byte-clean (same discipline as `pingPong`).

### 2.3 Inspector — play-count field

A "play count" `NumberField` in the Symbol-timing panel (after speed): `value = playCount ?? 0`,
`step 1`, label/title "0 = loop forever". `onCommit={(n) => setSymbolTiming({ playCount: n })}`.

## 3. Parity, regression-safety, undo

- **Parity (preview == export):** `remapLocalTime` is read only inside the shared `flattenInstances`
  (both `computeFrame`/preview and `renderSvgDocument`/export) → the clamp flows to both identically.
- **Regression-safe:** `playCount` absent (every existing instance) → the new block is skipped →
  byte-identical; a regression-baseline test pins the absent case.
- **Undo:** the field edit is one `commitActiveScene` (via `setSymbolTiming`) — undoable.

## 4. Scope (this slice) vs deferred

**In:** `SymbolTiming.playCount` + the `remapLocalTime` clamp; `setSymbolTiming` merge; the Inspector
field; tests (engine + store + RTL + e2e).

**Deferred (other 47c):** random-start (per-instance phase); keyframing `symbolTime`; symbol-instance
duration in `computeProjectDuration`.

## 5. Risks / tradeoffs

- **Ping-pong + playCount holds at 0** (start frame) after N there-and-back cycles — mathematically
  where the bounce lands; documented. Wrap holds at `dur` (last frame), the more intuitive case.
- **A "cycle" = a full timeline pass.** For ping-pong this is forward+back (not a half-bounce). This
  is the simplest defensible definition and composes cleanly with the existing ping-pong branch.

## 6. Testing strategy

- `src/engine/symbol.test.ts`, `describe('remapLocalTime play-count (47c)')` (duration 10):
  - wrap, `playCount: 2`: `t=15`→5 (mid 2nd cycle, `15%10`); `t=20`→10 (exhausted: hold `dur`);
    `t=100`→10 (still held).
  - ping-pong, `playCount: 1`: `t=5`→5 (forward); `t=15`→5 (reverse, `2·10−15`); `t=20`→0 (exhausted:
    hold `0`); `t=50`→0.
  - `playCount` absent → wrap/ping-pong unchanged (regression baseline); `playCount` with `loop:false`
    → one-shot unchanged.
- `store.test.ts`, `describe('setSymbolTiming play-count (47c)')`: set `playCount: 3` → stored 3 +
  other fields preserved; `playCount: 0` clears (field undefined); fractional/negative floors/clamps;
  set while pingPong true preserves pingPong.
- RTL (`Inspector.test.tsx`): the panel shows a "play count" field; committing it calls
  `setSymbolTiming({ playCount })` (the instance's `symbolTime.playCount` updates).
- e2e (`symbols.spec.ts`): create a symbol + instance, set play count via the field → it persists.
