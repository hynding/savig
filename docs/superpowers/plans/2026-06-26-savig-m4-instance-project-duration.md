# Symbol-Instance Internal Animation in computeProjectDuration Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `computeProjectDuration` (auto mode) covers each symbol instance's internal animation mapped
to the parent timeline.

**Architecture:** Move `symbolEffectiveDuration` → `duration.ts` (avoids a cycle); add a pure
`instanceTimelineEnd` helper; fold instance contributions into `computeProjectDuration`. Shared
duration → preview==export consistent.

**Tech Stack:** TS strict, Vitest.

## Global Constraints
- preview == export parity (duration is the shared timeline length for both).
- TS strict; no `any`. Reuse `objectsMaxKeyframeTime`, `symbolEffectiveDuration`.

---

### Task 1: Move `symbolEffectiveDuration` into duration.ts (behaviour-neutral)

**Files:** Modify `src/engine/symbol.ts`, `src/engine/duration.ts`.

- [ ] **Step 1:** In `src/engine/duration.ts`, add (after `objectsMaxKeyframeTime`), importing the
`SymbolAsset` type at the top if not present:

```ts
/** A symbol's effective timeline length: the manual `duration` override when set (> 0), else the
 *  intrinsic length from its objects' keyframes. Read by flattenInstances' time remap (so the override
 *  flows to preview AND export) and by computeProjectDuration. (47c) */
export function symbolEffectiveDuration(asset: SymbolAsset): number {
  return asset.duration > 0 ? asset.duration : objectsMaxKeyframeTime(asset.objects);
}
```

- [ ] **Step 2:** In `src/engine/symbol.ts`, DELETE the local `symbolEffectiveDuration` definition and
import it from `./duration` instead (add to the existing `import { objectsMaxKeyframeTime } from './duration'`
line → `import { objectsMaxKeyframeTime, symbolEffectiveDuration } from './duration'`). Drop
`objectsMaxKeyframeTime` from that import if it becomes unused in symbol.ts (verify with eslint).

- [ ] **Step 3:** Run `npx vitest run src/engine && npm run typecheck` — all green (pure move; the
existing symbolEffectiveDuration tests + flattenInstances tests pass via the barrel).

- [ ] **Step 4: Commit** `refactor(duration): move symbolEffectiveDuration into duration.ts`.

---

### Task 2: `instanceTimelineEnd` + fold into computeProjectDuration

**Files:** Modify `src/engine/duration.ts`; Test `src/engine/duration.test.ts`.

**Interfaces:**
- Consumes: `symbolEffectiveDuration`, `objectsMaxKeyframeTime`; `Asset`, `SceneObject` types.
- Produces: `instanceTimelineEnd(obj, assetsById): number` (exported for testability).

