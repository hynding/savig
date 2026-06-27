# Savig M4 — Per-Instance Random-Start Phase (47c follow-up)

**Date:** 2026-06-26
**Milestone:** M4 (grouping, layers & nested symbols)
**Status:** design — the FOURTH 47c per-instance-timing follow-up (after duration-override, ping-pong,
play-count-N).

---

## 1. Motivation

Multiple instances of one symbol currently run their internal clocks in lockstep (same frame at the
same playhead). A per-instance **phase** offset starts an instance partway into its timeline, so
clones visibly desync — the classic "field of bobbing grass / blinking lights, each on its own
phase" effect. It is the smallest remaining 47c loop-mode item, on the same `remapLocalTime` seam.

## 2. Architecture

Same parity-safe pattern: a default-absent field read only inside `remapLocalTime` (called by the
shared `flattenInstances`).

### 2.1 Engine — `SymbolTiming.phase` + `remapLocalTime`

Add an optional field to `SymbolTiming`:

```ts
/** Seconds to advance this instance's internal clock at the start, so clones of one symbol desync.
 *  Added to the elapsed internal time before looping/clamping. Absent / 0 = start at frame 0. (47c) */
phase?: number;
```

`remapLocalTime` adds `phase` to the elapsed internal time `t`:

```ts
export function remapLocalTime(parentTime: number, timing: SymbolTiming, symbolDuration: number): number {
  const t = (parentTime - timing.startOffset) * timing.speed + (timing.phase ?? 0);
  if (t <= 0) return 0;
  // …unchanged: static guard, one-shot, play-count clamp, ping-pong, wrap…
}
```

- **Byte-identical when `phase` absent/0** (`+ 0`) → existing instances + the 47c parity/remap tests
  are unchanged.
- `phase` is an additive head-start on the instance's OWN clock (internal seconds), independent of
  `startOffset` (which is a delay on the PARENT clock). At `parentTime = startOffset`, `t = phase`, so
  the instance shows the frame it would have reached `phase` seconds in. For a loop this is
  `phase mod dur` (the wrap handles `phase >= dur`); for a one-shot a large phase simply lands on the
  held last frame.

### 2.2 Store — `setSymbolTiming` merges `phase`

```ts
const ph = partial.phase !== undefined ? Math.max(0, partial.phase) : cur.phase;
const next: SymbolTiming = {
  …startOffset, loop, speed,
  ...((partial.pingPong ?? cur.pingPong) ? { pingPong: true } : {}),
  ...(pc && pc > 0 ? { playCount: pc } : {}),
  ...(ph && ph > 0 ? { phase: ph } : {}), // absent by default; 0 clears
};
```

Non-negative clamp; `0`/absent → the conditional spread keeps it absent (byte-clean, same discipline
as pingPong/playCount).

### 2.3 Inspector — phase field

A "phase" `NumberField` in the Symbol-timing panel (after play count): `value = phase ?? 0`,
`step 0.1`, title "Start this far (seconds) into the loop — desyncs clones."
`onCommit={(n) => setSymbolTiming({ phase: n })}`.

## 3. Parity, regression-safety, undo

- **Parity:** read only inside the shared `flattenInstances` → flows to preview AND export identically.
- **Regression-safe:** `phase` absent → `+ 0` → byte-identical; a regression-baseline test pins it.
- **Undo:** one `commitActiveScene` via `setSymbolTiming`.

## 4. Scope vs deferred

**In:** `SymbolTiming.phase` + the `remapLocalTime` add; `setSymbolTiming` merge; Inspector field;
tests (engine + store + RTL + e2e).

**Deferred:** a "randomize phase" button (sets a random phase in `[0, effectiveDuration)`) — a UI
convenience on top of this mechanism, nondeterministic to test, out of scope; keyframing `symbolTime`.

## 5. Risk / tradeoff

- **Phase + startOffset together:** the held pre-start frame (when `t <= 0`) is frame 0, then the clock
  jumps to `phase` once active. With the common `startOffset = 0` this is invisible (it starts at
  `phase` immediately). Acceptable; documented.

## 6. Testing strategy

- `src/engine/symbol.test.ts`, `describe('remapLocalTime phase (47c)')` (dur 10):
  - wrap loop, `phase: 3`: `t`-equivalent `parentTime=0`→3 (started 3 in); `parentTime=8`→1 (`11 % 10`).
  - one-shot, `phase: 4`: `parentTime=0`→4; `parentTime=10`→10 (clamped).
  - `phase` absent → unchanged (regression baseline); `phase` with `speed: 2` adds AFTER the speed
    scale (`(parentTime)·2 + phase`).
- `store.test.ts`, `describe('setSymbolTiming phase (47c)')`: set `phase: 3` stored + others preserved;
  `phase: 0` clears; negative clamps to absent; set while pingPong/playCount present preserves them.
- RTL (`Inspector.test.tsx`): the panel shows a "phase" field; committing calls
  `setSymbolTiming({ phase })`.
- e2e (`symbols.spec.ts`): create a symbol + instance, set phase via the field → it persists.
