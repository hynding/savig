# Savig M4 Slice 45d — Animatable group transform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Steps use `- [ ]` tracking. Spec: `specs/2026-06-22-savig-m4-slice45d-animatable-group-design.md`.

**Goal:** Let a group's transform be keyframed (auto-key on) so a whole group animates as a unit; everything downstream already composes the group transform per frame (45a), so this is a one-function change.

**Architecture:** `applyObjectTransform(obj, partial, time, autoKey)` keyframes a group when auto-key is on (base only when off). The shared `computeFrame`/`groupTransformPrefix(time)` (editor + export runtime) already animate the children; the Timeline + auto-duration already count group tracks. preview==export holds by construction.

**Tech Stack:** React 18 + TS strict, Zustand, Vitest + RTL, Playwright.

## Global Constraints

- TS strict; no new deps. ONLY `applyObjectTransform` + its 3 call sites change.
- preview==export: unchanged — the editor and export runtime call the same `computeFrame` at a given `time`; an animated group composes identically in both.
- 45b backward-compat: a group with auto-key OFF still writes base (static positioning).
- Commit footer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Full gate before merge: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`.

---

### Task 1: `applyObjectTransform` keyframes a group when auto-key is on

**Files:** `src/ui/store/store.ts`. Test: `src/ui/store/store.test.ts`.

- [ ] **Step 1: Failing store tests** (extend the slice-45b group-container describe block):
  - auto-key ON: `useEditor.getState().setObjectsTransforms([{ id: gid, x: 10 }])` upserts a keyframe on the group's x track (`obj(gid).tracks.x` length 1; `obj(gid).base.x` unchanged at 0).
  - two keyframes animate: at time 0 set x=0 keyframe (or rely on base), advance `setTime(1)`, `setObjectsTransforms([{ id: gid, x: 100 }])` → two x keyframes; `sampleObject(group, 0.5)` interpolates (≈ between).
  - auto-key OFF: `toggleAutoKey()` then `setObjectsTransforms([{ id: gid, x: 9 }])` writes `base.x = 9`, `tracks.x` empty (45b preserved).
  (Use the existing `groupId()`/`obj()` helpers + the store's time setter — grep `setTime`/`seek`/`setPlayhead` for the real name.)
- [ ] **Step 2: Run** `pnpm vitest run src/ui/store/store.test.ts` → FAIL (group always base today).
- [ ] **Step 3: Implement.** Change `applyObjectTransform`:
```ts
function applyObjectTransform(
  obj: SceneObject,
  partial: Partial<Record<AnimatableProperty, number>>,
  time: number,
  autoKey: boolean,
): SceneObject {
  // A group with auto-key OFF positions statically (writes base, 45b); otherwise keyframe
  // at the playhead — an animatable group (45d). Normal objects are already gated on
  // auto-key by the caller, so they always keyframe here.
  if (obj.isGroup && !autoKey) return { ...obj, base: { ...obj.base, ...partial } };
  const tracks = { ...obj.tracks };
  for (const [p, v] of Object.entries(partial) as [AnimatableProperty, number][]) {
    tracks[p] = upsertKeyframe(obj.tracks[p] ?? [], createKeyframe(time, v));
  }
  return { ...obj, tracks };
}
```
Pass `s.autoKey` at the three call sites: `applyObjectTransform(obj, updates, time, s.autoKey)` (setProperties), `applyObjectTransform(obj, partial, time, s.autoKey)` (nudgeSelected + setObjectsTransforms). Update the now-stale "writes its static base" comments to note "keyframes when auto-key is on (45d)".
- [ ] **Step 4: Run** the store suite → PASS. Confirm the 45b group tests (move/scale/rotate, which run with auto-key on by default in those tests) still pass — they'll now write keyframes instead of base; if any 45b test asserts `base.x`/`base.scaleX` on a group AND runs with auto-key ON, update it to assert the keyframed value via `sampleObject(group, time)` (the visual result is identical). List + fix those.
- [ ] **Step 5: Commit** `feat(slice45d): keyframe a group's transform when auto-key is on`.

---

### Task 2: Frame + duration tests (animated group already composes)

**Files:** Tests `src/runtime/frame.test.ts`, `src/engine/duration.test.ts`.

- [ ] **Step 1:** `frame.test.ts` — a group with `tracks.x = [kf(0,0), kf(1,100)]` + a child: `computeFrame(project, 0)` child transform starts with `translate(0, 0)`; `computeFrame(project, 1)` child transform starts with `translate(100, 0)` (the group prefix animated). Asserts the composition is time-correct (the same code drives editor + export).
- [ ] **Step 2:** `duration.test.ts` — a group with a keyframe at t=2 makes `computeProjectDuration` ≥ 2.
- [ ] **Step 3: Run** both + the existing computeFrame parity test → PASS.
- [ ] **Step 4: Commit** `test(slice45d): animated group composes per frame + extends duration`.

---

### Task 3: e2e + full gate

**Files:** `e2e/animated-group.spec.ts`.

- [ ] **Step 1:** Write `e2e/animated-group.spec.ts`: draw 2 rects; group them (auto-key is on by default — verify via the AutoKey control if needed); with the group selected, drag it at the playhead start; move the playhead forward (scrub the timeline ruler or set time); drag the group again → the Timeline shows ≥2 keyframe diamonds on the group row (`keyframe-<gid>-x-*`); scrub the playhead between the two times and assert the two child objects' `boundingBox()` are at an intermediate position (the group animates both). Model the draw/group/scrub on `e2e/grouping.spec.ts` + an existing timeline-scrub spec.
- [ ] **Step 2:** Run `pnpm exec playwright test e2e/animated-group.spec.ts` → PASS. (If timeline-scrub interaction is finicky, fall back to asserting the keyframes exist + that `sampleObject`-equivalent positions differ across times via the rendered transforms.)
- [ ] **Step 3: Full gate** — `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test` → all green.
- [ ] **Step 4: Commit** `test(slice45d): e2e — animate a group as a unit across keyframes`.

---

## Self-Review (post-write)

- **Spec coverage:** keyframe-a-group (T1) ✓; composition/duration already-correct, locked by tests (T2) ✓; e2e (T3) ✓.
- **Type consistency:** `applyObjectTransform(obj, partial, time, autoKey)` — the new `autoKey` arg threaded to all three call sites.
- **45b regression watch (T1 step 4):** the explicit risk is 45b group tests that assert a group's `base` after a handle/move drag with auto-key ON — those now keyframe; re-assert via `sampleObject`. Listed as a step, not a surprise.
- **Deferred (spec §4):** lossy ungroup of an animated group (bakes t=0); per-group-keyframe easing UI; Timeline nesting.
- **No new parity surface:** composition unchanged; the animated-group frame test (T2) + the existing parity test guard it.
