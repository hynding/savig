# Keyframed Symbol Time-Remap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a symbol instance's internal clock be keyframed directly (After-Effects "Time Remapping") so it can speed up, slow down, freeze, or reverse over the parent timeline.

**Architecture:** A new optional `SceneObject.symbolTimeTrack?: Keyframe[]` (time = parent-local seconds, value = internal seconds) drives the instance's internal sample time via the existing `interpolate()` at the single `flattenInstances` `childTime` seam — superseding the constant `symbolTime` remap when present. Integral-free pure lookup → preview==export exact. Reuses the existing scalar `Keyframe`/easing/Timeline-diamond machinery and the active-scene routing seam.

**Tech Stack:** TypeScript (strict), React 18, Zustand, Vitest (unit/RTL), Playwright (e2e), Vite, pnpm.

## Global Constraints

- TypeScript strict; no `any`. Pure engine helpers stay free of React/store imports.
- **Preview == export parity is sacred.** The only render-path change is the single `flattenInstances` `childTime` seam (consumed by both `computeFrame` and `renderSvgDocument`). `symbolTimeTrack` absent ⇒ byte-identical to today; the 47a parity test must stay green untouched.
- Active-scene routing: store actions on a selected object resolve via `selectActiveObjects(s)` and write via `replaceObjectInScene(project, selectActiveAssetId(s), next)` (works at root AND inside a symbol in edit mode).
- Precedence: a non-empty `symbolTimeTrack` supersedes `symbolTime` (startOffset/speed/phase/loop/pingPong/playCount) for both render and duration.
- Verify each slice with `pnpm typecheck`, `pnpm exec eslint src e2e`, `pnpm test`, and targeted `pnpm e2e <spec>` (run `pkill -f vite` before a definitive e2e). Record counts.
- Each slice = its own branch off `main`, code-reviewer loop until 0 Critical / 0 Important, then `--no-ff` merge; record the hash; update INDEX.md.
- Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## File map

- `src/engine/types.ts` — add `symbolTimeTrack?: Keyframe[]` to `SceneObject`.
- `src/engine/symbol.ts` — the `childTime` seam in `flattenInstances` (import `interpolate`).
- `src/engine/duration.ts` — `instanceTimelineEnd` remap-track branch.
- `src/ui/store/store.ts` — `toggleSymbolTimeRemap`, `setSymbolTimeRemap`; (slice 2) `selectedRemapKeyframe`/`selectRemapKeyframe`/`removeSelectedRemapKeyframe` + `remap` branches in shared keyframe ops.
- `src/ui/components/Inspector/Inspector.tsx` — enable-toggle + internal-time field (+ supersede note).
- `src/ui/components/Timeline/Timeline.tsx` + `Timeline.module.css` — (slice 2) remap diamond row.
- Tests: `src/engine/symbol.test.ts`, `src/engine/duration.test.ts`, `src/ui/store/store.test.ts`, `src/ui/components/Inspector/Inspector.test.tsx`, `e2e/symbols.spec.ts`.

---

## SLICE 1 — Core remap (engine + store + Inspector field)

End state: enable time-remap on an instance, keyframe its internal time via the Inspector field at the playhead, and see speed/freeze/reverse in both preview and export.

### Task 1.1: `symbolTimeTrack` field + engine seam

**Files:**
- Modify: `src/engine/types.ts` (SceneObject)
- Modify: `src/engine/symbol.ts` (import `interpolate`; `childTime` seam ~line 123)
- Test: `src/engine/symbol.test.ts`

**Interfaces:**
- Produces: `SceneObject.symbolTimeTrack?: Keyframe[]`; render seam consuming it.

