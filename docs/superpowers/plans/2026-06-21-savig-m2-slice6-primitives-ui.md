# M2 Slice 6 — Primitives (UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Polygon / Star / Line drawing tools to the editor — palette buttons, keyboard shortcuts, creation-time tool options, and click-drag-to-stamp on the Stage — that generate a `PathData` (via the engine `primitives` module) and create it through the existing `addVectorPath` pipeline.

**Architecture:** New `ToolMode` values plus small tool-option state in the store. A pure `primitivePathFromDrag` helper turns a drag into a `PathData`; the Stage's existing draw state machine drives a live `<path>` preview and commits via `addVectorPath` on release. No engine render-seam, export, runtime, or persistence change.

**Tech Stack:** React 18 + TS strict, Zustand, Vitest + RTL, Playwright. No new dependencies.

## Global Constraints

- Depends on the engine plan `2026-06-21-savig-m2-slice6-primitives-engine.md` (`polygonPath`, `starPath`, `linePath`, all re-exported from `src/engine`). Implement that plan first.
- `addVectorPath(path: PathData)` already bbox-normalizes stage-space paths, creates a `shapeType:'path'` asset+object, selects it, and switches to the `node` tool. Primitive creation reuses it verbatim — **no new creation store action**.
- Existing tool shortcuts (do not change): `V` select, `P` pen, `N` node, `R` rect, `E` ellipse, `M` motion. New: `G` polygon, `S` star, `L` line (all currently free).
- Stage coordinate mapping uses the existing `clientToLocal` (client → stage-local via `getScreenCTM`).
- Use `0 - v` (not `-v`) when negating possibly-zero coordinates (`-0` vs `+0`).
- No persistence version bump (primitives are paths). Project stays at version 4.
- Commit messages end with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.

---

### Task 1: Store — ToolMode + tool-option state & setters

**Files:**
- Modify: `src/ui/store/store.ts`
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Consumes: existing `setActiveTool`.
- Produces (state): `polygonSides: number` (default 5), `starPoints: number` (default 5), `starInnerRatio: number` (default 0.5).
- Produces (actions): `setPolygonSides(n: number): void` (clamp `Math.max(3, Math.floor(n))`), `setStarPoints(n: number): void` (clamp `Math.max(2, Math.floor(n))`), `setStarInnerRatio(r: number): void` (clamp to `(0, 1)` → `Math.min(0.99, Math.max(0.01, r))`).
- `ToolMode` becomes `'select' | 'pen' | 'node' | 'rect' | 'ellipse' | 'motion' | 'polygon' | 'star' | 'line'`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/ui/store/store.test.ts — add a describe block
import { useEditor } from './store';

