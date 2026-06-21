# M2 Slice 7 — Freehand Brush (Plan B: UI / tools) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire a freehand Brush tool: drag on the Stage to capture points, live-preview the stroke, and commit a smooth editable path on release.

**Architecture:** A `'brush'` `ToolMode` + two tool-option fields (`brushSize`, `brushSmoothing`). `addVectorPath` gains an optional style-seed param so the stroke commits as a round-capped stroked path in one undo step. The Stage accumulates drag points in a ref (mirroring the existing `drawRef` primitive machine), renders an imperative `<path data-testid="brush-preview">`, and on pointer-up calls `strokeToPath(points, brushParams(brushSmoothing))` → `addVectorPath(path, styleSeed)`. Palette button, `B` shortcut, and a brush branch in the existing `PrimitiveOptions` row complete the surface. No export/runtime/persistence change (stays v4).

**Tech Stack:** React 18 + TS strict, Zustand, Vitest + RTL, Playwright (chromium).

## Global Constraints

- Depends on Plan A: `strokeToPath`, `brushParams`, `BrushParams` exported from `src/engine` (barrel).
- `addVectorPath` already bbox-normalizes a stage-space `PathData`, creates a `shapeType:'path'` asset/object, selects it, and switches to the `node` tool — reuse it unchanged except the new optional 2nd arg.
- `PATH_DEFAULT_STYLE = { fill:'none', stroke:'#000000', strokeWidth:2 }` (store.ts:178). The style seed merges OVER it.
- Commit/side-effects run OUTSIDE React setState updaters (window pointer handlers, like the existing `drawRef` machine) — the StrictMode double-invoke discipline from Slices 2–3.
- Use `0 - v` never `-v` for coordinate negation.
- Existing tool shortcuts (do not collide): V/P/N/R/E/M/G/S/L. `B` is free.
- Run after each task: `pnpm vitest run <file>`; gate at the end with `pnpm exec tsc --noEmit && pnpm lint && pnpm build && pnpm exec playwright test`.
- Commit after each task.

---

### Task 1: Store — `'brush'` ToolMode, tool options, `addVectorPath` style seed

**Files:**
- Modify: `src/ui/store/store.ts` (ToolMode union ~49-51; `EditorState` interface ~101-165; initial state ~193-196; `addVectorPath` body 284-312; primitive setters ~752-760)
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Produces:
  - `ToolMode` includes `'brush'`.
  - State `brushSize: number` (default 4), `brushSmoothing: number` (default 0.5).
  - `setBrushSize(n: number): void` (clamp `Math.max(1, n)`), `setBrushSmoothing(r: number): void` (clamp `[0,1]`).
  - `addVectorPath(path: PathData, styleSeed?: Partial<VectorStyle>): void` — `style: { ...PATH_DEFAULT_STYLE, ...styleSeed }`. Absent seed = byte-identical to today.

- [ ] **Step 1: Write the failing test**

```ts
// add to src/ui/store/store.test.ts
import type { PathData } from '../../engine';

it('clamps brush tool options', () => {
  const s = useEditor.getState();
  s.setBrushSize(-3);
  expect(useEditor.getState().brushSize).toBe(1);
  s.setBrushSmoothing(5);
  expect(useEditor.getState().brushSmoothing).toBe(1);
  s.setBrushSmoothing(-1);
  expect(useEditor.getState().brushSmoothing).toBe(0);
});

it('addVectorPath applies an optional style seed over the defaults', () => {
  const path: PathData = { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }] };
  useEditor.getState().addVectorPath(path, { strokeWidth: 9, strokeLinecap: 'round' });
  const proj = useEditor.getState().history.present;
  const asset = proj.assets[proj.assets.length - 1];
  expect(asset.kind).toBe('vector');
  if (asset.kind === 'vector') {
    expect(asset.style.strokeWidth).toBe(9);
    expect(asset.style.strokeLinecap).toBe('round');
    expect(asset.style.fill).toBe('none'); // default preserved
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/store/store.test.ts`
Expected: FAIL — `setBrushSize`/`brushSmoothing` undefined; `addVectorPath` ignores the 2nd arg.

