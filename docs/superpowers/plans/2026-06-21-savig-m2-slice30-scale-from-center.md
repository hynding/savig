# Slice 30 — Alt to scale / resize from center — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hold Alt while dragging an on-canvas handle to scale/resize symmetrically about the object's center, for both the scale handles (svg/path) and resize handles (rect/ellipse); composes with Shift (uniform).

**Architecture:** Pure editor-only handle math. Add `fromCenter?: boolean` to `ScaleInput`/`ResizeInput`, branch in each helper, thread `fromCenter: e.altKey` at the two Stage call sites. Reuses `handleMath.projectParam`. Zero engine/store/persistence/render/runtime/export/migration change.

**Tech Stack:** React 18 + TS strict, Vitest + RTL, Playwright; `src/ui/components/Stage/`.

## Global Constraints

- TS strict; `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test` all green before merge.
- `fromCenter?` is OPTIONAL and defaults falsy → all existing callers byte-identical.
- Scale-from-center: base (x,y) UNCHANGED; solve scale about the anchor. Resize-from-center: center `(w/2,h/2)` is the fixed point in the existing base-compensation formula.
- Edge handles scale/resize the single moving axis only; corners both axes.
- `MIN_SCALE` (scale) / `minSize` (resize) clamps; uniform floors the projection param `t` at `tMin` to hold aspect (S28 pattern).
- Commit footer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Scale handles — `fromCenter`

**Files:**
- Modify: `src/ui/components/Stage/scaleHandles.ts`
- Test: `src/ui/components/Stage/scaleHandles.test.ts`

**Interfaces:**
- Consumes: `projectParam` (handleMath), existing `ScaleInput`/`ScaleResult`/`MIN_SCALE`.
- Produces: `ScaleInput.fromCenter?: boolean`. When set, `applyScaleHandleDrag` scales about the anchor with base unchanged (`x=baseX, y=baseY`); `uniform` projects onto the anchor-content→corner-content line.

- [ ] **Step 1: Write the failing tests** — append to `scaleHandles.test.ts` inside `describe('applyScaleHandleDrag', ...)`:

```ts
  it('fromCenter: dragging SE outward scales symmetrically about the centre, base unchanged', () => {
    // SE corner content starts at (100,100), anchor (50,50). Twice the distance -> scale 2.
    const r = applyScaleHandleDrag({
      ...base,
      corner: { x: 100, y: 100 },
      opposite: { x: 0, y: 0 },
      pointerX: 150,
      pointerY: 150,
      fromCenter: true,
    });
    expect(r.scaleX).toBeCloseTo(2);
    expect(r.scaleY).toBeCloseTo(2);
    expect(r.x).toBeCloseTo(0); // base unchanged
    expect(r.y).toBeCloseTo(0);
    // NW corner moved symmetrically: content(NW) = 50 + 2*(0-50) + 0 = -50 (was 0).
    expect(50 + r.scaleX * (0 - 50) + r.x).toBeCloseTo(-50);
  });

  it('fromCenter EDGE (E): scales only X about the centre, Y + base unchanged', () => {
    const r = applyScaleHandleDrag({
      ...base,
      corner: { x: 100, y: 50 }, // E
      opposite: { x: 0, y: 50 }, // W
      pointerX: 150,
      pointerY: 50,
      fromCenter: true,
    });
    expect(r.scaleX).toBeCloseTo(2);
    expect(r.scaleY).toBeCloseTo(1);
    expect(r.x).toBeCloseTo(0);
    expect(r.y).toBeCloseTo(0);
  });

  it('fromCenter + uniform: non-square aspect preserved, sx=t*S0x, sy=t*S0y', () => {
    // start 2:1; A=(50,50), Cc=content(SE)=(150,100); project (150,50) -> t=0.8.
    const r = applyScaleHandleDrag({
      ...base,
      startScaleX: 2,
      startScaleY: 1,
      corner: { x: 100, y: 100 },
      opposite: { x: 0, y: 0 },
      pointerX: 150,
      pointerY: 50,
      fromCenter: true,
      uniform: true,
    });
    expect(r.scaleX / r.scaleY).toBeCloseTo(2);
    expect(r.scaleX).toBeCloseTo(1.6);
    expect(r.scaleY).toBeCloseTo(0.8);
  });

  it('fromCenter: collapsing drag onto the centre floors both axes at MIN_SCALE', () => {
    const r = applyScaleHandleDrag({
      ...base,
      corner: { x: 100, y: 100 },
      opposite: { x: 0, y: 0 },
      pointerX: 50, // onto the anchor -> scale 0
      pointerY: 50,
      fromCenter: true,
    });
    expect(r.scaleX).toBeCloseTo(MIN_SCALE);
    expect(r.scaleY).toBeCloseTo(MIN_SCALE);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/ui/components/Stage/scaleHandles.test.ts`