- [ ] **Step 1: Write failing tests** in `src/engine/symbol.test.ts` (a new `describe('symbolTimeTrack (keyframed remap)')`). Build a symbol asset with one internal object animated x 0→100 over t∈[0,2] (so the internal frame is observable), an instance referencing it, set `symbolTimeTrack`, flatten at several parent times, and assert the internal leaf samples at the remapped time. Use the existing helpers in this test file (it already constructs symbol assets + instances for the 47c remap tests — mirror them). Cases:
  - identity track `[{0→0},{2→2}]` ⇒ leaf at parent t samples internal t (same as no remap).
  - **half-speed** `[{0→0},{4→2}]` ⇒ at parent t=2, internal=1.
  - **freeze** `[{0→1},{2→1}]` ⇒ at parent t=0.5 and t=1.5, internal=1 (flat segment).
  - **reverse** `[{0→2},{2→0}]` ⇒ at parent t=0.5, internal=1.5.
  - **clamp** parent t before first / after last keyframe holds endpoint values.
  - **precedence** when both `symbolTimeTrack` (non-empty) and `symbolTime` are set, the track wins.
  - **parity** absent `symbolTimeTrack` ⇒ identical leaves to today (assert against a no-track instance).

  Assert by reading the flattened internal leaf's sampled value (e.g. `sampleObject(leaf.object, leaf.localTime).x`) — `flattenInstances` returns `localTime` per leaf, so assert `leaf.localTime` directly where simplest.

- [ ] **Step 2: Run to verify failure** — `pnpm test -- src/engine/symbol.test.ts` → FAIL (`symbolTimeTrack` unused / wrong sampling).

- [ ] **Step 3: Implement.** In `types.ts`, add to `SceneObject` (after `symbolTime?`):

```ts
  /** Per-instance TIME-REMAP track (47c keyframed). When present & non-empty it DRIVES the
   *  instance's internal clock: at parent time t the internal sample time = interpolate(track, t).
   *  `time` = parent-local seconds; `value` = internal-clock seconds. SUPERSEDES the constant
   *  symbolTime remap when non-empty. Absent/empty = unchanged (parity). */
  symbolTimeTrack?: Keyframe[];
```

In `symbol.ts`, add `interpolate` to the engine imports, and replace the `childTime` selection:

```ts
        const childTime =
          o.symbolTimeTrack && o.symbolTimeTrack.length > 0
            ? Math.max(0, interpolate(o.symbolTimeTrack, localTime)) // direct remap (47c keyframed)
            : o.symbolTime
              ? remapLocalTime(localTime, o.symbolTime, symbolEffectiveDuration(asset))
              : localTime;
```

- [ ] **Step 4: Run to verify pass** — `pnpm test -- src/engine/symbol.test.ts` → PASS. Also `pnpm test -- src/engine` to confirm the 47a parity test still passes.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(engine): symbolTimeTrack keyframed time-remap seam"`

### Task 1.2: `instanceTimelineEnd` remap-track awareness

**Files:**
- Modify: `src/engine/duration.ts` (`instanceTimelineEnd` ~line 36)
- Test: `src/engine/duration.test.ts`

**Interfaces:**
- Consumes: `symbolTimeTrack` (1.1). Produces: extended `instanceTimelineEnd`.

- [ ] **Step 1: Write failing test** in `duration.test.ts`: an instance with `symbolTimeTrack` whose last keyframe `time` is 5 ⇒ `computeProjectDuration` (auto mode) for an otherwise-static root ≥ 5. Mirror the existing `instanceTimelineEnd` tests in this file.

- [ ] **Step 2: Run to verify failure** — `pnpm test -- src/engine/duration.test.ts` → FAIL (returns the constant-remap extent / 0).

- [ ] **Step 3: Implement.** At the top of `instanceTimelineEnd`, before the constant-remap math:

```ts
  if (obj.symbolTimeTrack && obj.symbolTimeTrack.length > 0) {
    return obj.symbolTimeTrack[obj.symbolTimeTrack.length - 1].time; // authored curve's parent-timeline end
  }
```