- [ ] **Step 3: Implement**

In the `ToolMode` union (store.ts ~49-51) add `'brush'`:

```ts
export type ToolMode =
  | 'select' | 'pen' | 'node' | 'rect' | 'ellipse' | 'motion'
  | 'polygon' | 'star' | 'line' | 'brush';
```

In the `EditorState` interface, next to `polygonSides`/`starPoints`/`starInnerRatio` (~101-103) add:

```ts
  brushSize: number;
  brushSmoothing: number;
```

and next to their setters (~163-165) add:

```ts
  setBrushSize(n: number): void;
  setBrushSmoothing(r: number): void;
```

Change the `addVectorPath` signature in the interface (line ~119) to:

```ts
  addVectorPath(path: PathData, styleSeed?: Partial<VectorStyle>): void;
```

(Ensure `VectorStyle` is imported in store.ts — `PATH_DEFAULT_STYLE` already uses it.)

In the initial state, next to `starInnerRatio: 0.5,` (~196) add:

```ts
  brushSize: 4,
  brushSmoothing: 0.5,
```

In the `addVectorPath` implementation (284), accept the seed and merge it:

```ts
  addVectorPath(path, styleSeed) {
    if (path.nodes.length < 2) return;
    // ...unchanged normalization...
    const asset = createVectorAsset('path', { path: normalized, style: { ...PATH_DEFAULT_STYLE, ...styleSeed } });
    // ...unchanged...
  },
```

Next to the primitive setters (~752-760) add:

```ts
  setBrushSize(n) {
    set({ brushSize: Math.max(1, n) });
  },
  setBrushSmoothing(r) {
    set({ brushSmoothing: Math.min(1, Math.max(0, r)) });
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/ui/store/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(brush): brush ToolMode + tool options + addVectorPath style seed"
```

---

### Task 2: ToolPalette — Brush button

**Files:**
- Modify: `src/ui/components/Toolbar/ToolPalette.tsx` (the `TOOLS` array, 5-15)
- Test: `src/ui/components/Toolbar/ToolPalette.test.tsx`

**Interfaces:**
- Consumes: `setActiveTool` (existing). Produces: a `Brush` button that sets `activeTool: 'brush'`.

- [ ] **Step 1: Write the failing test**

```tsx
// add to src/ui/components/Toolbar/ToolPalette.test.tsx
it('selects the brush tool', async () => {
  render(<ToolPalette />);
  await userEvent.click(screen.getByRole('button', { name: 'Brush' }));
  expect(useEditor.getState().activeTool).toBe('brush');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/components/Toolbar/ToolPalette.test.tsx`
Expected: FAIL — no `Brush` button.

- [ ] **Step 3: Implement**

Add to the `TOOLS` array (after `{ id: 'line', label: 'Line' },`):

```ts
  { id: 'brush', label: 'Brush' },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/ui/components/Toolbar/ToolPalette.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/Toolbar/ToolPalette.tsx src/ui/components/Toolbar/ToolPalette.test.tsx
git commit -m "feat(brush): ToolPalette Brush button"
```

---

### Task 3: Keyboard — `B` selects the brush

**Files:**
- Modify: `src/ui/hooks/useKeyboard.ts` (tool-shortcut switch, ~42-50)
- Test: `src/ui/hooks/useKeyboard.test.ts`

**Interfaces:**
- Produces: pressing `b`/`B` (no modifier) sets `activeTool: 'brush'`.

- [ ] **Step 1: Write the failing test**

```ts
// add to src/ui/hooks/useKeyboard.test.ts (mirror the existing per-tool shortcut tests)
it('B selects the brush tool', () => {
  renderHook(() => useKeyboard());
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b' }));
  });
  expect(useEditor.getState().activeTool).toBe('brush');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/hooks/useKeyboard.test.ts`
Expected: FAIL — `b` does nothing.

- [ ] **Step 3: Implement**

Add a case alongside the other tool shortcuts (after `case 'l': case 'L': ...`):

