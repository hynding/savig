# Slice 28 Uniform (shift) Scale & Resize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hold Shift while dragging a corner handle to keep the aspect ratio, for both the scale handles (svg/path) and the resize handles (rect/ellipse).

**Architecture:** A shared pure `projectOntoLine` (new `handleMath.ts`) projects the pointer onto the dragged corner's start diagonal; both `applyScaleHandleDrag` and `applyHandleResize` gain a `uniform?: boolean` that does this projection first (provably aspect-preserving) for CORNER handles only. The Stage drag `onMove` passes `uniform: e.shiftKey` (live). Editor-only.

**Tech Stack:** TypeScript (strict), React 18, Zustand, Vitest + RTL, Playwright.

## Global Constraints

- TypeScript strict; no `any`. Match surrounding code style.
- Uniform = Shift; **corners only** (edges no-op — guard `corner.x !== opposite.x && corner.y !== opposite.y` for scale, `(movesLeft||movesRight) && (movesTop||movesBottom)` for resize).
- The projection is the ONLY new math; the rest of each helper (free `sx,sy`/`w2,h2`, MIN_SCALE/minSize clamp, opposite-corner-fixed translation) is unchanged — it just reads the projected pointer.
- Shift is read live each `onMove` (toggling mid-drag re-evaluates).
- Editor-only: no engine/store/persistence/render/runtime/export/migration change (v4).
- Run the full gate before declaring done: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`.

---

### Task 1: Pure `projectOntoLine`

**Files:**
- Create: `src/ui/components/Stage/handleMath.ts`
- Test: `src/ui/components/Stage/handleMath.test.ts`

**Interfaces:**
- Produces: `interface Pt2 { x: number; y: number }`; `projectOntoLine(p: Pt2, a: Pt2, b: Pt2): Pt2`.

- [ ] **Step 1: Write the failing tests**

Create `src/ui/components/Stage/handleMath.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { projectOntoLine } from './handleMath';