Expected: the 4 new tests FAIL (fromCenter ignored → opposite-fixed math gives different scale/base).

- [ ] **Step 3: Implement the branch** — in `applyScaleHandleDrag`, insert BEFORE the existing opposite-fixed body (after the signature):

```ts
  if (i.fromCenter) {
    let px = i.pointerX;
    let py = i.pointerY;
    const tr = (i.rotationDeg * Math.PI) / 180;
    const cr = Math.cos(tr);
    const sr = Math.sin(tr);
    const isCorner = i.corner.x !== i.opposite.x && i.corner.y !== i.opposite.y;
    if (i.uniform && isCorner) {
      // Project onto the anchor-content -> corner-content line so sx/sy keep the start aspect.
      const aC = { x: i.anchorX + i.baseX, y: i.anchorY + i.baseY };
      const ex = i.startScaleX * (i.corner.x - i.anchorX);
      const ey = i.startScaleY * (i.corner.y - i.anchorY);
      const cC = { x: i.anchorX + (cr * ex - sr * ey) + i.baseX, y: i.anchorY + (sr * ex + cr * ey) + i.baseY };
      let tp = projectParam({ x: px, y: py }, aC, cC);
      const tMin = Math.max(MIN_SCALE / i.startScaleX, MIN_SCALE / i.startScaleY);
      if (!(tp >= tMin)) tp = tMin;
      px = aC.x + tp * (cC.x - aC.x);
      py = aC.y + tp * (cC.y - aC.y);
    }
    // Pure scale about the anchor: content(anchor)=anchor+base for any S, so base stays.
    const dx = px - i.anchorX - i.baseX;
    const dy = py - i.anchorY - i.baseY;
    const ux = cr * dx + sr * dy; // R(-rot)
    const uy = -sr * dx + cr * dy;
    const ex2 = i.corner.x - i.anchorX;
    const ey2 = i.corner.y - i.anchorY;
    let sx = ex2 === 0 ? i.startScaleX : ux / ex2;
    let sy = ey2 === 0 ? i.startScaleY : uy / ey2;
    if (!(sx >= MIN_SCALE)) sx = MIN_SCALE;
    if (!(sy >= MIN_SCALE)) sy = MIN_SCALE;
    return { scaleX: sx, scaleY: sy, x: i.baseX, y: i.baseY };
  }
```

And add `fromCenter?: boolean;` to the `ScaleInput` interface.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/ui/components/Stage/scaleHandles.test.ts`
Expected: PASS (all, incl. the unchanged opposite-fixed tests).

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/Stage/scaleHandles.ts src/ui/components/Stage/scaleHandles.test.ts
git commit -m "feat(slice30): scale handles support fromCenter (scale about the anchor)"
```

---

### Task 2: Resize handles — `fromCenter`

**Files:**
- Modify: `src/ui/components/Stage/resizeHandles.ts`
- Test: `src/ui/components/Stage/resizeHandles.test.ts`

**Interfaces:**
- Consumes: `projectParam`, existing `ResizeInput`/`ResizeResult`.
- Produces: `ResizeInput.fromCenter?: boolean`. When set, `applyHandleResize` grows symmetrically about the geometric center `(w/2,h/2)`; the shared base-compensation block runs with the center as fixed point.