(Tracks are maintained sorted ascending, so the last element's `time` is the max.)

- [ ] **Step 4: Run to verify pass** — `pnpm test -- src/engine/duration.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git commit -am "feat(engine): instanceTimelineEnd covers symbolTimeTrack extent"`

### Task 1.3: `toggleSymbolTimeRemap` + `setSymbolTimeRemap` store actions

**Files:**
- Modify: `src/ui/store/store.ts` (interface near `setSymbolTiming`; impl near `setSymbolTiming`)
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Consumes: `selectActiveObjects`, `selectActiveAssetId`, `replaceObjectInScene`, `snapToFrame`, `symbolEffectiveDuration`, `interpolate`.
- Produces: `toggleSymbolTimeRemap(): void`, `setSymbolTimeRemap(value: number): void`.

- [ ] **Step 1: Write failing tests** in `store.test.ts` (new `describe`). Build an instance (reuse the symbol-construction helper the 47c store tests use), then:
  - `toggleSymbolTimeRemap()` on an instance whose symbol has intrinsic duration D>0 ⇒ `symbolTimeTrack` seeded `[{time:0,value:0},{time:D,value:D}]`; calling it again clears `symbolTimeTrack`. One undo step each.
  - `setSymbolTimeRemap(3)` at playhead t=1 (snapped) ⇒ a keyframe `{time:1,value:3}` upserted, sorted; calling at t=1 again with value 4 replaces it (no duplicate). Use fresh `useEditor.getState()` per read.

- [ ] **Step 2: Run to verify failure** — FAIL (`toggleSymbolTimeRemap is not a function`).

- [ ] **Step 3: Implement.** Interface (near `setSymbolTiming`):

```ts
  toggleSymbolTimeRemap(): void;
  setSymbolTimeRemap(value: number): void;
```

Impl (near `setSymbolTiming`; reuse its resolve pattern):

```ts
  toggleSymbolTimeRemap() {
    const s = get();
    const objects = selectActiveObjects(s);
    const obj = objects.find((o) => o.id === s.selectedObjectId);
    if (!obj) return;
    let next: SceneObject;
    if (obj.symbolTimeTrack && obj.symbolTimeTrack.length > 0) {
      next = { ...obj }; delete (next as { symbolTimeTrack?: Keyframe[] }).symbolTimeTrack; // disable
    } else {
      const asset = s.history.present.assets.find((a) => a.id === obj.assetId);
      const d = asset && asset.kind === 'symbol' ? symbolEffectiveDuration(asset) : 0;
      const track: Keyframe[] = d > 0
        ? [{ time: 0, value: 0, easing: 'linear' }, { time: d, value: d, easing: 'linear' }]
        : [{ time: 0, value: 0, easing: 'linear' }];
      next = { ...obj, symbolTimeTrack: track };
    }
    get().commit(replaceObjectInScene(s.history.present, selectActiveAssetId(s), next));
  },
  setSymbolTimeRemap(value) {
    const s = get();
    const objects = selectActiveObjects(s);
    const obj = objects.find((o) => o.id === s.selectedObjectId);
    if (!obj) return;
    const t = snapToFrame(s.time, s.history.present.meta.fps);
    const track = (obj.symbolTimeTrack ?? []).filter((k) => Math.abs(k.time - t) > 1e-9);
    track.push({ time: t, value, easing: 'linear' });
    track.sort((a, b) => a.time - b.time);
    get().commit(replaceObjectInScene(s.history.present, selectActiveAssetId(s), { ...obj, symbolTimeTrack: track }));
  },
```

> CONFIRMED against store.ts:757/767 — the single-object active-scene write pattern is `get().commit(replaceObjectInScene(project, selectActiveAssetId(s), next))` (`commit` takes a `Project`; `replaceObjectInScene` returns one). `commitActiveScene(nextObjects[])` is the whole-array dual, used elsewhere.

- [ ] **Step 4: Run to verify pass** — `pnpm test -- src/ui/store/store.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git commit -am "feat(store): toggleSymbolTimeRemap + setSymbolTimeRemap"`

### Task 1.4: Inspector enable-toggle + internal-time field

**Files:**
- Modify: `src/ui/components/Inspector/Inspector.tsx` (Symbol-timing panel)
- Test: `src/ui/components/Inspector/Inspector.test.tsx`

**Interfaces:**
- Consumes: `toggleSymbolTimeRemap`, `setSymbolTimeRemap`, `interpolate`.

- [ ] **Step 1: Write failing RTL test** in `Inspector.test.tsx`: select an instance; the Symbol-timing panel shows an "Enable time remap" checkbox; clicking it seeds `symbolTimeTrack` (assert on store state). With it enabled, an "internal time" field is present; editing it upserts a keyframe (assert track length grows / value at playhead). Mirror the existing symbol-timing RTL tests (phase/play-count) for instance setup.

- [ ] **Step 2: Run to verify failure** — FAIL (checkbox/field absent).

- [ ] **Step 3: Implement** in the Symbol-timing panel: a checkbox `aria-label="Enable time remap"` (`data-testid="symbol-timeremap"`) bound to `!!obj.symbolTimeTrack?.length`, onChange → `toggleSymbolTimeRemap()`. When enabled, a `NumberField label="internal time"` whose `value = obj.symbolTimeTrack?.length ? interpolate(obj.symbolTimeTrack, snappedPlayhead) : 0` and `onCommit={(n) => setSymbolTimeRemap(n)}`. While `obj.symbolTimeTrack?.length` is truthy, render the existing constant timing controls (start offset/speed/loop/ping-pong/play count/phase) `disabled` with `title="Overridden by time remap"`.

- [ ] **Step 4: Run to verify pass** — `pnpm test -- Inspector`.

- [ ] **Step 5: Commit** — `git commit -am "feat(inspector): time-remap enable toggle + internal-time field"`

### Task 1.5: Slice-1 verify + review loop + merge

- [ ] `pnpm typecheck && pnpm exec eslint src e2e && pnpm test` green; record counts.
- [ ] `feature-dev:code-reviewer` on the branch diff (focus: parity untouched [absent ⇒ byte-identical, 47a test green]; the seam guard + `Math.max(0,·)`; precedence; active-scene routing of both actions; the seed edge case D≤0; duration extent). Re-review until 0 Crit / 0 Important.
- [ ] `--no-ff` merge to main; record hash + counts; update INDEX.md.

---

## SLICE 2 — Timeline manipulation (diamonds + shared keyframe ops)

End state: remap keyframes appear as a diamond row on the instance's Timeline track, draggable to retime, with copy/paste/easing/remove — all active-scene-routed.

### Task 2.1: `selectedRemapKeyframe` state + select/remove actions

**Files:**
- Modify: `src/ui/store/store.ts`
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Produces: `selectedRemapKeyframe: { objectId: string; time: number } | null`, `selectRemapKeyframe(ref): void`, `removeSelectedRemapKeyframe(): void`.

- [ ] **Step 1: Write failing test**: with a remap track of 3 keyframes, `selectRemapKeyframe({objectId, time})` then `removeSelectedRemapKeyframe()` ⇒ track drops that keyframe (active-scene), one undo step; selection cleared.
- [ ] **Step 2: Run to verify failure** — FAIL.
- [ ] **Step 3: Implement** mirroring `selectedDashKeyframe`/`removeSelectedDashKeyframe` exactly (a `RemapKeyframeRef = { objectId: string; time: number }` type, the state field + initial `null`, the selector clears in the clear-stale-selection list, the remove resolves `selectActiveObjects` + writes `replaceObjectInScene`).
- [ ] **Step 4: Run to verify pass** — PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(store): selectedRemapKeyframe + remove"`

### Task 2.2: `remap` branch in the shared keyframe ops (retime/copy/paste/easing)

**Files:**
- Modify: `src/ui/store/store.ts` (`retimeSelectedKeyframe`, `copyKeyframe`, `pasteKeyframe`, `setSelectedKeyframeEasing`)
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Consumes: `selectedRemapKeyframe`. Extends the four shared fns with a `remap` branch resolving `selectActiveObjects` + writing `replaceObjectInScene`, byte-identical at root.

- [ ] **Step 1: Write failing tests**: for a selected remap keyframe — `retimeSelectedKeyframe(newT)` moves it (re-sorted); `copyKeyframe()`+`pasteKeyframe()` duplicates it at the playhead; `setSelectedKeyframeEasing('easeIn')` sets its easing. Each active-scene, one undo step.
- [ ] **Step 2: Run to verify failure** — FAIL (ops no-op for the remap selection).
- [ ] **Step 3: Implement** the `remap` branch in each of the four fns, mirroring the existing `dash` branch (each resolves the object in the active scene, edits `symbolTimeTrack`, writes via `replaceObjectInScene`). Keep the root path byte-identical.
- [ ] **Step 4: Run to verify pass** — PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(store): route retime/copy/paste/easing for remap keyframes"`

### Task 2.3: Timeline remap diamond row + e2e

**Files:**
- Modify: `src/ui/components/Timeline/Timeline.tsx`, `src/ui/components/Timeline/Timeline.module.css`
- Test: `e2e/symbols.spec.ts`

**Interfaces:**
- Consumes: `selectedRemapKeyframe`, `selectRemapKeyframe`, the shared `startKeyframeDrag`→`retimeSelectedKeyframe`.

- [ ] **Step 1: Write failing e2e** in `e2e/symbols.spec.ts` (Stage-scoped selectors per the `293ccf5` convention): create a symbol + instance, select the instance, enable time remap in the Inspector, then assert a `remap-keyframe-{id}-{time}` diamond appears on the Timeline and dragging it to a new x changes its `time` (a diamond at the new time appears). `pkill -f vite` first.
- [ ] **Step 2: Run to verify failure** — `pnpm e2e symbols` → FAIL (no remap diamonds).
- [ ] **Step 3: Implement** in `Timeline.tsx`: inside the per-row `lane`, after the progress diamonds, map `(obj.symbolTimeTrack ?? [])` to diamonds (`data-testid="remap-keyframe-{obj.id}-{kf.time}"`, `styles.remapDiamond`), `onPointerDown` gated by `if (locked) return;` → `selectRemapKeyframe({ objectId: obj.id, time: kf.time })` + `startKeyframeDrag(e, kf.time)` — mirroring the dash/progress diamond blocks. Add a `.remapDiamond` color in the CSS module.
- [ ] **Step 4: Run to verify pass** — `pnpm e2e symbols`.
- [ ] **Step 5: Commit** — `git commit -am "feat(timeline): symbol time-remap keyframe diamonds"`

### Task 2.4: Slice-2 verify + review loop + merge

- [ ] `pnpm typecheck && pnpm exec eslint src e2e && pnpm test && pnpm e2e symbols` green; record counts.
- [ ] `feature-dev:code-reviewer` (focus: every `remap` branch reads+writes the SAME active scene [no half-route], root byte-identical, lock-cascade gate on the diamonds, clear-stale-selection includes the remap ref, parity). Re-review until 0 Crit / 0 Important.
- [ ] `--no-ff` merge; record hash + counts; update INDEX.md (move both slices into the merged table, prune the 47c keyframed-symbolTime item from the backlog/priorities).

---

## Self-Review

**Spec coverage:** model + `symbolTimeTrack` (1.1) ✓; engine seam (1.1) ✓; duration awareness (1.2) ✓; store toggle/set (1.3) ✓; Inspector toggle+field+supersede note (1.4) ✓; full keyframe-op surface — select/remove (2.1), retime/copy/paste/easing (2.2) ✓; Timeline diamonds (2.3) ✓; edge cases (seed D≤0, empty guard, negative clamp, reverse/freeze, coexisting symbolTime) covered in 1.1/1.3 tests ✓; parity (1.1 Step 4) ✓.

**Placeholder scan:** The store-test bodies (1.3, 2.1, 2.2) and the RTL test (1.4) are described against the existing test-file construction style rather than fully literal because that helper isn't quoted here — the implementer matches the file's existing symbol/keyframe-test helpers; the ASSERTIONS are concrete (seeded keyframe values, upsert-replace, track length, sampled internal time). Acceptable: test-design directives with concrete pass criteria. Two `> NOTE` callouts verify a real signature (`replaceObjectInScene` return shape) against existing call sites before relying on it.

**Type consistency:** `symbolTimeTrack?: Keyframe[]` used identically across 1.1–2.3. `toggleSymbolTimeRemap()`/`setSymbolTimeRemap(value)` consistent 1.3↔1.4. `selectedRemapKeyframe: { objectId; time }` / `selectRemapKeyframe` / `removeSelectedRemapKeyframe` consistent 2.1↔2.2↔2.3. `interpolate(track, time)`, `symbolEffectiveDuration`, `replaceObjectInScene`, `commitActiveScene` all match existing engine/store exports.
