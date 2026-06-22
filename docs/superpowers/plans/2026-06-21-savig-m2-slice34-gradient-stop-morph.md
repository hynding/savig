# Slice 34 — Gradient stop-count morphing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `interpolateGradient` morphs same-type gradients with DIFFERENT stop counts (instead of STEPS-hold) by reconciling both stop lists to the union of offsets, then lerping.

**Architecture:** Add pure `stopAt(stops, offset)` + `reconcileStops(a, b)` to `engine/gradientAnim.ts`; change the `interpolateGradient` guard so only a TYPE mismatch STEPS-holds; reconcile when counts differ. Regenerate the runtime bundle.

**Tech Stack:** Pure TS (`src/engine/`), Vitest, Playwright. Runtime via `pnpm build:runtime`.

## Global Constraints

- `interpolateGradient` is in the runtime → `pnpm build:runtime` + commit `src/runtime/runtimeSource.generated.ts`.
- Same-type + same-count behavior MUST be byte-identical (existing index-lerp untouched).
- Type mismatch still STEPS-holds.
- Full gate before merge: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`.
- Commit footer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: `stopAt` + `reconcileStops` + interpolateGradient guard

**Files:**
- Modify: `src/engine/gradientAnim.ts`
- Test: `src/engine/gradientAnim.test.ts`

**Interfaces:**
- Consumes: `GradientStop`, `interpolateColor`, the existing `lerp`/`lerpStops`.
- Produces: `stopAt(stops: GradientStop[], offset: number): GradientStop` (exported for unit test); internal `reconcileStops`.

- [ ] **Step 1: Write the failing tests** — append to `gradientAnim.test.ts` (import `stopAt` + existing helpers):

```ts
import { stopAt } from './gradientAnim'; // add to imports

const lin = (stops: { offset: number; color: string }[]) => ({ type: 'linear' as const, x1: 0, y1: 0, x2: 1, y2: 0, stops });

describe('stopAt', () => {
  const stops = [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }];
  it('samples a color between two stops', () => {
    expect(stopAt(stops, 0.25).color).toBe('#404040');
    expect(stopAt(stops, 0.25).offset).toBe(0.25);
  });
  it('clamps before the first / after the last stop', () => {
    expect(stopAt(stops, -0.5).color).toBe('#000000');
    expect(stopAt(stops, 2).color).toBe('#ffffff');
  });
});

describe('interpolateGradient stop-count morphing', () => {
  const a = lin([{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }]);
  const b = lin([{ offset: 0, color: '#ff0000' }, { offset: 0.5, color: '#00ff00' }, { offset: 1, color: '#0000ff' }]);

  it('t=0 reconciles a to the union offsets with a colinear middle stop (renders as a)', () => {
    const g = interpolateGradient(a, b, 0);
    expect(g.stops).toHaveLength(3);
    expect(g.stops.map((s) => s.offset)).toEqual([0, 0.5, 1]);
    expect(g.stops[0].color).toBe('#000000');
    expect(g.stops[1].color).toBe('#808080'); // colinear black->white midpoint
    expect(g.stops[2].color).toBe('#ffffff');
  });
  it('t=1 equals the 3-stop gradient', () => {
    const g = interpolateGradient(a, b, 1);
    expect(g.stops.map((s) => s.color)).toEqual(['#ff0000', '#00ff00', '#0000ff']);
  });
  it('t=0.5 blends both gradients at the union offsets (3 stops)', () => {
    const g = interpolateGradient(a, b, 0.5);
    expect(g.stops).toHaveLength(3);
    expect(g.stops[0].color).toBe('#800000'); // (#000000 + #ff0000)/2
    expect(g.stops[2].color).toBe('#8080ff'); // (#ffffff + #0000ff)/2
  });
  it('morphs radial gradients across stop count too', () => {
    const ra = { type: 'radial' as const, cx: 0.5, cy: 0.5, r: 0.5, stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }] };
    const rb = { type: 'radial' as const, cx: 0.5, cy: 0.5, r: 0.5, stops: [{ offset: 0, color: '#ff0000' }, { offset: 0.5, color: '#00ff00' }, { offset: 1, color: '#0000ff' }] };
    expect(interpolateGradient(ra, rb, 0.5).stops).toHaveLength(3);
  });
  it('STILL steps-holds across a TYPE mismatch (linear vs radial)', () => {
    const r = { type: 'radial' as const, cx: 0.5, cy: 0.5, r: 0.5, stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }] };
    expect(interpolateGradient(a, r, 0.4)).toBe(a); // hold a
    expect(interpolateGradient(a, r, 1)).toBe(r); // hold b at the end
  });
});
```

(Keep the existing same-count interpolation tests — they are the regression guard.)

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/engine/gradientAnim.test.ts`
Expected: the new stop-count tests FAIL (currently STEPS-holds → length 2 at t=0, snaps at t=0.5); `stopAt` undefined.

- [ ] **Step 3: Implement** — in `gradientAnim.ts`:

```ts
const STOP_EPS = 1e-6;

// Piecewise-linear sample of a (sorted-defensively) stop list at `offset`, clamped to
// the first/last stop outside the range. Returns a canonical GradientStop.
export function stopAt(stops: GradientStop[], offset: number): GradientStop {
  const sorted = [...stops].sort((p, q) => p.offset - q.offset);
  if (offset <= sorted[0].offset) return { ...sorted[0], offset };
  const last = sorted[sorted.length - 1];
  if (offset >= last.offset) return { ...last, offset };
  let lo = sorted[0];
  let hi = last;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (offset >= sorted[i].offset && offset <= sorted[i + 1].offset) {
      lo = sorted[i];
      hi = sorted[i + 1];
      break;
    }
  }
  const span = hi.offset - lo.offset;
  const local = span < STOP_EPS ? 0 : (offset - lo.offset) / span;
  const stop: GradientStop = { offset, color: interpolateColor(lo.color, hi.color, local) };
  const olo = lo.opacity ?? 1;
  const ohi = hi.opacity ?? 1;
  if (olo !== 1 || ohi !== 1) {
    const o = lerp(olo, ohi, local);
    if (o < 1) stop.opacity = o; // canonical: omit when fully opaque
  }
  return stop;
}

// Resample both stop lists at the sorted-unique union of their offsets so they share
// offsets and length (then lerpStops applies). Inserted stops are colinear -> seamless.
function reconcileStops(a: GradientStop[], b: GradientStop[]): { an: GradientStop[]; bn: GradientStop[] } {
  const offsets: number[] = [];
  for (const o of [...a, ...b].map((s) => s.offset).sort((p, q) => p - q)) {
    if (offsets.length === 0 || o - offsets[offsets.length - 1] > STOP_EPS) offsets.push(o);
  }
  return { an: offsets.map((o) => stopAt(a, o)), bn: offsets.map((o) => stopAt(b, o)) };
}
```

Then change `interpolateGradient`'s guard + stop handling:

```ts
export function interpolateGradient(a: Gradient, b: Gradient, t: number): Gradient {
  if (a.type !== b.type) return t >= 1 ? b : a; // cross-type morph is ambiguous -> hold
  const { an, bn } = a.stops.length === b.stops.length ? { an: a.stops, bn: b.stops } : reconcileStops(a.stops, b.stops);
  const stops = lerpStops(an, bn, t);
  // ... existing linear / radial geometry-lerp blocks, unchanged, using `stops` ...
}
```

(The `lerpStops(an, bn, t)` call replaces the old `lerpStops(a.stops, b.stops, t)`; geometry blocks unchanged. Remove the now-dead `t >= 1 ? b : a` fallthrough only if unreachable — keep the final `return t >= 1 ? b : a` as the type-equal-but-unhandled guard.)

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/engine/gradientAnim.test.ts`
Expected: PASS (incl. the pre-existing same-count + sampleGradient tests).

- [ ] **Step 5: Regenerate the runtime bundle**

Run: `pnpm build:runtime`
Then: `pnpm vitest run` (full — confirm runtime parity + nothing drifted).
Expected: PASS. `runtimeSource.generated.ts` changes (inlines the new fns).

- [ ] **Step 6: Commit**

```bash
git add src/engine/gradientAnim.ts src/engine/gradientAnim.test.ts src/runtime/runtimeSource.generated.ts
git commit -m "feat(slice34): morph gradients across stop count (union-offset reconcile)"
```

---

### Task 2: e2e + full gate

**Files:**
- Test: `e2e/gradient-stop-morph.spec.ts` (create)

- [ ] **Step 1: Write the e2e** — model on the existing animated-gradient e2e (find it under `e2e/` — gradient/animated-gradient spec). Steps: draw a rect; set fill = linear gradient; at t=0 it has 2 stops (default), keyframed (autoKey on); move the playhead; add a 3rd stop via the Inspector stop editor; that re-keys the gradient; export; open the bundle; assert the exported runtime's `<stop>` elements animate across a mid-time — specifically the gradient has 3 `<stop>`s mid-morph and the stop colors change over time (not a 2→3 snap). If precisely asserting "3 stops mid-frame" is brittle, assert that a `<stop stop-color>` value changes between two sampled times AND the def has 3 stops after the morph start.

```ts
// import { test, expect } from '@playwright/test'; unzip the bundle as in e2e/animated-gradient*.
// ... draw rect, fill=linear, add a 3rd stop at a later keyframe, export ...
// open bundle, read the <linearGradient> <stop> elements at two times, assert they animate
// and that 3 stops are present mid-morph (count interpolation no longer snaps).
```

(Pin selectors/flow to the existing gradient e2e + Inspector stop-add control.)

- [ ] **Step 2: Run the e2e**

Run: `pnpm exec playwright test e2e/gradient-stop-morph.spec.ts`
Expected: PASS.

- [ ] **Step 3: Full gate + commit**

```bash
pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test
git add e2e/gradient-stop-morph.spec.ts
git commit -m "test(slice34): e2e - a 2->3 stop gradient keyframe pair morphs in the export"
```

---

## Self-Review (post-write)

- **Spec coverage:** §3 reconcile → Task 1 (stopAt + reconcileStops + guard); §5 tests → Task 1 Step 1 + Task 2 e2e; bundle → Task 1 Step 5.
- **Type consistency:** `stopAt(stops, offset): GradientStop`; `reconcileStops` internal; guard change keeps the linear/radial blocks' signatures.
- **No placeholders:** Task 1 has full code + hand-verified vectors (stopAt 0.25 → #404040; 2→3 t=0 middle #808080; t=0.5 ends #800000/#8080ff; type-mismatch holds). Task 2 e2e flow pinned to the existing gradient e2e by the executor.
- **Regression:** same-count path explicitly preserved (`an=a.stops, bn=b.stops`); type-mismatch hold preserved; existing tests kept.