describe('projectOntoLine', () => {
  it('projects a point orthogonally onto the line', () => {
    const p = projectOntoLine({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 });
    expect(p.x).toBeCloseTo(0.5);
    expect(p.y).toBeCloseTo(0.5);
  });
  it('returns a point already on the line unchanged', () => {
    const p = projectOntoLine({ x: 3, y: 3 }, { x: 0, y: 0 }, { x: 1, y: 1 });
    expect(p.x).toBeCloseTo(3);
    expect(p.y).toBeCloseTo(3);
  });
  it('returns `a` for a degenerate line (a === b)', () => {
    const p = projectOntoLine({ x: 5, y: 9 }, { x: 2, y: 2 }, { x: 2, y: 2 });
    expect(p).toEqual({ x: 2, y: 2 });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/ui/components/Stage/handleMath.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/ui/components/Stage/handleMath.ts`:

```ts
export interface Pt2 {
  x: number;
  y: number;
}

/** Orthogonally project point `p` onto the infinite line through `a` and `b`.
 *  Returns `a` when `a` and `b` coincide (degenerate line). */
export function projectOntoLine(p: Pt2, a: Pt2, b: Pt2): Pt2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { x: a.x, y: a.y };
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  return { x: a.x + t * dx, y: a.y + t * dy };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm vitest run src/ui/components/Stage/handleMath.test.ts`
Expected: PASS (all 3).

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/Stage/handleMath.ts src/ui/components/Stage/handleMath.test.ts
git commit -m "feat(slice28): pure projectOntoLine helper"
```

---

### Task 2: Scale uniform (helper + Stage + e2e)

**Files:**
- Modify: `src/ui/components/Stage/scaleHandles.ts`
- Modify: `src/ui/components/Stage/Stage.tsx`
- Test: `src/ui/components/Stage/scaleHandles.test.ts`
- Test: `src/ui/components/Stage/Stage.test.tsx`
- Create: `e2e/uniform-scale.spec.ts`

**Interfaces:**
- Consumes: `projectOntoLine` (Task 1).
- Produces: `ScaleInput.uniform?: boolean`; aspect-locked result when set on a corner.

- [ ] **Step 1: Write the failing pure tests**

Append to `src/ui/components/Stage/scaleHandles.test.ts` (the `base` fixture — anchor (50,50), startScale 1, base (0,0), rot 0 — is at the top of the file; reuse it):

```ts
  it('uniform: an off-diagonal SE drag keeps a square aspect (scaleX === scaleY)', () => {
    const r = applyScaleHandleDrag({
      ...base,
      corner: { x: 100, y: 100 }, // SE
      opposite: { x: 0, y: 0 }, // NW
      pointerX: 200, pointerY: 150, // off the (0,0)->(100,100) diagonal
      uniform: true,
    });
    expect(r.scaleX).toBeCloseTo(r.scaleY); // aspect locked
    expect(r.scaleX).toBeCloseTo(1.75); // projection of (200,150) onto the diagonal -> (175,175)
  });
  it('uniform: preserves a NON-square start aspect (scaleX/scaleY === startScaleX/startScaleY)', () => {
    const r = applyScaleHandleDrag({
      ...base,
      startScaleX: 2, startScaleY: 1, // start aspect 2:1
      corner: { x: 100, y: 100 }, opposite: { x: 0, y: 0 },
      pointerX: 260, pointerY: 130, uniform: true,
    });
    expect(r.scaleX / r.scaleY).toBeCloseTo(2); // 2:1 preserved regardless of pointer
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/ui/components/Stage/scaleHandles.test.ts -t "uniform"`
Expected: FAIL — `uniform` ignored (free result is non-square).

- [ ] **Step 3: Add `uniform` to the scale helper**

In `src/ui/components/Stage/scaleHandles.ts`:

1. Import the helper at the top:

```ts
import { projectOntoLine } from './handleMath';
```

2. Add `uniform?: boolean;` to `ScaleInput` (after `pointerY: number;`).

3. At the START of `applyScaleHandleDrag` (replacing the first two lines `const t = …; const c = …`), project the pointer when uniform on a corner, then continue with `px`/`py`:

```ts
export function applyScaleHandleDrag(i: ScaleInput): ScaleResult {
  let px = i.pointerX;
  let py = i.pointerY;
  // Shift = keep aspect: project the pointer onto the dragged corner's start diagonal.
  // Corners only (an edge's corner & opposite share a coordinate -> skip).
  const isCorner = i.corner.x !== i.opposite.x && i.corner.y !== i.opposite.y;
  if (i.uniform && isCorner) {
    const tr = (i.rotationDeg * Math.PI) / 180;
    const cr = Math.cos(tr);
    const sr = Math.sin(tr);
    const contentOf = (lx: number, ly: number) => {
      const ex = i.startScaleX * (lx - i.anchorX);
      const ey = i.startScaleY * (ly - i.anchorY);
      return { x: i.anchorX + (cr * ex - sr * ey) + i.baseX, y: i.anchorY + (sr * ex + cr * ey) + i.baseY };
    };
    const proj = projectOntoLine(
      { x: px, y: py },
      contentOf(i.opposite.x, i.opposite.y),
      contentOf(i.corner.x, i.corner.y),
    );
    px = proj.x;
    py = proj.y;
  }
  const t = (i.rotationDeg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  // u = R(-rot) · (P - a - base) - S0 · (o - a)
  const dx = px - i.anchorX - i.baseX;
  const dy = py - i.anchorY - i.baseY;
  // …rest of the function unchanged (rx/ry/ux/uy/sx/sy/clamp/x/y).
}
```

(Only the top of the function changes: introduce `px`/`py`, the uniform projection, and
change the `dx`/`dy` lines from `i.pointerX`/`i.pointerY` to `px`/`py`. Everything below
`const dx` is unchanged.)

- [ ] **Step 4: Run the pure tests**

Run: `pnpm vitest run src/ui/components/Stage/scaleHandles.test.ts`
Expected: PASS (the 2 uniform tests + all existing corner/edge/clamp tests, which pass `uniform` undefined → no projection).

- [ ] **Step 5: Pass `e.shiftKey` from the Stage scale drag**

In `src/ui/components/Stage/Stage.tsx`, the scale `onMove` call to `applyScaleHandleDrag({ … })` (it ends with `pointerX: local.x, pointerY: local.y,`) — add `uniform: e.shiftKey,`:

```ts
        const r = applyScaleHandleDrag({
          corner: snap.corner,
          opposite: snap.opposite,
          anchorX: snap.anchorX,
          anchorY: snap.anchorY,
          startScaleX: snap.startScaleX,
          startScaleY: snap.startScaleY,
          baseX: snap.baseX,
          baseY: snap.baseY,
          rotationDeg: snap.rotationDeg,
          pointerX: local.x,
          pointerY: local.y,
          uniform: e.shiftKey,
        });
```

- [ ] **Step 6: Write the Stage unit test (shift-drag aspect-locks)**

Append to `src/ui/components/Stage/Stage.test.tsx`:

```ts
it('shift-dragging a scale corner aspect-locks an imported-svg object (scaleX === scaleY)', () => {
  stubIdentityCTM(); // client coords == content coords
  const svgText = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>';
  useEditor.getState().newProject();
  useEditor.getState().addAsset({ id: 'a', kind: 'svg', name: 'box', normalizedContent: svgText, viewBox: '0 0 100 100', width: 100, height: 100 });
  useEditor.getState().addObject('a'); // anchor (50,50), at (0,0)
  useEditor.getState().seek(0);
  const id = useEditor.getState().selectedObjectId!;
  const nodes = new Map<string, SVGGraphicsElement>([[id, document.createElementNS('http://www.w3.org/2000/svg', 'g')]]);
  render(<Stage nodes={nodes} />);
  const se = screen.getByTestId('scale-handle-se'); // content (100,100) at scale 1
  fireEvent.pointerDown(se, { clientX: 100, clientY: 100, button: 0 });
  fireEvent.pointerMove(window, { clientX: 200, clientY: 150, shiftKey: true }); // off-diagonal + shift
  fireEvent.pointerUp(window, { clientX: 200, clientY: 150, shiftKey: true });
  const obj = useEditor.getState().history.present.objects.find((o) => o.id === id)!;
  expect(obj.tracks.scaleX?.[0].value).toBeCloseTo(obj.tracks.scaleY?.[0].value ?? -1); // aspect locked
  expect(obj.tracks.scaleX?.[0].value).toBeCloseTo(1.75);
});
```

- [ ] **Step 7: Run the Stage suite**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx`
Expected: PASS (the new shift-drag test + all existing scale/edge/rotate/resize tests).

- [ ] **Step 8: Write the e2e**

Create `e2e/uniform-scale.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('shift-dragging a scale corner keeps the aspect ratio', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  await page.getByLabel('Import SVG').setInputFiles('e2e/fixtures/box.svg');
  await page.getByRole('button', { name: 'box.svg' }).click();
  await page.getByRole('button', { name: 'Select' }).click();

  const xField = page.getByLabel('x', { exact: true });
  await xField.fill('150');
  await xField.blur();
  const yField = page.getByLabel('y', { exact: true });
  await yField.fill('120');
  await yField.blur();

  const obj = page.locator('[data-savig-object]').first();

  // Shift-drag the SE corner along an OFF-diagonal path; aspect must stay square.
  const handle = page.getByTestId('scale-handle-se');
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 80, hb.y + hb.height / 2 + 30); // off-diagonal
  await page.mouse.up();
  await page.keyboard.up('Shift');

  const after = await obj.getAttribute('transform');
  // scale(k, k) with EQUAL factors (aspect preserved), and not scale(1, 1).
  const m = after!.match(/scale\(([-\d.]+),\s*([-\d.]+)\)/)!;
  expect(Number(m[1])).toBeCloseTo(Number(m[2]), 2);
  expect(Number(m[1])).not.toBeCloseTo(1, 2);
});
```

- [ ] **Step 9: Run the e2e + gate + commit**

Run: `pnpm exec playwright test e2e/uniform-scale.spec.ts`
Expected: PASS.
Run: `pnpm typecheck && pnpm lint`
Expected: clean.

```bash
git add src/ui/components/Stage/scaleHandles.ts src/ui/components/Stage/scaleHandles.test.ts src/ui/components/Stage/Stage.tsx src/ui/components/Stage/Stage.test.tsx e2e/uniform-scale.spec.ts
git commit -m "feat(slice28): uniform (shift) scale — corner aspect-lock via diagonal projection"
```

---

### Task 3: Resize uniform (helper + Stage)

**Files:**
- Modify: `src/ui/components/Stage/resizeHandles.ts`
- Modify: `src/ui/components/Stage/Stage.tsx`
- Test: `src/ui/components/Stage/resizeHandles.test.ts`
- Test: `src/ui/components/Stage/Stage.test.tsx`

**Interfaces:**
- Consumes: `projectOntoLine` (Task 1).
- Produces: `ResizeInput.uniform?: boolean`; aspect-locked geometry when set on a corner.

- [ ] **Step 1: Write the failing pure test**

Append to `src/ui/components/Stage/resizeHandles.test.ts`:

```ts
it('uniform: an off-diagonal SE drag keeps the start aspect (width/height)', () => {
  const r = applyHandleResize({
    handle: 'se',
    localX: 260,
    localY: 60, // off the (0,0)->(200,120) start diagonal
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
    uniform: true,
  });
  expect(r.width / r.height).toBeCloseTo(200 / 120); // start aspect preserved
});
```

> Check the start-aspect by hand: diagonal `(0,0)->(200,120)`; project `(260,60)` → `t = (260·200 + 60·120)/(200²+120²) = (52000+7200)/(40000+14400) = 59200/54400 ≈ 1.0882`; proj ≈ `(217.6, 130.6)`; `w2/h2 = 217.6/130.6 = 200/120`. ✓

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/ui/components/Stage/resizeHandles.test.ts -t "uniform"`
Expected: FAIL — `uniform` ignored.

- [ ] **Step 3: Add `uniform` to the resize helper**

In `src/ui/components/Stage/resizeHandles.ts`:

1. Import at the top:

```ts
import { projectOntoLine } from './handleMath';
```

2. Add `uniform?: boolean;` to `ResizeInput` (after `minSize: number;`).

3. In `applyHandleResize`, after the four `movesLeft/Right/Top/Bottom` booleans, project the local pointer onto the corner diagonal when uniform on a corner, and use `lx`/`ly` in the `w2`/`h2` computation:

```ts
  const movesLeft = i.handle === 'nw' || i.handle === 'w' || i.handle === 'sw';
  const movesRight = i.handle === 'ne' || i.handle === 'e' || i.handle === 'se';
  const movesTop = i.handle === 'nw' || i.handle === 'n' || i.handle === 'ne';
  const movesBottom = i.handle === 'sw' || i.handle === 's' || i.handle === 'se';

  let lx = i.localX;
  let ly = i.localY;
  // Shift = keep aspect: project the local pointer onto the dragged corner's start
  // diagonal (through the fixed corner). Corners only.
  if (i.uniform && (movesLeft || movesRight) && (movesTop || movesBottom)) {
    const fixed = { x: movesRight ? 0 : i.width, y: movesBottom ? 0 : i.height };
    const dragged = { x: movesRight ? i.width : 0, y: movesBottom ? i.height : 0 };
    const proj = projectOntoLine({ x: lx, y: ly }, fixed, dragged);
    lx = proj.x;
    ly = proj.y;
  }

  let w2 = i.width;
  if (movesRight) w2 = Math.max(i.minSize, lx);
  else if (movesLeft) w2 = Math.max(i.minSize, i.width - lx);

  let h2 = i.height;
  if (movesBottom) h2 = Math.max(i.minSize, ly);
  else if (movesTop) h2 = Math.max(i.minSize, i.height - ly);
  // …rest unchanged (foX/foY, anchor compensation, base').
```

(Change the two `w2`/`h2` blocks from `i.localX`/`i.localY` to `lx`/`ly`; everything below is unchanged.)

- [ ] **Step 4: Run the pure test**

Run: `pnpm vitest run src/ui/components/Stage/resizeHandles.test.ts`
Expected: PASS (the uniform test + all existing resize tests, which pass `uniform` undefined).

- [ ] **Step 5: Pass `e.shiftKey` from the Stage resize drag**

In `src/ui/components/Stage/Stage.tsx`, the resize `onMove` call to `applyHandleResize({ … })` (it ends with `minSize: 1,`) — add `uniform: e.shiftKey,`:

```ts
        const r = applyHandleResize({
          handle: rz.handle,
          localX: local.x,
          localY: local.y,
          width: snap.width,
          height: snap.height,
          anchorFracX: snap.anchorFracX,
          anchorFracY: snap.anchorFracY,
          baseX: snap.baseX,
          baseY: snap.baseY,
          scaleX: snap.scaleX,
          scaleY: snap.scaleY,
          rotationDeg: snap.rotationDeg,
          minSize: 1,
          uniform: e.shiftKey,
        });
```

- [ ] **Step 6: Write the Stage unit test (shift-resize aspect-locks)**

Append to `src/ui/components/Stage/Stage.test.tsx`:

```ts
it('shift-dragging a resize corner aspect-locks a rect (width/height preserved)', () => {
  stubIdentityCTM();
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 200, height: 120 });
  useEditor.getState().seek(0);
  const id = useEditor.getState().selectedObjectId!;
  const nodes = new Map<string, SVGGraphicsElement>([[id, document.createElementNS('http://www.w3.org/2000/svg', 'g')]]);
  render(<Stage nodes={nodes} />);
  const se = screen.getByTestId('handle-se'); // rect SE resize handle, local (200,120)
  fireEvent.pointerDown(se, { clientX: 200, clientY: 120, button: 0 });
  fireEvent.pointerMove(window, { clientX: 260, clientY: 60, shiftKey: true }); // off-diagonal + shift
  fireEvent.pointerUp(window, { clientX: 260, clientY: 60, shiftKey: true });
  const obj = useEditor.getState().history.present.objects.find((o) => o.id === id)!;
  const w = obj.tracks.width?.[0].value ?? 200;
  const h = obj.tracks.height?.[0].value ?? 120;
  expect(w / h).toBeCloseTo(200 / 120); // aspect locked
});
```

> The resize handle testids are `handle-<id>` (e.g. `handle-se`) per the existing
> `resize-handles` overlay; confirm with the existing resize tests if the drag setup
> differs.

- [ ] **Step 7: Run the Stage suite + full gate**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx`
Expected: PASS.
Run: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add src/ui/components/Stage/resizeHandles.ts src/ui/components/Stage/resizeHandles.test.ts src/ui/components/Stage/Stage.tsx src/ui/components/Stage/Stage.test.tsx
git commit -m "feat(slice28): uniform (shift) resize — corner aspect-lock via diagonal projection"
```

---

## Self-Review (plan vs spec)

- **§2 shared `projectOntoLine` (orthogonal projection, degenerate→a)** → Task 1 + 3 pure tests. ✅
- **§3 scale `uniform` (corner-only projection onto content diagonal; aspect preserved)** → Task 2 Step 3 + the square + non-square pure tests (verified by hand: (200,150)→(175,175)→1.75:1.75). ✅
- **§4 resize `uniform` (corner-only projection onto local diagonal; w/h aspect)** → Task 3 Step 3 + the pure test (verified by hand: (260,60)→~(217.6,130.6)→200:120). ✅
- **§5 Stage passes `uniform: e.shiftKey` live** → Task 2 Step 5 + Task 3 Step 5 + the shift-drag Stage tests (`shiftKey: true`). ✅
- **§6 editor-only** → only `handleMath.ts` + `scaleHandles.ts` + `resizeHandles.ts` + `Stage.tsx` + tests + one e2e. ✅
- **§9 testing (projectOntoLine ×3; scale pure ×2 + Stage; resize pure ×1 + Stage; e2e)** → Tasks 1–3. ✅
- **Type/name consistency:** `projectOntoLine(p,a,b): Pt2` / `Pt2` identical across the helper, both importers, and tests; `ScaleInput.uniform` / `ResizeInput.uniform` are `?: boolean`; the Stage call sites add exactly `uniform: e.shiftKey`. The corner guard differs by helper (scale: coord-share; resize: moves* booleans) as the spec specifies. ✅
- **Placeholder scan:** every step carries concrete code; the resize Stage test notes the `handle-<id>` testid to confirm; the e2e parses `scale(k, k)` and asserts equal factors ≠ 1. ✅