```ts
        case 'b': case 'B': s.setActiveTool('brush'); break;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/ui/hooks/useKeyboard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/hooks/useKeyboard.ts src/ui/hooks/useKeyboard.test.ts
git commit -m "feat(brush): B keyboard shortcut"
```

---

### Task 4: Tool-options row — brush size + smoothing

**Files:**
- Modify: `src/ui/components/Toolbar/PrimitiveOptions.tsx`
- Test: `src/ui/components/Toolbar/PrimitiveOptions.test.tsx`

**Interfaces:**
- Consumes: `brushSize`, `brushSmoothing`, `setBrushSize`, `setBrushSmoothing` (Task 1). Produces: a `Brush options` group (rendered only when `activeTool === 'brush'`) with a Size number input and a Smoothing range input.

- [ ] **Step 1: Write the failing test**

```tsx
// add to src/ui/components/Toolbar/PrimitiveOptions.test.tsx
it('shows brush options and updates size when the brush tool is active', async () => {
  useEditor.getState().setActiveTool('brush');
  render(<PrimitiveOptions />);
  const size = screen.getByLabelText('Size');
  await userEvent.clear(size);
  await userEvent.type(size, '12');
  expect(useEditor.getState().brushSize).toBe(12);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/components/Toolbar/PrimitiveOptions.test.tsx`
Expected: FAIL — no Size control for the brush.

- [ ] **Step 3: Implement**

Pull the brush state/setters at the top of the component (next to the existing `useEditor((s) => ...)` lines):

```tsx
  const brushSize = useEditor((s) => s.brushSize);
  const brushSmoothing = useEditor((s) => s.brushSmoothing);
  const setBrushSize = useEditor((s) => s.setBrushSize);
  const setBrushSmoothing = useEditor((s) => s.setBrushSmoothing);
```

Add this branch before the final `return null;`:

```tsx
  if (tool === 'brush') {
    return (
      <div className={styles.bar} role="group" aria-label="Brush options">
        <label>
          Size
          <input
            type="number"
            min={1}
            value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
          />
        </label>
        <label>
          Smoothing
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={brushSmoothing}
            onChange={(e) => setBrushSmoothing(Number(e.target.value))}
          />
        </label>
      </div>
    );
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/ui/components/Toolbar/PrimitiveOptions.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/Toolbar/PrimitiveOptions.tsx src/ui/components/Toolbar/PrimitiveOptions.test.tsx
git commit -m "feat(brush): brush size + smoothing tool-options row"
```

---

### Task 5: Stage — capture, live preview, commit

**Files:**
- Modify: `src/ui/components/Stage/Stage.tsx` (imports line 3, 10; refs ~175-182; `onBackgroundPointerDown` 249-294; window `onMove` 315-432; window `onUp` 433-490; render preview block 519-527)
- Test: `src/ui/components/Stage/Stage.test.tsx`

**Interfaces:**
- Consumes: `strokeToPath`, `brushParams` (engine barrel); `brushSize`, `brushSmoothing`, `addVectorPath` (store). Produces: brush drag → one `shapeType:'path'` object whose path equals `strokeToPath(points, brushParams(brushSmoothing))`, styled with `strokeWidth: brushSize` + round caps; a sub-threshold tap commits nothing.

> jsdom has no SVG CTM/matrix API. Mirror the Slice 6 stamp test: stub `SVGElement.prototype.getScreenCTM` → identity and `ownerSVGElement.createSVGPoint` so `clientToLocal` maps client→stage-local. (Real drag is covered by the e2e in Task 6.)

- [ ] **Step 1: Write the failing test**

