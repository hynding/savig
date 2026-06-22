# Savig M2 Slice 34 — Gradient stop-count morphing

**Date:** 2026-06-21
**Status:** Approved (autonomous slice cycle — true-M2-polish program 4/5)
**Depends on:** Slice 8 (gradients), Slice 9 (animated gradients — `interpolateGradient`/`sampleGradient`)

## 1. Goal

Smoothly **morph between gradient keyframes that have different stop counts** (same
type), instead of the current STEPS-hold (snap). Keyframing a 2-stop fill then a
3-stop fill currently snaps at the boundary; this makes it animate.

## 2. Scope (YAGNI)

**In:** same-type, different-stop-count morphing for BOTH linear and radial gradients
— reconcile the two stop lists to a common offset set, then lerp (geometry + per-stop
color/offset/opacity as today).

**Out (deferred, tracked):** cross-TYPE morphing (linear↔radial — geometrically
ambiguous; STEPS-hold remains); same-count-but-different-offsets re-normalization
(today's index-lerp is kept unchanged for same count); reordering/de-dup of stops.

## 3. The reconciliation

When `a.type === b.type` but `a.stops.length !== b.stops.length`:

1. `offsets = sorted unique union of (a.stops.offsets ∪ b.stops.offsets)`.
2. Resample each gradient's stops AT those offsets: `stopAt(stops, o)` returns the
   piecewise-linear color (via `interpolateColor`) + opacity (lerp) at offset `o`,
   clamped to the first/last stop outside the range. (Stops are sorted defensively.)
3. Both gradients now have identical offsets and equal length → feed the existing
   `lerpStops` + geometry lerp.

**Why it's seamless:** an inserted stop sits on the line between its neighbors, so at
`t=0` the reconciled `a` renders identically to the original `a` (and likewise `b` at
`t=1`); the in-between is a smooth blend. Endpoints are visually unchanged.

Same type + same count keeps the existing index-lerp untouched (byte-identical). Type
mismatch still STEPS-holds.

## 4. Implementation surface

- `src/engine/gradientAnim.ts`: add `stopAt(stops, offset)` + `reconcileStops(a, b)`;
  in `interpolateGradient`, change the guard so only a TYPE mismatch STEPS-holds, and
  when counts differ (same type) reconcile to union offsets before the geometry/stop
  lerp. `sampleGradient` unchanged.
- Runtime bundle: `pnpm build:runtime` regenerates `runtimeSource.generated.ts`
  (`interpolateGradient` is reachable from `applyGradientToElement`). Preview == export
  preserved (same fn both sides).

No data-model / persistence / migration change (v4). No UI change — it simply upgrades
existing different-stop-count keyframe pairs from snap to morph.

## 5. Testing

**Pure (`gradientAnim.test.ts`):**
- 2-stop → 3-stop linear, t=0 → equals (renders-as) the original 2-stop (the inserted
  middle stop is colinear: its color == the 2-stop sample at that offset).
- t=1 → equals the 3-stop gradient.
- t=0.5 → reconciled to 3 stops at the union offsets; a mid stop color is the blend of
  both gradients' samples at that offset (known-answer with simple hex colors).
- radial 2→3 stops morphs (count no longer STEPS-holds).
- type mismatch (linear vs radial) STILL STEPS-holds (regression).
- same-count same-offsets unchanged (regression — existing index-lerp test stays green).
- `stopAt` unit: samples a color between two stops; clamps before first / after last.

**Engine parity:** the existing computeFrame/gradient parity + `sampleGradient` tests
stay green; full suite + build + e2e.

**e2e (`gradient-stop-morph.spec.ts`):** draw a rect, linear fill, keyframe 2 stops at
t=0, move the playhead, add a 3rd stop + keyframe, export → the exported runtime's
`<stop>` set animates (a mid-time frame has 3 stops with interpolated colors, not a
snap from 2→3). (Model on the existing animated-gradient e2e.)

## 6. Risks

- **Offset coincidence / zero-width segment:** `stopAt` guards a zero-width bracket
  (return the lower stop) — no divide-by-zero.
- **Canonical opacity:** reuse `lerpStops`' rule (omit opacity when ==1) so reconciled
  stops stay structurally canonical and match the string emitter.
- **Numerical:** union offsets deduped with an epsilon so near-identical offsets don't
  create spurious near-zero segments.