- [ ] **Step 1: Failing tests** — append to `src/engine/duration.test.ts`. Build a symbol whose inner
leaf has an `x` keyframe at t=5 so `symbolEffectiveDuration` = 5 (intrinsic), an instance of it at
root, a static project otherwise. (Confirm the test helpers: `createProject`/`createSceneObject`/
`createSymbolAsset`/`createVectorAsset`; a keyframe via the inner object's `tracks.x = [{time:5,value:0,easing:'linear'}]`.)

```ts
describe('computeProjectDuration with symbol instances (47c)', () => {
  const symWithKf = () => {
    const inner = createSceneObject('rect-asset', { id: 'leaf' });
    inner.tracks = { x: [{ time: 0, value: 0, easing: 'linear' }, { time: 5, value: 50, easing: 'linear' }] };
    return createSymbolAsset({ id: 'S', name: 'S', objects: [inner], width: 10, height: 10 });
  };
  const proj = (symbolTime?: Partial<import('./types').SymbolTiming>) => {
    const p = createProject();
    p.assets = [createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' }), symWithKf()];
    const inst = createSceneObject('S', { id: 'inst' });
    if (symbolTime) inst.symbolTime = { startOffset: 0, loop: false, speed: 1, ...symbolTime };
    p.objects = [inst];
    return p;
  };

  it('counts the instance internal length (no symbolTime)', () => {
    expect(computeProjectDuration(proj())).toBeCloseTo(5, 4); // was 0
  });
  it('adds startOffset and divides by speed', () => {
    expect(computeProjectDuration(proj({ startOffset: 2 }))).toBeCloseTo(7, 4);
    expect(computeProjectDuration(proj({ speed: 2 }))).toBeCloseTo(2.5, 4);
  });
  it('multiplies by playCount when looping', () => {
    expect(computeProjectDuration(proj({ loop: true, playCount: 3 }))).toBeCloseTo(15, 4);
  });
  it('covers one there-and-back cycle for an infinite ping-pong loop', () => {
    expect(computeProjectDuration(proj({ loop: true, pingPong: true }))).toBeCloseTo(10, 4);
  });
  it('is unchanged for a project with no instances', () => {
    const p = createProject(); // default project, no symbols
    expect(computeProjectDuration(p)).toBeCloseTo(objectsMaxKeyframeTime(p.objects), 4);
  });
});
```

NOTE before running: verify `createProject()` has no symbol instances by default and that
`Keyframe.easing` accepts `'linear'`; verify `objectsMaxKeyframeTime` is exported (it is — used above).

- [ ] **Step 2: Run → fails** (`-t "with symbol instances"`): the no-symbolTime case returns 0.

- [ ] **Step 3:** In `src/engine/duration.ts`, add the helper + fold into `computeProjectDuration`:

```ts
/** Parent-timeline end of a symbol instance's INTERNAL animation (47c): startOffset + the active
 *  internal length (one-shot once; loop+playCount N cycles; infinite loop one cycle) / speed. 0 for a
 *  non-instance or a 0-length (static) symbol. v1: does NOT recurse into a symbol's own nested
 *  instances (matches the renderer's effective duration). */
export function instanceTimelineEnd(obj: SceneObject, assetsById: Map<string, Asset>): number {
  const asset = assetsById.get(obj.assetId);
  if (!asset || asset.kind !== 'symbol') return 0;
  const internal = symbolEffectiveDuration(asset);
  if (internal <= 0) return 0;
  const t = obj.symbolTime;
  const speed = t && t.speed > 0 ? t.speed : 1;
  const startOffset = t?.startOffset ?? 0;
  const cycle = t?.pingPong ? 2 * internal : internal;
  const active = !t?.loop ? internal : t.playCount && t.playCount > 0 ? t.playCount * cycle : cycle;
  return startOffset + active / speed;
}
```

In `computeProjectDuration`, after `let max = objectsMaxKeyframeTime(project.objects);`:

```ts
  const byId = new Map(project.assets.map((a) => [a.id, a] as const));
  for (const obj of project.objects) {
    const end = instanceTimelineEnd(obj, byId);
    if (end > max) max = end;
  }
```

Confirm `Asset` is imported in duration.ts (add to the type import if missing).

- [ ] **Step 4: Run → PASS** (`npx vitest run src/engine/duration.test.ts`).

- [ ] **Step 5: Full verify** — `npx vitest run && npm run typecheck && npx eslint src/engine/duration.ts src/engine/symbol.ts src/engine/duration.test.ts`. Watch for any existing test that asserted a symbol project's duration as 0 (would now change — update if it was asserting the OLD bug).

- [ ] **Step 6: Commit** `feat(duration): count symbol-instance internal animation in computeProjectDuration (47c)`.

---

## Self-Review
- Spec coverage: move (T1), helper + fold (T2), all duration cases + regression baseline — covered.
- Placeholders: the "NOTE before running" verifies createProject defaults + Keyframe.easing — real checks.
- Type consistency: `instanceTimelineEnd(obj: SceneObject, byId: Map<string, Asset>): number`;
  `symbolEffectiveDuration(asset: SymbolAsset)` unchanged signature, new home.
