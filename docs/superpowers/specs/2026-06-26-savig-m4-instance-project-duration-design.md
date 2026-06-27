# Savig M4 — Symbol-Instance Internal Animation in computeProjectDuration (47c follow-up)

**Date:** 2026-06-26
**Milestone:** M4 (grouping, layers & nested symbols)
**Status:** design — a bounded 47c timing follow-up.

---

## 1. Motivation

`computeProjectDuration` (auto mode) = the max keyframe time across the top-level objects + audio
clips. It counts an instance's OWN transform keyframes but **not** the symbol's internal animation. So
a symbol whose internals animate for 5 s, instanced on an otherwise-static root, yields a project
duration of 0 — the playhead range and the exported frame count don't cover the animation you can see.

Fix: fold each symbol instance's internal animation (mapped to the parent timeline through its
`symbolTime`) into `computeProjectDuration`.

## 2. Mapping internal length → parent timeline

A symbol's intrinsic content length is `symbolEffectiveDuration(symbol)` (the manual `duration`
override, else `objectsMaxKeyframeTime(symbol.objects)`) — the SAME length the renderer's time-remap
uses. The instance maps internal time to parent time by `parentTime = startOffset + internalTime /
speed`. So the parent-timeline END of the instance's internal animation is:

```
internal = symbolEffectiveDuration(symbol)            // 0 ⇒ static ⇒ contributes nothing
cycle    = pingPong ? 2 * internal : internal         // a full there-and-back is one ping-pong cycle
active   = !loop        ? internal                     // one-shot: plays once
         : playCount>0  ? playCount * cycle            // N cycles then hold
         :                cycle                         // infinite loop: cover ONE cycle
end      = startOffset + active / speed
```

`speed` defaults to 1, `startOffset` to 0 when `symbolTime` is absent. (An infinite loop has no true
end; covering one cycle lets the playhead/scrub span a full loop — the pragmatic choice.)

`computeProjectDuration` becomes:

```ts
let max = objectsMaxKeyframeTime(project.objects);
const byId = new Map(project.assets.map((a) => [a.id, a] as const));
for (const obj of project.objects) {
  const end = instanceTimelineEnd(obj, byId);  // 0 unless obj is a symbol instance
  if (end > max) max = end;
}
// …audio clips unchanged…
```

`project.objects` is the flat scene array (grouped objects carry `parentId` but are still in it), so
instances inside a top-level group are covered too — a group transform doesn't affect time.

### Module placement

`symbolEffectiveDuration` currently lives in `engine/symbol.ts`, but it only needs
`objectsMaxKeyframeTime` (which lives in `engine/duration.ts`). `duration.ts` cannot import it from
`symbol.ts` because `symbol.ts` already imports from `duration.ts` (a cycle). So **move
`symbolEffectiveDuration` into `duration.ts`** (its natural home) and have `symbol.ts` import it from
there. Both are re-exported via the `engine` barrel (`export * from './symbol' / './duration'`), so no
external import changes. `instanceTimelineEnd` is a new helper in `duration.ts`.

## 3. Parity, regression-safety

- **Parity:** `computeProjectDuration` is the SHARED timeline length used by BOTH preview playback
  range and export frame count, so extending it extends both identically — preview==export preserved.
  No `flattenInstances`/render-pipeline change.
- **Regression-safe:** a project with no symbol instances → `instanceTimelineEnd` returns 0 for every
  object → `max` unchanged → byte-identical. The move of `symbolEffectiveDuration` is behaviour-neutral
  (same function, new file; flattenInstances still calls it).
- **Manual duration mode** (`durationMode === 'manual'`) returns early, untouched.

## 4. Scope vs deferred

**In:** move `symbolEffectiveDuration` → `duration.ts`; add `instanceTimelineEnd`; fold instance
contributions into `computeProjectDuration`; tests.

**Deferred (documented):**
- **Nested-instance internal recursion:** `symbolEffectiveDuration` (via `objectsMaxKeyframeTime`)
  counts a symbol's direct keyframes and its nested instances' TRANSFORM keyframes, but NOT a nested
  instance's own internal animation. Deep recursion is out of scope (matches the renderer's current
  effective-duration, keeping timeline and render consistent).
- **`phase` (random-start):** not factored in — phase shifts/wraps the start but doesn't extend the
  content; covering one full cycle already spans it.

## 5. Testing strategy

`src/engine/duration.test.ts`:
- A static root + ONE instance of a symbol whose internal content has a keyframe at t=5 (no
  `symbolTime`): `computeProjectDuration` is 5 (was 0).
- `startOffset: 2, speed: 1, loop: false` → 2 + 5 = 7.
- `speed: 2, loop: false` → 5/2 = 2.5.
- `loop: true, playCount: 3` (no pingPong) → 3 * 5 = 15.
- `loop: true, pingPong: true` (infinite) → one cycle = 2 * 5 = 10.
- A project with NO instances is unchanged (regression baseline); `durationMode: 'manual'` unchanged.
- `symbolEffectiveDuration` still resolves the manual override vs intrinsic (move-neutral) — covered by
  its existing test via the barrel import (verify it still passes).