- [ ] **Step 1: Write the failing tests** — append to `resizeHandles.test.ts` inside `describe('applyHandleResize', ...)` (reuses the file's `stagePos` helper + `base`):

```ts
  it('fromCenter SE drag (rot 0): grows symmetrically and keeps the centre fixed', () => {
    const o = { W: 100, H: 40, fx: 0.5, fy: 0.5, bx: 10, by: 20, sx: 1, sy: 1, deg: 0 };
    const centreBefore = stagePos({ x: 50, y: 20 }, o); // local centre
    const r = applyHandleResize({ ...base, handle: 'se', localX: 130, localY: 30, rotationDeg: 0, fromCenter: true });
    expect(r.width).toBeCloseTo(160); // 2*|130-50|
    expect(r.height).toBeCloseTo(20); // 2*|30-20|
    const centreAfter = stagePos(
      { x: r.width / 2, y: r.height / 2 },
      { ...o, W: r.width, H: r.height, bx: r.baseX, by: r.baseY },
    );
    expect(centreAfter.x).toBeCloseTo(centreBefore.x);
    expect(centreAfter.y).toBeCloseTo(centreBefore.y);
  });

  it('fromCenter EDGE (E): grows only width about the centre, height + centre fixed', () => {
    const o = { W: 100, H: 40, fx: 0.5, fy: 0.5, bx: 10, by: 20, sx: 1, sy: 1, deg: 0 };
    const centreBefore = stagePos({ x: 50, y: 20 }, o);
    const r = applyHandleResize({ ...base, handle: 'e', localX: 120, localY: 20, rotationDeg: 0, fromCenter: true });
    expect(r.width).toBeCloseTo(140); // 2*|120-50|
    expect(r.height).toBeCloseTo(40); // unchanged
    const centreAfter = stagePos(
      { x: r.width / 2, y: r.height / 2 },
      { ...o, W: r.width, H: r.height, bx: r.baseX, by: r.baseY },
    );
    expect(centreAfter.x).toBeCloseTo(centreBefore.x);
    expect(centreAfter.y).toBeCloseTo(centreBefore.y);
  });

  it('fromCenter SE drag keeps the centre fixed under rotation', () => {
    const o = { W: 100, H: 40, fx: 0.5, fy: 0.5, bx: 10, by: 20, sx: 1, sy: 1, deg: 30 };
    const centreBefore = stagePos({ x: 50, y: 20 }, o);
    const r = applyHandleResize({ ...base, handle: 'se', localX: 140, localY: 35, rotationDeg: 30, fromCenter: true });
    const centreAfter = stagePos(
      { x: r.width / 2, y: r.height / 2 },
      { ...o, W: r.width, H: r.height, bx: r.baseX, by: r.baseY },
    );
    expect(centreAfter.x).toBeCloseTo(centreBefore.x);
    expect(centreAfter.y).toBeCloseTo(centreBefore.y);
  });

  it('fromCenter + uniform: off-diagonal SE drag preserves the start aspect', () => {
    const r = applyHandleResize({
      handle: 'se',
      localX: 160,
      localY: 60, // off the centre->corner line
      width: 200,
      height: 120,
      anchorFracX: 0.5,
      anchorFracY: 0.5,
      baseX: 0,
      baseY: 0,
      scaleX: 1,
      scaleY: 1,
      rotationDeg: 0,
      minSize: 1,
      fromCenter: true,
      uniform: true,
    });
    expect(r.width / r.height).toBeCloseTo(200 / 120);
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/ui/components/Stage/resizeHandles.test.ts`
Expected: the 4 new tests FAIL.

- [ ] **Step 3: Implement** — add `fromCenter?: boolean;` to `ResizeInput`, then restructure `applyHandleResize` so `w2/h2` and the fixed-point `foX/foY/fnX/fnY` are computed per-mode and the anchor+rotation+base block is shared.

Replace the body from the `let lx`/`let ly` projection through the `fnY` assignments with:

```ts
  let lx = i.localX;
  let ly = i.localY;
  let w2: number;
  let h2: number;
  let foX: number;
  let foY: number;
  if (i.fromCenter) {
    const cx = i.width / 2;
    const cy = i.height / 2;
    if (i.uniform && (movesLeft || movesRight) && (movesTop || movesBottom)) {
      const centre = { x: cx, y: cy };
      const corner = { x: movesRight ? i.width : 0, y: movesBottom ? i.height : 0 };
      let tp = projectParam({ x: lx, y: ly }, centre, corner);
      const tMin = Math.max(i.minSize / i.width, i.minSize / i.height);
      if (!(tp >= tMin)) tp = tMin;
      lx = centre.x + tp * (corner.x - centre.x);
      ly = centre.y + tp * (corner.y - centre.y);
    }
    w2 = movesLeft || movesRight ? Math.max(i.minSize, 2 * Math.abs(lx - cx)) : i.width;
    h2 = movesTop || movesBottom ? Math.max(i.minSize, 2 * Math.abs(ly - cy)) : i.height;
    foX = cx;
    foY = cy;
  } else {
    // Shift = keep aspect: project the local pointer onto the dragged corner's start
    // diagonal (through the fixed corner). Corners only.
    if (i.uniform && (movesLeft || movesRight) && (movesTop || movesBottom)) {
      const fixed = { x: movesRight ? 0 : i.width, y: movesBottom ? 0 : i.height };
      const dragged = { x: movesRight ? i.width : 0, y: movesBottom ? i.height : 0 };
      let tp = projectParam({ x: lx, y: ly }, fixed, dragged);
      const tMin = Math.max(i.minSize / i.width, i.minSize / i.height);
      if (!(tp >= tMin)) tp = tMin;
      lx = fixed.x + tp * (dragged.x - fixed.x);
      ly = fixed.y + tp * (dragged.y - fixed.y);
    }
    w2 = i.width;
    if (movesRight) w2 = Math.max(i.minSize, lx);
    else if (movesLeft) w2 = Math.max(i.minSize, i.width - lx);
    h2 = i.height;
    if (movesBottom) h2 = Math.max(i.minSize, ly);
    else if (movesTop) h2 = Math.max(i.minSize, i.height - ly);
    foX = movesLeft ? i.width : 0;
    foY = movesTop ? i.height : 0;
  }
  const fnX = i.fromCenter ? w2 / 2 : movesLeft ? w2 : 0;
  const fnY = i.fromCenter ? h2 / 2 : movesTop ? h2 : 0;
```

The existing anchor (`ax/ay/a2x/a2y`), rotation, and `return { width: w2, height: h2, baseX: ..., baseY: ... }` block stays unchanged below.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/ui/components/Stage/resizeHandles.test.ts`
Expected: PASS (incl. the unchanged opposite-fixed tests).

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/Stage/resizeHandles.ts src/ui/components/Stage/resizeHandles.test.ts
git commit -m "feat(slice30): resize handles support fromCenter (symmetric about the centre)"
```

---

### Task 3: Wire Stage call sites + integration + e2e

**Files:**
- Modify: `src/ui/components/Stage/Stage.tsx` (the two drag calls)
- Test: `src/ui/components/Stage/Stage.test.tsx`
- Test: `e2e/alt-scale-from-center.spec.ts` (create)

**Interfaces:**
- Consumes: Task 1 + Task 2 `fromCenter`.
- Produces: live `fromCenter: e.altKey` on both handle drags.

- [ ] **Step 1: Wire the call sites** — in `Stage.tsx`, add `fromCenter: e.altKey,` to the `applyScaleHandleDrag({ ... uniform: e.shiftKey, })` call (after `uniform`) and to the `applyHandleResize({ ... uniform: e.shiftKey, })` call (after `uniform`).

- [ ] **Step 2: Write the Stage integration test** — append to `Stage.test.tsx`, mirroring the existing shift-scale test (which drags a scale corner). Find the existing scale-handle test (~line 320) for the exact harness (draw/import an object, grab a `scale-handle-se`, pointerMove/Up on `window`). The new test Alt-drags and asserts symmetric scale + unchanged position:

```ts
test('Alt-dragging a scale corner scales about the centre (position unchanged)', async () => {
  // ... reuse the existing scale-handle harness to select an svg/path object and
  // grab the SE scale handle (see the shift-scale test above) ...
  fireEvent.pointerMove(window, { clientX: /* outward */, clientY: /* outward */, altKey: true });
  fireEvent.pointerUp(window, { clientX: /* same */, clientY: /* same */, altKey: true });
  const obj = useEditor.getState().history.present.objects[0];
  // scaled up on both axes; x/y (base) unchanged from the pre-drag origin.
  expect(obj.tracks.scaleX?.[0].value ?? obj.shapeBase /* per object model */).toBeDefined();
  // assert scaleX>1 && scaleY>1 && x,y ~ origin (pin to the harness's numbers).
});
```

Note: pin the exact client coords + expected values to the existing harness's CTM stub (identity) the way the shift-scale test does; assert `scaleX` and `scaleY` both increased and the stored `x`/`y` equal the pre-drag values. If the object model stores scale on `Transform2D`/tracks, read whichever the sibling test reads.

- [ ] **Step 3: Run the integration test**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx`
Expected: PASS.

- [ ] **Step 4: Write the e2e** — `e2e/alt-scale-from-center.spec.ts`, reusing the S26/28 scale-handle e2e harness (import an svg object, switch to Select, read the object's bbox center, grab the SE scale handle, drag outward with Alt held):

```ts
import { test, expect } from '@playwright/test';

test('Alt-dragging a scale corner scales the object about its centre', async ({ page }) => {
  // ... reuse scale-handles.spec.ts setup to get an svg object selected ...
  // record the object wrapper's bounding box centre,
  // grab [data-testid="scale-handle-se"], drag outward while holding Alt:
  //   await page.keyboard.down('Alt');  ... mouse.down/move/up ...  await page.keyboard.up('Alt');
  // assert: the wrapper grew (width after > width before) AND its centre is ~unchanged.
});
```

(Model the drag/asserts on `e2e/scale-handles.spec.ts` / `e2e/uniform-scale.spec.ts`; hold Alt via `page.keyboard.down('Alt')` around the mouse drag, or pass `{ modifiers: ['Alt'] }`-style by issuing keyboard down/up — Playwright's `mouse` has no modifier arg, so use `keyboard.down/up('Alt')`.)

- [ ] **Step 5: Run e2e**

Run: `pnpm exec playwright test e2e/alt-scale-from-center.spec.ts`
Expected: PASS.

- [ ] **Step 6: Full gate + commit**

```bash
pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test
git add src/ui/components/Stage/Stage.tsx src/ui/components/Stage/Stage.test.tsx e2e/alt-scale-from-center.spec.ts
git commit -m "feat(slice30): Alt = scale/resize from centre at the Stage call sites + e2e"
```

---

## Self-Review (post-write)

- **Spec coverage:** scale-from-center (T1), resize-from-center (T2), Alt+Shift compose (T1/T2 uniform tests), edge single-axis (T1/T2), no-flip floor (T1/T2 near-zero), wiring + e2e (T3). All §-items mapped.
- **Type consistency:** `fromCenter?: boolean` named identically across both interfaces and both call sites; `projectParam` signature reused as-is.
- **No placeholders:** T1/T2 have complete code + exact expected numbers (verified by hand: SE→(150,150) ⇒ ×2; uniform non-square ⇒ t=0.8, sx=1.6/sy=0.8; resize SE→(130,30) ⇒ 160×20, centre fixed). T3 leaves the Stage/e2e coords to the existing harness deliberately (they depend on the sibling test's CTM stub) — the assertions are specified.
