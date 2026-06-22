# Slice 26 Edge Scale Handles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the four edge scale handles (n/e/s/w) to the svg/path scale overlay, completing Slice 23 to 8 handles; an edge handle scales one axis with the opposite edge held fixed.

**Architecture:** Extend the pure `scaleHandles.ts` (8 ids, edge midpoint positions, `oppositeCorner`→`oppositeHandle` mapping edges); `applyScaleHandleDrag` is unchanged — its `dcx===0`/`dcy===0` guards already keep an axis fixed for an edge. The Stage overlay (`SCALE_HANDLE_IDS.map`) and drag (`onScaleHandlePointerDown`) are id-agnostic, so they auto-render and auto-handle the four new edges after a one-line rename. Editor-only; reuses Slice-23 infra.

**Tech Stack:** TypeScript (strict), React 18, Zustand, Vitest + RTL, Playwright.

## Global Constraints

- TypeScript strict; no `any`. Match surrounding code style.
- `ScaleHandleId` → all 8 (`'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'`), order matching resize's `HANDLE_IDS`. `applyScaleHandleDrag` UNCHANGED.
- Edge handle = single-axis: `e`/`w` keep `scaleY` at start (`dcy===0` guard), `n`/`s` keep `scaleX`; the opposite EDGE stays fixed (same opposite-handle math as corners). MIN_SCALE clamp + rotation-awareness inherited.
- Rename `oppositeCorner` → `oppositeHandle` (it now maps edges); update its import + call site in `Stage.tsx` and the test import.
- Editor-only: reuses Slice-23 scale infra; NO engine/render/runtime/export/migration change (v4).
- Run the full gate before declaring done: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`.

---

### Task 1: Pure helper — 8 handles + `oppositeHandle`

**Files:**
- Modify: `src/ui/components/Stage/scaleHandles.ts`
- Modify: `src/ui/components/Stage/scaleHandles.test.ts`
- Modify: `src/ui/components/Stage/Stage.tsx` (rename the import + one call site)

**Interfaces:**
- Produces: `ScaleHandleId` (8 values); `SCALE_HANDLE_IDS` (8); `scaleHandleLocalPositions(bbox)` (8 entries); `oppositeHandle(id)` (replaces `oppositeCorner`). `applyScaleHandleDrag` / `ScaleInput` / `ScaleResult` / `MIN_SCALE` unchanged.

- [ ] **Step 1: Update the pure tests (8 positions, oppositeHandle, edge drag)**

In `src/ui/components/Stage/scaleHandles.test.ts`, change the import on line 2:

```ts
import { applyScaleHandleDrag, scaleHandleLocalPositions, oppositeHandle, MIN_SCALE } from './scaleHandles';
```

Replace the `describe('scaleHandleLocalPositions / oppositeCorner', …)` block with:

```ts
describe('scaleHandleLocalPositions / oppositeHandle', () => {
  it('places all eight handles (respecting a non-zero bbox origin)', () => {
    const p = scaleHandleLocalPositions({ x: 10, y: 20, width: 100, height: 60 });
    expect(p.nw).toEqual({ x: 10, y: 20 });
    expect(p.n).toEqual({ x: 60, y: 20 });
    expect(p.ne).toEqual({ x: 110, y: 20 });
    expect(p.e).toEqual({ x: 110, y: 50 });
    expect(p.se).toEqual({ x: 110, y: 80 });
    expect(p.s).toEqual({ x: 60, y: 80 });
    expect(p.sw).toEqual({ x: 10, y: 80 });
    expect(p.w).toEqual({ x: 10, y: 50 });
  });
  it('maps each handle to its opposite (corners and edges)', () => {
    expect(oppositeHandle('nw')).toBe('se');
    expect(oppositeHandle('se')).toBe('nw');
    expect(oppositeHandle('ne')).toBe('sw');
    expect(oppositeHandle('sw')).toBe('ne');
    expect(oppositeHandle('n')).toBe('s');
    expect(oppositeHandle('s')).toBe('n');
    expect(oppositeHandle('e')).toBe('w');
    expect(oppositeHandle('w')).toBe('e');
  });
});
```

Then append an edge-drag test to the existing `describe('applyScaleHandleDrag', …)` block
(the `base` fixture — anchor (50,50), startScale 1, base (0,0), rot 0 — is already defined
at the top of that describe):

```ts
  it('dragging the E (right-edge) handle scales only X and holds the left edge fixed', () => {
    const r = applyScaleHandleDrag({
      ...base,
      corner: { x: 100, y: 50 }, // right-edge mid (E), local
      opposite: { x: 0, y: 50 }, // left-edge mid (W), local
      pointerX: 200, pointerY: 50, // content coords
    });
    expect(r.scaleX).toBeCloseTo(2);
    expect(r.scaleY).toBeCloseTo(1); // Y unchanged (single-axis)
    // The left edge (W, local x=0) stays at content x=0: a + R·S·(o-a) + (x,y), rot=0.
    expect(50 + r.scaleX * (0 - 50) + r.x).toBeCloseTo(0);
  });
  it('dragging the N (top-edge) handle scales only Y', () => {
    const r = applyScaleHandleDrag({
      ...base,
      corner: { x: 50, y: 0 }, // top-edge mid (N)
      opposite: { x: 50, y: 100 }, // bottom-edge mid (S)
      pointerX: 50, pointerY: -100,
    });
    expect(r.scaleY).toBeCloseTo(2);
    expect(r.scaleX).toBeCloseTo(1); // X unchanged
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/ui/components/Stage/scaleHandles.test.ts`
Expected: FAIL — `oppositeHandle` not exported; `p.n`/`p.e`/… undefined.

- [ ] **Step 3: Extend the helper + rename**

In `src/ui/components/Stage/scaleHandles.ts`, replace the id/positions/opposite section
(lines 1–19) with:

```ts
export type ScaleHandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const SCALE_HANDLE_IDS: readonly ScaleHandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
export const MIN_SCALE = 0.05;

export function scaleHandleLocalPositions(
  bbox: { x: number; y: number; width: number; height: number },
): Record<ScaleHandleId, { x: number; y: number }> {
  const { x, y, width, height } = bbox;
  return {
    nw: { x, y },
    n: { x: x + width / 2, y },
    ne: { x: x + width, y },
    e: { x: x + width, y: y + height / 2 },
    se: { x: x + width, y: y + height },
    s: { x: x + width / 2, y: y + height },
    sw: { x, y: y + height },
    w: { x, y: y + height / 2 },
  };
}

// The handle held fixed while dragging `id` (its diagonal opposite for a corner, its
// across-the-box partner for an edge).
export function oppositeHandle(id: ScaleHandleId): ScaleHandleId {
  return ({ nw: 'se', se: 'nw', ne: 'sw', sw: 'ne', n: 's', s: 'n', e: 'w', w: 'e' } as const)[id];
}
```

(Leave `ScaleInput`, `ScaleResult`, `MIN_SCALE` value, and `applyScaleHandleDrag` exactly
as-is; optionally update `applyScaleHandleDrag`'s doc comment to say "handle" instead of
"corner".)

- [ ] **Step 4: Rename the import + call site in `Stage.tsx`**

In `src/ui/components/Stage/Stage.tsx`, the scaleHandles import block currently lists
`oppositeCorner,` — change it to `oppositeHandle,`. Then the one call site (in
`onScaleHandlePointerDown`, `opposite: corners[oppositeCorner(id)],`) becomes:

```ts
        opposite: corners[oppositeHandle(id)],
```

(`SCALE_HANDLE_IDS.map(...)` in the overlay is unchanged — it now iterates 8 ids and
renders 8 `<rect data-testid="scale-handle-<id>">`. `onScaleHandlePointerDown(id)` is
unchanged.)

- [ ] **Step 5: Run to verify they pass + gate**

Run: `pnpm vitest run src/ui/components/Stage/scaleHandles.test.ts`
Expected: PASS (8-position, oppositeHandle, E-drag, N-drag, + the existing corner/clamp tests).
Run: `pnpm typecheck && pnpm lint`
Expected: clean (the rename propagated; no other `oppositeCorner` references remain — verify with `grep -rn oppositeCorner src` returning nothing).

- [ ] **Step 6: Commit**

```bash
git add src/ui/components/Stage/scaleHandles.ts src/ui/components/Stage/scaleHandles.test.ts src/ui/components/Stage/Stage.tsx
git commit -m "feat(slice26): edge scale handles (8-handle parity); oppositeCorner -> oppositeHandle"
```

---

### Task 2: Stage edge-handle render/drag test + e2e

**Files:**
- Modify: `src/ui/components/Stage/Stage.test.tsx`
- Create: `e2e/scale-edge-handles.spec.ts`

**Interfaces:**
- Consumes: Task 1 (`scale-handle-e` now renders; the drag scales one axis).

- [ ] **Step 1: Write the failing Stage test**

Append to `src/ui/components/Stage/Stage.test.tsx`:

```ts
it('renders edge scale handles and an E drag scales only X on an imported-svg object', () => {
  stubIdentityCTM(); // client coords == content coords
  const svgText = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>';
  useEditor.getState().newProject();
  useEditor.getState().addAsset({ id: 'a', kind: 'svg', name: 'box', normalizedContent: svgText, viewBox: '0 0 100 100', width: 100, height: 100 });
  useEditor.getState().addObject('a'); // anchor (50,50), at (0,0)
  useEditor.getState().seek(0);
  const id = useEditor.getState().selectedObjectId!;
  const nodes = new Map<string, SVGGraphicsElement>([[id, document.createElementNS('http://www.w3.org/2000/svg', 'g')]]);
  render(<Stage nodes={nodes} />);
  const e = screen.getByTestId('scale-handle-e'); // right-edge mid, content (100,50) at scale 1
  fireEvent.pointerDown(e, { clientX: 100, clientY: 50, button: 0 });
  fireEvent.pointerMove(window, { clientX: 200, clientY: 50 }); // drag right -> scaleX 2
  fireEvent.pointerUp(window, { clientX: 200, clientY: 50 });
  const obj = useEditor.getState().history.present.objects.find((o) => o.id === id)!;
  expect(obj.tracks.scaleX?.[0].value).toBeCloseTo(2);
  expect(obj.tracks.scaleY?.[0].value).toBeCloseTo(1); // Y unchanged (single-axis)
});
```

- [ ] **Step 2: Run to verify it fails (then passes)**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx -t "edge scale"`
Expected: After Task 1 this likely already PASSES (the overlay auto-renders `scale-handle-e`
and the drag scales one axis). If so, that confirms the id-agnostic wiring; keep the test as
a regression guard. If it FAILS, fix per the message.

- [ ] **Step 3: Run the full Stage suite**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx`
Expected: PASS (the new edge test + all existing scale/rotate/resize tests).

- [ ] **Step 4: Write the e2e**

Create `e2e/scale-edge-handles.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('drag the E edge scale handle stretches an imported-svg on one axis', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  await page.getByLabel('Import SVG').setInputFiles('e2e/fixtures/box.svg');
  await page.getByRole('button', { name: 'box.svg' }).click();
  await page.getByRole('button', { name: 'Select' }).click();

  // Move it into the stage interior so the edge handle is clearly draggable.
  const xField = page.getByLabel('x', { exact: true });
  await xField.fill('150');
  await xField.blur();
  const yField = page.getByLabel('y', { exact: true });
  await yField.fill('120');
  await yField.blur();

  const obj = page.locator('[data-savig-object]').first();
  const before = await obj.getAttribute('transform');
  expect(before).toMatch(/scale\(1, 1\)/);

  // Drag the right-edge (E) handle outward.
  const handle = page.getByTestId('scale-handle-e');
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 60, hb.y + hb.height / 2);
  await page.mouse.up();

  const after = await obj.getAttribute('transform');
  expect(after).not.toBe(before);
  expect(after).toMatch(/scale\([^,]+, 1\)/); // X changed, Y still 1 (single-axis)
  expect(after).not.toMatch(/scale\(1, 1\)/);
});
```

- [ ] **Step 5: Run the e2e**

Run: `pnpm exec playwright test e2e/scale-edge-handles.spec.ts`
Expected: PASS.

> If `before` isn't exactly `scale(1, 1)`, log the transform and match the real initial
> token; the import→instance→reposition sequence mirrors the proven `scale-handles.spec.ts`.

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ui/components/Stage/Stage.test.tsx e2e/scale-edge-handles.spec.ts
git commit -m "test(slice26): edge scale handle renders + single-axis drag (unit + e2e)"
```