describe('primitive tools', () => {
  beforeEach(() => useEditor.getState().newProject());

  it('supports the new tool modes', () => {
    useEditor.getState().setActiveTool('polygon');
    expect(useEditor.getState().activeTool).toBe('polygon');
    useEditor.getState().setActiveTool('star');
    expect(useEditor.getState().activeTool).toBe('star');
    useEditor.getState().setActiveTool('line');
    expect(useEditor.getState().activeTool).toBe('line');
  });

  it('has sensible tool-option defaults', () => {
    const s = useEditor.getState();
    expect(s.polygonSides).toBe(5);
    expect(s.starPoints).toBe(5);
    expect(s.starInnerRatio).toBe(0.5);
  });

  it('clamps tool-option setters', () => {
    const s = () => useEditor.getState();
    s().setPolygonSides(2);
    expect(s().polygonSides).toBe(3);
    s().setStarPoints(1);
    expect(s().starPoints).toBe(2);
    s().setStarInnerRatio(0);
    expect(s().starInnerRatio).toBeCloseTo(0.01, 6);
    s().setStarInnerRatio(5);
    expect(s().starInnerRatio).toBeCloseTo(0.99, 6);
    s().setStarInnerRatio(0.3);
    expect(s().starInnerRatio).toBeCloseTo(0.3, 6);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/ui/store/store.test.ts -t "primitive tools"`
Expected: FAIL — `setActiveTool('polygon')` is a type/values mismatch; `polygonSides` undefined; setters undefined.

- [ ] **Step 3: Write minimal implementation**

In `src/ui/store/store.ts`:

1. Extend the `ToolMode` union (line ~49):

```ts
export type ToolMode =
  | 'select' | 'pen' | 'node' | 'rect' | 'ellipse' | 'motion'
  | 'polygon' | 'star' | 'line';
```

2. Add state fields to the store interface (near `activeTool: ToolMode;`):

```ts
  polygonSides: number;
  starPoints: number;
  starInnerRatio: number;
```

3. Add action signatures to the interface (near `setActiveTool`):

```ts
  setPolygonSides(n: number): void;
  setStarPoints(n: number): void;
  setStarInnerRatio(r: number): void;
```

4. Add defaults to `TRANSIENT_DEFAULTS` (near `activeTool: 'select' as ToolMode,`):

```ts
  polygonSides: 5,
  starPoints: 5,
  starInnerRatio: 0.5,
```

5. Implement the setters (near `setActiveTool`):

```ts
  setPolygonSides(n) {
    set({ polygonSides: Math.max(3, Math.floor(n)) });
  },
  setStarPoints(n) {
    set({ starPoints: Math.max(2, Math.floor(n)) });
  },
  setStarInnerRatio(r) {
    set({ starInnerRatio: Math.min(0.99, Math.max(0.01, r)) });
  },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/ui/store/store.test.ts -t "primitive tools"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(primitives): ToolMode + polygon/star tool-option state

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Keyboard shortcuts G / S / L

**Files:**
- Modify: `src/ui/hooks/useKeyboard.ts`
- Test: `src/ui/hooks/useKeyboard.test.ts`

**Interfaces:**
- Consumes: `setActiveTool` from Task 1's extended `ToolMode`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/ui/hooks/useKeyboard.test.ts — add cases mirroring the existing R/E tests
it('selects primitive tools via G/S/L', () => {
  render(<KeyHarness />); // existing harness used by sibling tests
  fireEvent.keyDown(window, { key: 'g' });
  expect(useEditor.getState().activeTool).toBe('polygon');
  fireEvent.keyDown(window, { key: 's' });
  expect(useEditor.getState().activeTool).toBe('star');
  fireEvent.keyDown(window, { key: 'l' });
  expect(useEditor.getState().activeTool).toBe('line');
});
```

(If the existing tests dispatch `keyDown` differently — e.g. via a helper — match that exact pattern; read the top of `useKeyboard.test.ts` first and reuse its setup verbatim.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/hooks/useKeyboard.test.ts -t "G/S/L"`
Expected: FAIL — tools stay at their previous value (no handler).

- [ ] **Step 3: Write minimal implementation**

In `src/ui/hooks/useKeyboard.ts`, add cases alongside the existing tool cases (after `case 'm': case 'M':`):

```ts
        case 'g': case 'G': s.setActiveTool('polygon'); break;
        case 's': case 'S': s.setActiveTool('star'); break;
        case 'l': case 'L': s.setActiveTool('line'); break;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/ui/hooks/useKeyboard.test.ts`
Expected: PASS (new + existing keyboard tests green).

- [ ] **Step 5: Commit**

```bash
git add src/ui/hooks/useKeyboard.ts src/ui/hooks/useKeyboard.test.ts
git commit -m "feat(primitives): G/S/L tool shortcuts

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: ToolPalette buttons

**Files:**
- Modify: `src/ui/components/Toolbar/ToolPalette.tsx`
- Test: `src/ui/components/Toolbar/ToolPalette.test.tsx`

**Interfaces:**
- Consumes: extended `ToolMode`.

- [ ] **Step 1: Write the failing test**

```ts
// src/ui/components/Toolbar/ToolPalette.test.tsx — add
it('activates primitive tools from the palette', () => {
  render(<ToolPalette />);
  fireEvent.click(screen.getByRole('button', { name: 'Polygon' }));
  expect(useEditor.getState().activeTool).toBe('polygon');
  fireEvent.click(screen.getByRole('button', { name: 'Star' }));
  expect(useEditor.getState().activeTool).toBe('star');
  fireEvent.click(screen.getByRole('button', { name: 'Line' }));
  expect(useEditor.getState().activeTool).toBe('line');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/components/Toolbar/ToolPalette.test.tsx -t "primitive"`
Expected: FAIL — no buttons named Polygon/Star/Line.

- [ ] **Step 3: Write minimal implementation**

In `src/ui/components/Toolbar/ToolPalette.tsx`, extend the `TOOLS` array:

```ts
const TOOLS: { id: ToolMode; label: string }[] = [
  { id: 'select', label: 'Select' },
  { id: 'pen', label: 'Pen' },
  { id: 'node', label: 'Node' },
  { id: 'rect', label: 'Rectangle' },
  { id: 'ellipse', label: 'Ellipse' },
  { id: 'polygon', label: 'Polygon' },
  { id: 'star', label: 'Star' },
  { id: 'line', label: 'Line' },
  { id: 'motion', label: 'Motion Path' },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/ui/components/Toolbar/ToolPalette.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/Toolbar/ToolPalette.tsx src/ui/components/Toolbar/ToolPalette.test.tsx
git commit -m "feat(primitives): palette buttons for polygon/star/line

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `primitivePathFromDrag` pure helper

**Files:**
- Modify: `src/ui/components/Stage/drawGeometry.ts`
- Test: `src/ui/components/Stage/drawGeometry.test.ts`

**Interfaces:**
- Consumes: `polygonPath`, `starPath`, `linePath` from `src/engine`; existing `Point` type from `drawGeometry.ts`.
- Produces: `primitivePathFromDrag(tool: 'polygon' | 'star' | 'line', start: Point, end: Point, opts: { polygonSides: number; starPoints: number; starInnerRatio: number }, minSize: number): PathData | null`.
  - polygon/star: `start` = center, `radius = Math.hypot(end-start)`, `rotation = Math.atan2(dy, dx) + Math.PI/2` (so the first vertex points toward the drag); star inner radius = `radius * opts.starInnerRatio`. Returns `null` if `radius < minSize`.
  - line: returns `linePath(start, end)`, or `null` if `Math.hypot(end-start) < minSize`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/ui/components/Stage/drawGeometry.test.ts — add
import { primitivePathFromDrag } from './drawGeometry';

const OPTS = { polygonSides: 6, starPoints: 5, starInnerRatio: 0.5 };

describe('primitivePathFromDrag', () => {
  it('builds a polygon centered at start with radius = drag distance', () => {
    const p = primitivePathFromDrag('polygon', { x: 0, y: 0 }, { x: 0, y: 10 }, OPTS, 3);
    expect(p).not.toBeNull();
    expect(p!.nodes).toHaveLength(6);
    expect(p!.closed).toBe(true);
    // every vertex is `radius` (10) from the center
    expect(p!.nodes.every((n) => Math.abs(Math.hypot(n.anchor.x, n.anchor.y) - 10) < 1e-6)).toBe(true);
  });

  it('builds a star with 2*points nodes and inner = radius*ratio', () => {
    const p = primitivePathFromDrag('star', { x: 0, y: 0 }, { x: 10, y: 0 }, OPTS, 3);
    expect(p!.nodes).toHaveLength(10);
    const radii = p!.nodes.map((n) => Math.hypot(n.anchor.x, n.anchor.y));
    expect(Math.max(...radii)).toBeCloseTo(10, 6);
    expect(Math.min(...radii)).toBeCloseTo(5, 6);
  });

  it('builds an open two-node line', () => {
    const p = primitivePathFromDrag('line', { x: 1, y: 2 }, { x: 9, y: 4 }, OPTS, 3);
    expect(p!.closed).toBe(false);
    expect(p!.nodes).toHaveLength(2);
    expect(p!.nodes[0].anchor).toEqual({ x: 1, y: 2 });
    expect(p!.nodes[1].anchor).toEqual({ x: 9, y: 4 });
  });

  it('returns null for a sub-threshold drag', () => {
    expect(primitivePathFromDrag('polygon', { x: 0, y: 0 }, { x: 1, y: 1 }, OPTS, 3)).toBeNull();
    expect(primitivePathFromDrag('line', { x: 0, y: 0 }, { x: 1, y: 1 }, OPTS, 3)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/ui/components/Stage/drawGeometry.test.ts -t primitivePathFromDrag`
Expected: FAIL — `primitivePathFromDrag` not defined.

- [ ] **Step 3: Write minimal implementation**

Append to `src/ui/components/Stage/drawGeometry.ts`:

```ts
import { polygonPath, starPath, linePath, type PathData } from '../../../engine';

export interface PrimitiveOpts {
  polygonSides: number;
  starPoints: number;
  starInnerRatio: number;
}

export function primitivePathFromDrag(
  tool: 'polygon' | 'star' | 'line',
  start: Point,
  end: Point,
  opts: PrimitiveOpts,
  minSize: number,
): PathData | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dist = Math.hypot(dx, dy);
  if (dist < minSize) return null;
  if (tool === 'line') return linePath(start, end);
  const rotation = Math.atan2(dy, dx) + Math.PI / 2; // first vertex points toward the drag
  if (tool === 'polygon') return polygonPath(start.x, start.y, dist, opts.polygonSides, rotation);
  return starPath(start.x, start.y, dist, dist * opts.starInnerRatio, opts.starPoints, rotation);
}
```

(If `drawGeometry.ts` already imports from `'../../../engine'`, merge the named imports into the existing import line rather than adding a second one.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/ui/components/Stage/drawGeometry.test.ts`
Expected: PASS (new + existing `rectFromDrag` tests green).

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/Stage/drawGeometry.ts src/ui/components/Stage/drawGeometry.test.ts
git commit -m "feat(primitives): primitivePathFromDrag helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Stage drag-to-stamp + live preview

**Files:**
- Modify: `src/ui/components/Stage/Stage.tsx`
- Test: `src/ui/components/Stage/Stage.test.tsx`

**Interfaces:**
- Consumes: `primitivePathFromDrag` (Task 4); store `polygonSides`/`starPoints`/`starInnerRatio` (Task 1); `addVectorPath`; `pathToD` from `src/engine`; existing `drawRef`/`clientToLocal`/`MIN_DRAW_SIZE`.

This task extends the **existing draw state machine** (`drawRef` = `{ start, end }`) that today handles rect/ellipse. The current `previewRef` is an `<rect>` used as a bbox preview; primitive tools instead drive a dedicated `<path>` preview that shows the true generated shape.

- [ ] **Step 1: Write the failing test**

```ts
// src/ui/components/Stage/Stage.test.tsx — add (reuse this file's existing render + PointerEvent setup)
it('stamps a polygon via drag and creates a path object', () => {
  const before = useEditor.getState().history.present.objects.length;
  useEditor.getState().setActiveTool('polygon');
  const svg = screen.getByTestId('stage-svg'); // use the testid this file already queries; match it
  fireEvent.pointerDown(svg, { clientX: 100, clientY: 100, button: 0 });
  fireEvent.pointerMove(window, { clientX: 100, clientY: 140 });
  fireEvent.pointerUp(window, { clientX: 100, clientY: 140 });
  const objs = useEditor.getState().history.present.objects;
  expect(objs.length).toBe(before + 1);
  const asset = useEditor.getState().history.present.assets.find((a) => a.id === objs[objs.length - 1].assetId);
  expect(asset?.kind === 'vector' && asset.shapeType).toBe('path');
});
```

(Match the existing test file's Stage render harness, its SVG query/testid, and its CTM mock. The rect/ellipse draw tests in this same file already exercise `clientToLocal` under jsdom — copy their setup so coordinate mapping resolves; if those tests assert via a specific testid other than `stage-svg`, use that exact id.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx -t "stamps a polygon"`
Expected: FAIL — no object created (primitive tools not wired into the draw machine).

- [ ] **Step 3: Write minimal implementation**

In `src/ui/components/Stage/Stage.tsx`:

1. Import the helper and `pathToD` (merge into existing imports):

```ts
import { rectFromDrag, primitivePathFromDrag, type Point } from './drawGeometry';
// add pathToD to the existing `from '../../engine'` (or '../../../engine') import
```

2. Add a preview-path ref near `previewRef`:

```ts
  const primitivePreviewRef = useRef<SVGPathElement | null>(null);
```

3. In `onBackgroundPointerDown`, extend the draw-start branch to include primitive tools:

```ts
    if (
      s.activeTool === 'rect' || s.activeTool === 'ellipse' ||
      s.activeTool === 'polygon' || s.activeTool === 'star' || s.activeTool === 'line'
    ) {
      const start = clientToLocal(e.clientX, e.clientY);
      if (start) drawRef.current = { start, end: null };
      return;
    }
```

4. In the pointer-move handler's `draw` branch, after updating `draw.end`, drive the right preview. Replace the existing rect-only preview block with a tool-aware one:

```ts
      const draw = drawRef.current;
      if (draw) {
        const cur = clientToLocal(e.clientX, e.clientY);
        if (cur) {
          draw.end = cur;
          const tool = useEditor.getState().activeTool;
          if (tool === 'rect' || tool === 'ellipse') {
            const rect = previewRef.current;
            if (rect) {
              rect.setAttribute('x', String(Math.min(draw.start.x, cur.x)));
              rect.setAttribute('y', String(Math.min(draw.start.y, cur.y)));
              rect.setAttribute('width', String(Math.abs(cur.x - draw.start.x)));
              rect.setAttribute('height', String(Math.abs(cur.y - draw.start.y)));
              rect.setAttribute('visibility', 'visible');
            }
          } else {
            const st = useEditor.getState();
            const path = primitivePathFromDrag(
              tool as 'polygon' | 'star' | 'line',
              draw.start,
              cur,
              { polygonSides: st.polygonSides, starPoints: st.starPoints, starInnerRatio: st.starInnerRatio },
              MIN_DRAW_SIZE,
            );
            const el = primitivePreviewRef.current;
            if (el) {
              if (path) {
                el.setAttribute('d', pathToD(path));
                el.setAttribute('visibility', 'visible');
              } else {
                el.setAttribute('visibility', 'hidden');
              }
            }
          }
        }
        return;
      }
```

5. In the pointer-up handler's `draw` branch, commit primitive tools. Replace the existing block:

```ts
      const draw = drawRef.current;
      if (draw) {
        drawRef.current = null;
        if (previewRef.current) previewRef.current.setAttribute('visibility', 'hidden');
        if (primitivePreviewRef.current) primitivePreviewRef.current.setAttribute('visibility', 'hidden');
        const s = useEditor.getState();
        if (draw.end && (s.activeTool === 'rect' || s.activeTool === 'ellipse')) {
          const bounds = rectFromDrag(draw.start, draw.end, MIN_DRAW_SIZE);
          if (bounds) s.addVectorShape(s.activeTool, bounds);
        } else if (
          draw.end &&
          (s.activeTool === 'polygon' || s.activeTool === 'star' || s.activeTool === 'line')
        ) {
          const path = primitivePathFromDrag(
            s.activeTool,
            draw.start,
            draw.end,
            { polygonSides: s.polygonSides, starPoints: s.starPoints, starInnerRatio: s.starInnerRatio },
            MIN_DRAW_SIZE,
          );
          if (path) s.addVectorPath(path);
        }
        return;
      }
```

6. Add the preview `<path>` element next to the existing `<rect ref={previewRef}>` in the JSX (same overlay group; non-interactive, dashed like the rect preview — match the rect preview's class/stroke):

```tsx
            <path
              ref={primitivePreviewRef}
              fill="none"
              stroke="var(--color-accent, #4f8cff)"
              strokeDasharray="4 4"
              pointerEvents="none"
              visibility="hidden"
            />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx`
Expected: PASS (new stamp test + existing Stage tests green — including the rect/ellipse draw tests, which must still work after the move-handler refactor).

- [ ] **Step 5: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run`
Expected: all clean/green.

- [ ] **Step 6: Commit**

```bash
git add src/ui/components/Stage/Stage.tsx src/ui/components/Stage/Stage.test.tsx
git commit -m "feat(primitives): Stage drag-to-stamp + live path preview

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Tool-options row (sides / points / inner ratio)

**Files:**
- Create: `src/ui/components/Toolbar/PrimitiveOptions.tsx`
- Create: `src/ui/components/Toolbar/PrimitiveOptions.test.tsx`
- Modify: the Toolbar container that renders `ToolPalette` (find it: `grep -rn "ToolPalette" src/ui` — render `PrimitiveOptions` beside it).

**Interfaces:**
- Consumes: store `activeTool`, `polygonSides`/`starPoints`/`starInnerRatio` + their setters (Task 1). Reuse the existing numeric input component if there is one (`grep -rn "NumberField" src/ui`); otherwise a plain `<input type="number">` is fine.

- [ ] **Step 1: Write the failing test**

```tsx
// src/ui/components/Toolbar/PrimitiveOptions.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { PrimitiveOptions } from './PrimitiveOptions';
import { useEditor } from '../../store/store';

describe('PrimitiveOptions', () => {
  beforeEach(() => useEditor.getState().newProject());

  it('renders nothing for non-primitive tools', () => {
    useEditor.getState().setActiveTool('select');
    const { container } = render(<PrimitiveOptions />);
    expect(container).toBeEmptyDOMElement();
  });

  it('edits polygon sides when the polygon tool is active', () => {
    useEditor.getState().setActiveTool('polygon');
    render(<PrimitiveOptions />);
    const input = screen.getByLabelText('Sides');
    fireEvent.change(input, { target: { value: '7' } });
    expect(useEditor.getState().polygonSides).toBe(7);
  });

  it('edits star points and inner ratio when the star tool is active', () => {
    useEditor.getState().setActiveTool('star');
    render(<PrimitiveOptions />);
    fireEvent.change(screen.getByLabelText('Points'), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText('Inner ratio'), { target: { value: '0.4' } });
    expect(useEditor.getState().starPoints).toBe(6);
    expect(useEditor.getState().starInnerRatio).toBeCloseTo(0.4, 6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/components/Toolbar/PrimitiveOptions.test.tsx`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/ui/components/Toolbar/PrimitiveOptions.tsx
import { useEditor } from '../../store/store';

export function PrimitiveOptions() {
  const tool = useEditor((s) => s.activeTool);
  const polygonSides = useEditor((s) => s.polygonSides);
  const starPoints = useEditor((s) => s.starPoints);
  const starInnerRatio = useEditor((s) => s.starInnerRatio);
  const setPolygonSides = useEditor((s) => s.setPolygonSides);
  const setStarPoints = useEditor((s) => s.setStarPoints);
  const setStarInnerRatio = useEditor((s) => s.setStarInnerRatio);

  if (tool === 'polygon') {
    return (
      <div role="group" aria-label="Polygon options">
        <label>
          Sides
          <input
            type="number"
            min={3}
            value={polygonSides}
            onChange={(e) => setPolygonSides(Number(e.target.value))}
          />
        </label>
      </div>
    );
  }
  if (tool === 'star') {
    return (
      <div role="group" aria-label="Star options">
        <label>
          Points
          <input
            type="number"
            min={2}
            value={starPoints}
            onChange={(e) => setStarPoints(Number(e.target.value))}
          />
        </label>
        <label>
          Inner ratio
          <input
            type="number"
            min={0.01}
            max={0.99}
            step={0.05}
            value={starInnerRatio}
            onChange={(e) => setStarInnerRatio(Number(e.target.value))}
          />
        </label>
      </div>
    );
  }
  return null;
}
```

Then render it next to `ToolPalette` in the Toolbar container (the file found via grep), e.g. `<ToolPalette /><PrimitiveOptions />`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/ui/components/Toolbar/PrimitiveOptions.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/Toolbar/PrimitiveOptions.tsx src/ui/components/Toolbar/PrimitiveOptions.test.tsx src/ui/components/Toolbar/
git commit -m "feat(primitives): tool-options row (sides/points/inner ratio)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: e2e — stamp a star, morph it, export, assert it animates

**Files:**
- Create: `e2e/primitives.spec.ts` (match the existing e2e directory/naming — `grep -rn "test(" e2e/*.spec.ts | head` and copy a sibling's structure, e.g. the motion-path or morph spec).

**Interfaces:**
- Consumes: the full app (real chromium). Reuse the export+assert helpers the existing e2e specs use verbatim.

- [ ] **Step 1: Write the test**

```ts
// e2e/primitives.spec.ts — adapt to the existing spec harness (page setup, export trigger,
// and bundle-assertion helpers). The shape of the test:
import { test, expect } from '@playwright/test';

test('a stamped star can be morph-animated and the export animates', async ({ page }) => {
  // 1. open the app (reuse the sibling spec's beforeEach / goto + ready wait)
  // 2. activate the Star tool (click the "Star" palette button)
  await page.getByRole('button', { name: 'Star' }).click();
  // 3. drag on the stage to stamp a star (reuse the sibling spec's stage-drag helper:
  //    pointerDown at center, move out by ~60px, pointerUp)
  // 4. with the new path selected (addVectorPath selects it + switches to node tool),
  //    add a shape keyframe, move the playhead, node-edit (or add another shape kf) so the
  //    path morphs — copy the exact morph-authoring steps from the morph e2e spec
  // 5. export and load the bundle (reuse the export+serve helper)
  // 6. assert the exported shape's `d` (or wrapper transform) differs between two frames
  //    — i.e. it animates — using the same assertion approach as the morph spec
});
```

Fill the comments in by copying the concrete steps from the existing morph/motion e2e spec (palette click, stage drag helper, add-shape-keyframe, playhead seek, export, and the "path animates between frames" assertion). Do not invent new helpers.

- [ ] **Step 2: Run the e2e**

Run: `pnpm test:e2e e2e/primitives.spec.ts` (use the repo's actual e2e script — `grep -n "e2e\|playwright" package.json`).
Expected: PASS (real chromium proves preview==export for a stamped primitive).

- [ ] **Step 3: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm test:e2e`
Expected: all clean/green.

- [ ] **Step 4: Commit**

```bash
git add e2e/primitives.spec.ts
git commit -m "test(e2e): stamped star morph-animates in the exported bundle

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review (UI plan vs spec)

- Spec §6 ToolMode + tool-option state/setters with clamps — Task 1. ✅
- Spec §6 "no new creation action; reuse `addVectorPath`" — Tasks 4/5 route generated `PathData` through `addVectorPath`. ✅
- Spec §7 click-drag stamp (center+radius for polygon/star, endpoints for line), live preview, sub-threshold cancel, single undo step (one `addVectorPath` commit) — Tasks 4/5. ✅
- Spec §8 palette buttons (Task 3), G/S/L shortcuts free & wired (Task 2), tool-options row (Task 6). ✅
- Spec §9 export/runtime/persistence unchanged — no edits to those layers; primitives are paths. ✅
- Spec §10 testing: engine parity (sibling plan), store, interaction, keyboard, e2e — Tasks 1–7. ✅
- Type consistency: `primitivePathFromDrag(tool, start, end, opts, minSize)` signature identical in Task 4 (def), Task 5 (Stage calls). Store fields `polygonSides`/`starPoints`/`starInnerRatio` + setters identical across Tasks 1/5/6. `ToolMode` union identical in Task 1 and consumed unchanged elsewhere. ✅

**Implementation notes for the executor:** Several tasks say "match the existing test harness / testid / e2e helper." Read the neighboring file first and copy its setup verbatim — do not invent testids or helpers. Defaults that could collide (none found) and shortcuts (G/S/L confirmed free) are pinned in Global Constraints.