```tsx
// add to src/ui/components/Stage/Stage.test.tsx — reuse the CTM stub helper the
// existing primitive/stamp test uses (identity getScreenCTM + createSVGPoint).
it('brush drag commits a smooth path object', () => {
  useEditor.getState().setActiveTool('brush');
  // ...render <Stage/>, install the identity-CTM stubs as in the stamp test...
  const svg = screen.getByLabelText('Stage').querySelector('svg')!;
  fireEvent.pointerDown(svg, { clientX: 0, clientY: 0, button: 0 });
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: 10, clientY: 20 }));
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: 20, clientY: 0 }));
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: 30, clientY: 20 }));
  window.dispatchEvent(new PointerEvent('pointerup', {}));

  const proj = useEditor.getState().history.present;
  expect(proj.objects).toHaveLength(1);
  const asset = proj.assets[proj.assets.length - 1];
  expect(asset.kind).toBe('vector');
  if (asset.kind === 'vector' && asset.shapeType === 'path') {
    expect(asset.style.strokeLinecap).toBe('round');
    expect(asset.style.strokeWidth).toBe(useEditor.getState().brushSize);
    expect(asset.path.nodes.length).toBeGreaterThanOrEqual(2);
  }
});

it('a single-point brush tap commits nothing', () => {
  useEditor.getState().setActiveTool('brush');
  // ...render + stubs...
  const svg = screen.getByLabelText('Stage').querySelector('svg')!;
  fireEvent.pointerDown(svg, { clientX: 5, clientY: 5, button: 0 });
  window.dispatchEvent(new PointerEvent('pointerup', {}));
  expect(useEditor.getState().history.present.objects).toHaveLength(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx`
Expected: FAIL — brush drag creates no object.

- [ ] **Step 3: Implement**

Imports — extend the engine import (line 3) and add nothing else new beyond:

```ts
import { brushParams, buildTransform, geometryToSvgAttrs, identityCorrespondence, pathBounds, pathToD, resolveAnchor, sampleObject, samplePath, strokeToPath } from '../../../engine';
```

Add a brush capture ref next to `drawRef`/`previewRef`/`primitivePreviewRef` (~175-182):

```ts
  const brushRef = useRef<{ points: Point[] } | null>(null);
  const brushPreviewRef = useRef<SVGPathElement | null>(null);
```

In `onBackgroundPointerDown`, add a brush branch (place it right after the `pen`/`motion` branch, before `node`):

```ts
    if (s.activeTool === 'brush') {
      const start = clientToLocal(e.clientX, e.clientY);
      if (start) brushRef.current = { points: [start] };
      return;
    }
```

In the window `onMove` handler, add a brush block immediately before `const draw = drawRef.current;` (~330):

```ts
      const brush = brushRef.current;
      if (brush) {
        const cur = clientToLocal(e.clientX, e.clientY);
        if (cur) {
          brush.points.push(cur);
          const el = brushPreviewRef.current;
          if (el) {
            // raw in-progress polyline (cheap); the committed path is the smoothed strokeToPath
            el.setAttribute('d', pathToD({ nodes: brush.points.map((p) => ({ anchor: p })), closed: false }));
            el.setAttribute('visibility', 'visible');
          }
        }
        return;
      }
```

In the window `onUp` handler, add a brush block immediately before `const draw = drawRef.current;` (~444):

```ts
      const brush = brushRef.current;
      if (brush) {
        brushRef.current = null;
        if (brushPreviewRef.current) brushPreviewRef.current.setAttribute('visibility', 'hidden');
        const s = useEditor.getState();
        const path = strokeToPath(brush.points, brushParams(s.brushSmoothing));
        if (path.nodes.length >= 2) {
          s.addVectorPath(path, { strokeWidth: s.brushSize, strokeLinecap: 'round', strokeLinejoin: 'round' });
        }
        return;
      }
```

In the render, add the preview path next to `primitive-preview` (after line 527):

```tsx
          <path
            ref={brushPreviewRef}
            data-testid="brush-preview"
            visibility="hidden"
            fill="none"
            stroke="var(--color-accent)"
            pointerEvents="none"
          />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/Stage/Stage.tsx src/ui/components/Stage/Stage.test.tsx
git commit -m "feat(brush): Stage capture, live preview, and commit"
```

---

### Task 6: e2e — draw → morph → export animates

**Files:**
- Create: `e2e/brush.spec.ts` (model on `e2e/primitives.spec.ts`)

**Interfaces:**
- Consumes: the full running app. Produces: proof that a brushed path exports as an animating bundle.

- [ ] **Step 1: Write the test**