---

## Self-Review (plan vs spec)

- **§2 8 ids/positions + `oppositeHandle` (edges); `applyScaleHandleDrag` unchanged** → Task 1 Step 3 + the 8-position/oppositeHandle/E-drag/N-drag pure tests. ✅
- **§3 Stage auto-renders + one rename** → Task 1 Step 4 (rename only) + Task 2's edge render/drag Stage test proving the auto-wiring. ✅
- **§5 single-axis (E/W keep scaleY, N/S keep scaleX); opposite edge fixed; MIN_SCALE/rotation inherited** → the E-drag (scaleY=1, left edge fixed) + N-drag (scaleX=1) pure tests + the Stage drag test (scaleX≈2, scaleY≈1). ✅
- **§4 editor-only** → only `scaleHandles.ts` + `Stage.tsx` (rename) + tests + one e2e. ✅
- **§8 testing (pure: 8-pos, opposite, E/N drag; Stage edge render+drag; e2e single-axis)** → Tasks 1–2. ✅
- **Type/name consistency:** `oppositeHandle` replaces `oppositeCorner` in the helper, its test, and `Stage.tsx` (import + call) — `grep oppositeCorner src` must be empty after Task 1; `ScaleHandleId`/`SCALE_HANDLE_IDS` 8-valued everywhere; testids `scale-handle-<id>` (now incl. `-e`/`-n`/`-s`/`-w`). ✅
- **Placeholder scan:** every step has concrete code; the e2e mirrors the proven scale-handles spec; the single-axis regex `/scale\([^,]+, 1\)/` asserts X≠fixed, Y=1. ✅
