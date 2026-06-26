# Savig M4 — Nested Symbols 47c: Independent Per-Instance Timelines

**Date:** 2026-06-25
**Milestone:** M4 (grouping, layers & nested symbols)
**Status:** design — the third nested-symbols sub-slice (47a foundation + 47b transform UI + 47-edit
edit-mode are merged). This makes two instances of the same symbol show **different frames at the
same wall-clock moment**.

---

## 1. Motivation

47a flattens every symbol instance at the **global** time, so all instances of a symbol show the
*same* internal frame — a spinning-gear symbol placed three times spins in perfect lockstep. The
whole point of a Flash MovieClip is that each instance can run on its **own** timeline: start later,
loop, or play faster. 47c adds a per-instance **time remap** so two instances diverge in frame.

The engine seam is already in place: `flattenInstances` threads a `localTime` down the recursion and
samples every leaf at it; in 47a–edit that local time is just the global time. 47c replaces the one
identity line with a real remap. Because **both preview and export re-derive each frame through
`computeFrame → flattenInstances`** (the editor's `applyFrame` and the runtime's per-frame `loop`
both call `computeFrame(project, time)`, pinned equal by the parity test), the remap reaches the
exported bundle **for free** — no export-specific work, parity by construction.

## 2. Data model — an optional per-instance timing field

A new optional field on `SceneObject`, meaningful only when the object is a symbol instance:

```ts
export interface SymbolTiming {
  /** Seconds on the PARENT timeline before this instance's internal clock starts (>= 0). */
  startOffset: number;
  /** true = loop the symbol's internal timeline; false = play once and hold the last frame. */
  loop: boolean;
  /** Internal-clock speed multiplier (1 = real-time; 2 = double speed; must be > 0). */
  speed: number;
}

export interface SceneObject {
  // …existing…
  /** Per-instance internal-timeline remap (slice 47c). ABSENT = identity (the instance plays in
   *  lockstep with the parent timeline — exactly the 47a behaviour, so existing projects and the
   *  parity test are byte-unchanged). Only consulted when the object is a symbol instance. */
  symbolTime?: SymbolTiming;
}
```

**The default is no field → identity remap.** This is the pivotal parity choice: a freshly created
instance (and every existing project) keeps lockstep playback until the user opts in via the
Inspector. There is no behaviour change, and no migration.

## 3. The remap

```ts
// engine/symbol.ts
/** Map the PARENT scene's local time to this instance's internal local time (slice 47c).
 *  - shift so the internal clock starts at `startOffset` on the parent timeline;
 *  - scale by `speed`;
 *  - before the start (negative), hold the first frame (t = 0);
 *  - LOOP: wrap into [0, duration); ONE-SHOT: hold the last frame (clamp to duration).
 *  `symbolDuration` is the symbol's intrinsic content length (max keyframe time of its objects).
 *  A zero-duration symbol is static, so any remap collapses to 0. */
export function remapLocalTime(parentTime: number, timing: SymbolTiming, symbolDuration: number): number {
  let t = (parentTime - timing.startOffset) * timing.speed;
  if (t <= 0) return 0;                 // before start (or exactly at): first frame
  if (symbolDuration <= 0) return 0;    // static symbol
  if (timing.loop) return t % symbolDuration;          // wrap (t already > 0)
  return Math.min(t, symbolDuration);                  // one-shot: hold last frame
}
```

Note `t > 0` is guaranteed before the modulo, so `t % symbolDuration` is already in `[0, duration)`
(no negative-modulo correction needed). Speed is assumed `> 0` (the store clamps it).

### 3.1 Symbol intrinsic duration

`computeProjectDuration` walks `project.objects` keyframes but not symbol assets. Extract the
per-objects keyframe-max into a shared helper and reuse it for a symbol's content length:

```ts
// engine/duration.ts
/** The latest keyframe time across an objects[] list (transform/shape/color/gradient/dash/motion).
 *  Shared by computeProjectDuration (root + audio) and the symbol intrinsic-duration lookup (47c). */
export function objectsMaxKeyframeTime(objects: SceneObject[]): number;
```

`computeProjectDuration` becomes `max(objectsMaxKeyframeTime(project.objects), audio…)` — identical
output, just refactored (covered by its existing tests). The symbol's duration for the remap is
`objectsMaxKeyframeTime(symbolAsset.objects)`. (v1 reads the content; `SymbolAsset.duration` as a
manual override is deferred.)

## 4. Engine wiring — one line at the recursion seam

In `flattenInstances`, when expanding an instance, compute the child scene's local time from the
parent's via the remap, **only when the instance carries a `symbolTime`** (else identity → parity):

```ts
if (asset && asset.kind === 'symbol') {
  if (visited.has(asset.id)) continue;
  const st = sampleObject(o, localTime);              // the INSTANCE's own transform: PARENT timeline (unchanged)
  const instTransform = […];
  const childTime = o.symbolTime                       // the INTERNALS' timeline (47c)
    ? remapLocalTime(localTime, o.symbolTime, objectsMaxKeyframeTime(asset.objects))
    : localTime;
  walk(asset.objects, childTime, instTransform, renderId, opacity * st.opacity, nextVisited);
}
```