```ts
// e2e/brush.spec.ts
import { test, expect } from '@playwright/test';
import { unzipSync } from 'fflate';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

test('brush a stroke -> morph it -> export -> exported path d animates', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Draw a freehand stroke: down, several moves, up. addVectorPath creates a
  // `path` object, selects it, and switches to the node tool.
  await page.getByRole('button', { name: 'Brush', exact: true }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  const x0 = box.x + 100;
  const y0 = box.y + 160;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 + 40, y0 - 40);
  await page.mouse.move(x0 + 80, y0 + 20);
  await page.mouse.move(x0 + 120, y0 - 20);
  await page.mouse.up();
  await expect(page.locator('section[aria-label="Stage"] [data-savig-object]')).toHaveCount(1);

  // Opt into morphing: snapshot the shape at t=0.
  await page.getByRole('button', { name: /add shape keyframe/i }).click();

  // Move the playhead, then drag a node to create a second shape keyframe.
  await page.getByTestId('timeline-ruler').click({ position: { x: 120, y: 10 } });
  const node = page.getByTestId('node-1');
  const nb = (await node.boundingBox())!;
  await page.mouse.move(nb.x + nb.width / 2, nb.y + nb.height / 2);
  await page.mouse.down();
  await page.mouse.move(nb.x + 50, nb.y + 50);
  await page.mouse.up();
  await expect(page.getByText(/morph: 2 keyframe/i)).toBeVisible();

  // Export and assert the exported path `d` animates (two distinct values).
  // ...follow primitives.spec.ts: trigger export, read the downloaded/zip HTML,
  // assert the bundle contains an animated <path> d (the same assertion shape
  // primitives.spec.ts uses).
});
```

> Copy the export-and-assert tail verbatim from `e2e/primitives.spec.ts` (download interception → `unzipSync` / HTML read → assert the `<path>` `d` changes across the animation). The brush object is a `path` like a stamped star, so the identical assertion applies.

- [ ] **Step 2: Run it**

Run: `pnpm exec playwright test e2e/brush.spec.ts`
Expected: PASS (1 test).

- [ ] **Step 3: Commit**

```bash
git add e2e/brush.spec.ts
git commit -m "test(e2e): brushed stroke morph-animates in the exported bundle"
```

---

### Task 7: Full gate

- [ ] **Step 1: Run the whole gate**

```bash
pnpm exec tsc --noEmit && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test
```

Expected: typecheck clean, lint clean, all unit tests green, build clean, all e2e green.

- [ ] **Step 2: Commit any gate fixups** (only if needed)

```bash
git add -A && git commit -m "chore(brush): gate fixups"
```

---

## Self-Review (done while writing — recorded for the implementer)

- **Spec §5 (style seed, one atomic undo step):** Task 1 adds `addVectorPath(path, styleSeed?)`; Task 5 passes `{ strokeWidth, strokeLinecap:'round', strokeLinejoin:'round' }`. Covered.
- **Spec §6 (tool options, defaults 4 / 0.5, clamps):** Task 1 state+setters; Task 4 UI. Covered.
- **Spec §7 (ToolMode 'brush'):** Task 1. Covered.
- **Spec §8 (capture, CTM reuse, live preview, sub-threshold cancel, one undo step, routing broadened):** Task 5 — `brushRef` accumulates via the existing `clientToLocal`; commit gated on `path.nodes.length >= 2`; commit in the window `onUp` handler (outside any setState updater). Covered.
- **Spec §9 (palette button, B shortcut, options row):** Tasks 2/3/4. Covered.
- **Spec §10 (no export/runtime/persistence change):** nothing in this plan touches those layers. Covered.
- **Spec §11 (testing incl. e2e):** Tasks 1-6 unit + Task 6 e2e. Covered.
- **Type consistency:** `strokeToPath(points, brushParams(brushSmoothing))` signature matches Plan A; `styleSeed: Partial<VectorStyle>` matches the store interface change; `brushRef: { points: Point[] }` uses the Stage-local `Point` type (drawGeometry.ts).
- **No placeholders:** the only prose-only step is the e2e export tail, which explicitly says "copy verbatim from `e2e/primitives.spec.ts`" — a concrete, existing reference, not an invention.