Two facts make this complete:

- **The instance's own transform still samples at `localTime`** (the instance animates on the parent
  timeline as any object); only the *internals* sample at `childTime`. Correct and unchanged.
- **Nesting composes by recursion:** a nested instance's own transform samples at its parent
  symbol's `childTime`, and its internals remap again from there — the "instanceChain" remap of the
  spec is just the recursion. Cycle-guard, id-namespacing, group prefixes are all untouched.

## 5. Authoring surface — the Inspector "Symbol timing" panel

When a single **symbol instance** is selected (root scene or inside a symbol in edit mode), the
Inspector shows a *Symbol timing* section:

- **Start offset** (seconds, ≥ 0)
- **Loop** (checkbox; off = play once / hold last)
- **Speed** (number, > 0, default 1)

Editing any control calls a new store action `setSymbolTiming(partial: Partial<SymbolTiming>)`:
it reads the selected instance from the **active scene** (`selectActiveObjects`), merges the partial
onto the existing `symbolTime` (defaulting `{ startOffset: 0, loop: false, speed: 1 }` when first
set), clamps `speed > 0` and `startOffset ≥ 0`, and commits via `commitActiveScene` (so it works at
the root AND inside a symbol — consistent with the 47-edit transform routing). Undoable.

The panel only renders for a single-selected object whose asset is a `SymbolAsset` (reuse the
`isSymbolInstance` predicate). Setting Loop on (or any field) is what *creates* the `symbolTime`
field — before that the instance is identity (lockstep).

## 6. Parity, export, undo

- **Parity (preview == export):** the remap lives in the shared `flattenInstances`; both consumers
  re-derive per frame, so they stay byte-identical. The existing parity test (no `symbolTime`) is
  unchanged; a new parity assertion covers an instance *with* timing.
- **Export:** automatic — the runtime's per-frame `computeFrame(project, t)` calls `flattenInstances`
  which remaps. No change to `renderDocument`/the runtime bundle.
- **Undo/persistence:** `symbolTime` is ordinary object data on the `SceneObject`, snapshotted by
  history and serialized like any field. `setSymbolTiming` commits through the normal path.

## 7. Scope (this slice) vs deferred

**In 47c:** `SymbolTiming` type + optional `symbolTime` field; `remapLocalTime` + `objectsMaxKeyframeTime`
(refactor `computeProjectDuration` to share it); the one-line `flattenInstances` remap; `setSymbolTiming`
store action (active-scene routed, clamped, undoable); the Inspector *Symbol timing* panel; unit tests
(remap math; two instances diverge; nested compose; identity-when-absent parity); a parity-test
extension; an e2e (two instances of a looping symbol show different frames at one playhead time).

**Deferred:** keyframing the timing fields (animated start/speed); `SymbolAsset.duration` as a manual
duration override + a UI for it; ping-pong / play-count-N / random-start / first-frame-pose;
reflecting per-instance loop length on the Timeline ruler; a per-instance "reset to lockstep" button
(removing the field — though setting identity values is equivalent). 47d (symbols library) follows.

## 8. Risks / tradeoffs

- **Symbol duration from content keyframes** is 0 for a symbol whose only motion is a *nested*
  looping instance with no keyframes on its own objects → that symbol's loop collapses to frame 0.
  Acceptable v1 (the common case animates the symbol's own parts); a manual `duration` override
  lifts it later.
- **`startOffset`/`speed` validation:** the store clamps (`startOffset ≥ 0`, `speed > 0`); a 0/negative
  speed would freeze/reverse — out of v1 scope, so clamp rather than support.
- **Before-start behaviour** is "hold first frame" (`t ≤ 0 → 0`), the simplest sensible default;
  hiding-until-start is deferred.

## 9. Testing strategy

- `engine/symbol.test.ts`: `remapLocalTime` — identity-ish (offset 0, speed 1, loop, mid-range);
  startOffset shift; before-start → 0; speed scaling; loop wrap past duration; one-shot hold at
  duration; zero-duration → 0. `flattenInstances` — an instance with `symbolTime` samples its leaves
  at the remapped time; two instances with different `startOffset` yield different leaf sample times
  at the same global time; an instance WITHOUT `symbolTime` is byte-identical to today (parity);
  nested instances compose two remaps.
- `engine/duration.test.ts`: `objectsMaxKeyframeTime`; `computeProjectDuration` unchanged.
- `store.test.ts`: `setSymbolTiming` creates the field with defaults, merges partials, clamps
  speed/startOffset, routes to the active scene (works inside a symbol), undoable.
- `Inspector.test.tsx`: the timing panel shows for a selected instance and writes via `setSymbolTiming`.
- computeFrame/renderDocument **parity** extended with a timed instance.
- e2e: two instances of a looping symbol; at a chosen playhead the two render different internal
  frames (their leaves differ in transform).
