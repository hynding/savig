# M2 Slice 1 — Plan B: UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the editor UI for drawing, selecting, resizing, styling, and animating vector shapes (rect/ellipse) on top of the Plan A engine/pipeline — tool palette, click-drag draw, rotation-aware on-canvas resize handles, Inspector geometry + style controls — proven end-to-end by a Playwright export-parity e2e.

**Architecture:** A new ephemeral `activeTool` in the Zustand store gates Stage pointer behavior. Drawing commits a `VectorAsset` + `SceneObject` (static `shapeBase`, fractional anchor) in one undo step. The editor's imperative painter is unified onto the runtime's `computeFrame`/`applyFrameToNodes` so preview geometry == export. Resize handles render in the object's local space (browser-applied transform) and map the pointer back to local space via `getScreenCTM().inverse()`, so rotation/scale/zoom are handled without manual matrix math; the opposite-corner-fixed resize math lives in a pure, unit-tested module.

**Tech Stack:** React 18 + TS (strict) · Zustand · Vitest + RTL (jsdom) · Playwright · CSS Modules. Engine stays pure; UI/runtime may use DOM.

## Global Constraints

- **preview == export:** the editor must paint frames using the SAME `computeFrame` the export runtime uses. Do not fork the sampling/render mapping.
- **Engine purity:** do not add React/DOM to `src/engine/`. New UI helpers live under `src/ui/`; pure geometry helpers may live in `src/ui/components/Stage/`.
- **Undo discipline:** drawing a shape is ONE undo entry (asset + object together). A handle drag is ONE undo entry (commit once on pointer-up; live preview is imperative, uncommitted) — mirror the existing move-drag pattern in `Stage.tsx`.
- **Auto-key parity:** geometry/transform edits go through `setProperties` (keyframes at the snapped current time, gated on `autoKey`), exactly like existing transform editing. Style edits and shape creation are NOT gated on autoKey (they are not animated).
- **Vector assets are NOT shown in the Asset panel** this slice.
- **Determinism:** numeric SVG output via `fmt()` (already enforced inside `renderShapeToSvg`/`buildTransform`).
- **TDD; TypeScript strict.** Commands: `pnpm test`, `pnpm vitest run <path>`, `pnpm typecheck`, `pnpm lint`, `pnpm build:runtime`, `pnpm e2e`.
- **Commit convention:** Conventional Commits; end every message with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Branch:** create `m2-vector-ui` off `main` before Task 1.

---

### Task 1: Store — active tool state

**Files:**
- Modify: `src/ui/store/store.ts`
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Produces: `type ToolMode = 'select' | 'rect' | 'ellipse'` (exported); `activeTool: ToolMode` state (default `'select'`, transient); `setActiveTool(tool: ToolMode): void`.

- [ ] **Step 1: Write the failing test**

Add to `src/ui/store/store.test.ts`:

```ts
describe('activeTool', () => {
  it('defaults to select and can be changed', () => {
    expect(useEditor.getState().activeTool).toBe('select');
    useEditor.getState().setActiveTool('rect');
    expect(useEditor.getState().activeTool).toBe('rect');
  });

  it('resets to select on newProject', () => {
    useEditor.getState().setActiveTool('ellipse');
    useEditor.getState().newProject();
    expect(useEditor.getState().activeTool).toBe('select');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/store/store.test.ts`
Expected: FAIL — `activeTool`/`setActiveTool` undefined.

- [ ] **Step 3: Implement**

In `src/ui/store/store.ts`, add the type near the top (after `Theme`):

```ts
export type ToolMode = 'select' | 'rect' | 'ellipse';
```

Add to the `EditorState` interface (in the transient view-actions area):

```ts
  activeTool: ToolMode;
  setActiveTool(tool: ToolMode): void;
```

Add to `TRANSIENT_DEFAULTS`:

```ts
  activeTool: 'select' as ToolMode,
```

Add the action (near `setZoom`/`setPan`):

```ts
  setActiveTool(tool) {
    set({ activeTool: tool });
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/ui/store/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(ui): add activeTool state to the editor store

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Store — addVectorShape (atomic create)

**Files:**
- Modify: `src/ui/store/store.ts`
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Consumes: `createVectorAsset`, `DEFAULT_TRANSFORM` (engine); `ToolMode` (Task 1).
- Produces: `addVectorShape(shapeType: VectorShapeType, bounds: { x: number; y: number; width: number; height: number }): void` — creates a `VectorAsset` + `SceneObject` (anchorMode `'fraction'`, anchor 0.5/0.5, `base.x/y` = bounds.x/y, `shapeBase` = rect width/height OR ellipse radiusX/radiusY = half-bounds), one commit, selects the new object, switches `activeTool` to `'select'`.

- [ ] **Step 1: Write the failing test**

Add to `src/ui/store/store.test.ts`:

```ts
describe('addVectorShape', () => {
  it('creates a rect asset+object in one undo step and selects it', () => {
    useEditor.getState().newProject();
    const before = useEditor.getState().history;
    useEditor.getState().addVectorShape('rect', { x: 10, y: 20, width: 100, height: 50 });
    const s = useEditor.getState();
    const project = s.history.present;
    expect(project.assets).toHaveLength(1);
    expect(project.assets[0].kind).toBe('vector');
    expect(project.objects).toHaveLength(1);
    const obj = project.objects[0];
    expect(obj.assetId).toBe(project.assets[0].id);
    expect(obj.anchorMode).toBe('fraction');
    expect(obj.base.x).toBe(10);
    expect(obj.base.y).toBe(20);
    expect(obj.shapeBase).toEqual({ width: 100, height: 50 });
    expect(s.selectedObjectId).toBe(obj.id);
    expect(s.activeTool).toBe('select');
    // one undo step: undoing returns to the pre-draw present
    useEditor.getState().undo();
    expect(useEditor.getState().history.present).toEqual(before.present);
  });

  it('stores ellipse geometry as half-bounds radii', () => {
    useEditor.getState().newProject();
    useEditor.getState().addVectorShape('ellipse', { x: 0, y: 0, width: 60, height: 40 });
    expect(useEditor.getState().history.present.objects[0].shapeBase).toEqual({ radiusX: 30, radiusY: 20 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/store/store.test.ts`
Expected: FAIL — `addVectorShape` undefined.

- [ ] **Step 3: Implement**

In `src/ui/store/store.ts`, extend the engine import to add `createVectorAsset` and `DEFAULT_TRANSFORM`:

```ts
  createVectorAsset,
  DEFAULT_TRANSFORM,
```

Extend the type import to add `VectorShapeType`:

```ts
import type { AnimatableProperty, Asset, History, Project, SceneObject, VectorShapeType, VectorStyle } from '../../engine';
```

Add to `EditorState` (document actions):

```ts
  addVectorShape(shapeType: VectorShapeType, bounds: { x: number; y: number; width: number; height: number }): void;
```

Add the action (near `addObject`):

```ts
  addVectorShape(shapeType, bounds) {
    const project = get().history.present;
    const asset = createVectorAsset(shapeType);
    const shapeBase =
      shapeType === 'ellipse'
        ? { radiusX: bounds.width / 2, radiusY: bounds.height / 2 }
        : { width: bounds.width, height: bounds.height };
    const obj = createSceneObject(asset.id, {
      name: `${asset.name} ${project.objects.length + 1}`,
      zOrder: project.objects.length,
      anchorMode: 'fraction',
      anchorX: 0.5,
      anchorY: 0.5,
      base: { ...DEFAULT_TRANSFORM, x: bounds.x, y: bounds.y },
      shapeBase,
    });
    get().commit({
      ...project,
      assets: [...project.assets, asset],
      objects: [...project.objects, obj],
    });
    set({ selectedObjectId: obj.id, selectedKeyframe: null, activeTool: 'select' });
  },
```

> `VectorStyle` is imported now because Task 8 adds `setVectorStyle` to the same import; add it here to avoid a second edit. If your linter flags it as unused until Task 8, add `setVectorStyle` in Task 8 as planned.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/ui/store/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(ui): addVectorShape store action (atomic asset+object create)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

> If the unused-import lint on `VectorStyle` blocks this commit, drop `VectorStyle` from the import here and re-add it in Task 8.

---

### Task 3: Tool palette + keyboard shortcuts

**Files:**
- Create: `src/ui/components/Toolbar/ToolPalette.tsx`
- Create: `src/ui/components/Toolbar/ToolPalette.module.css`
- Create: `src/ui/components/Toolbar/ToolPalette.test.tsx`
- Modify: `src/ui/App.tsx`
- Modify: `src/ui/hooks/useKeyboard.ts`
- Test: `src/ui/hooks/useKeyboard.test.ts`

**Interfaces:**
- Consumes: `activeTool`, `setActiveTool` (Task 1).
- Produces: `<ToolPalette/>` with three buttons (Select / Rectangle / Ellipse), `aria-pressed` reflecting `activeTool`; keyboard `V`/`R`/`E` set the tool, `Escape` returns to select.

- [ ] **Step 1: Write the failing component test**

Create `src/ui/components/Toolbar/ToolPalette.test.tsx`:

```tsx
import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToolPalette } from './ToolPalette';
import { useEditor } from '../../store/store';

beforeEach(() => useEditor.getState().newProject());

describe('ToolPalette', () => {
  it('reflects and sets the active tool', async () => {
    render(<ToolPalette />);
    const rect = screen.getByRole('button', { name: 'Rectangle' });
    expect(rect).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(rect);
    expect(rect).toHaveAttribute('aria-pressed', 'true');
    expect(useEditor.getState().activeTool).toBe('rect');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/components/Toolbar/ToolPalette.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the component**

Create `src/ui/components/Toolbar/ToolPalette.module.css`:

```css
.bar { display: flex; gap: 4px; }
.btn {
  padding: 4px 10px;
  background: var(--surface-2);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
}
.btn[aria-pressed='true'] { background: var(--accent); color: var(--accent-contrast); }
```

> If a token name above does not exist in `src/ui/theme/tokens.css`, substitute the nearest existing token (check the file); styling is not asserted by tests.

Create `src/ui/components/Toolbar/ToolPalette.tsx`:

```tsx
import { useEditor } from '../../store/store';
import type { ToolMode } from '../../store/store';
import styles from './ToolPalette.module.css';

const TOOLS: { id: ToolMode; label: string }[] = [
  { id: 'select', label: 'Select' },
  { id: 'rect', label: 'Rectangle' },
  { id: 'ellipse', label: 'Ellipse' },
];

export function ToolPalette() {
  const activeTool = useEditor((s) => s.activeTool);
  const setActiveTool = useEditor((s) => s.setActiveTool);
  return (
    <div className={styles.bar} role="group" aria-label="Tools">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={styles.btn}
          aria-pressed={activeTool === t.id}
          onClick={() => setActiveTool(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Wire into App**

In `src/ui/App.tsx`, add the import:

```tsx
import { ToolPalette } from './components/Toolbar/ToolPalette';
```

In the toolbar `<section>`, add `<ToolPalette />` after `<TransportControls />`:

```tsx
        <TransportControls />
        <ToolPalette />
        <span className={styles.spacer} />
```

- [ ] **Step 5: Add keyboard shortcuts (failing test first)**

Add to `src/ui/hooks/useKeyboard.test.ts`. That file already mounts the hook in `beforeEach` via `renderHook(() => useKeyboard())` and drives it with `fireEvent.keyDown(window, …)`, so the new test only dispatches keys:

```ts
it('sets tools via V/R/E and Escape returns to select', () => {
  fireEvent.keyDown(window, { key: 'r' });
  expect(useEditor.getState().activeTool).toBe('rect');
  fireEvent.keyDown(window, { key: 'e' });
  expect(useEditor.getState().activeTool).toBe('ellipse');
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(useEditor.getState().activeTool).toBe('select');
});
```

- [ ] **Step 6: Run the keyboard test to verify it fails**

Run: `pnpm vitest run src/ui/hooks/useKeyboard.test.ts`
Expected: FAIL — tool keys do nothing.

- [ ] **Step 7: Implement shortcuts**

In `src/ui/hooks/useKeyboard.ts`, add these cases to the `switch (e.key)` block (before `default`):

```ts
        case 'v': case 'V': s.setActiveTool('select'); break;
        case 'r': case 'R': s.setActiveTool('rect'); break;
        case 'e': case 'E': s.setActiveTool('ellipse'); break;
        case 'Escape': s.setActiveTool('select'); break;
```

- [ ] **Step 8: Run tests + typecheck + lint**

Run: `pnpm vitest run src/ui/components/Toolbar/ToolPalette.test.tsx src/ui/hooks/useKeyboard.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS, clean.

- [ ] **Step 9: Commit**

```bash
git add src/ui/components/Toolbar src/ui/App.tsx src/ui/hooks/useKeyboard.ts src/ui/hooks/useKeyboard.test.ts
git commit -m "feat(ui): tool palette + V/R/E/Escape tool shortcuts

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Unify the editor painter on computeFrame

**Files:**
- Modify: `src/runtime/frame.ts` (move `applyFrameToNodes` here)
- Modify: `src/runtime/index.ts` (import it from `./frame`)
- Modify: `src/ui/playback/applyFrame.ts` (reuse `computeFrame` + `applyFrameToNodes`)
- Regenerate: `src/runtime/runtimeSource.generated.ts`
- Test: `src/ui/playback/applyFrame.test.ts`

**Interfaces:**
- Consumes: `computeFrame`, `FrameItem` (runtime/frame).
- Produces: `applyFrameToNodes(nodes: Map<string, Element>, items: FrameItem[]): void` now exported from `src/runtime/frame.ts` (no module side effects); editor `applyFrame` delegates to it so editor preview geometry/anchor == runtime/export.

- [ ] **Step 1: Move applyFrameToNodes into frame.ts**

In `src/runtime/frame.ts`, append (after `computeFrame`):

```ts
// Applies a computed frame to live SVG nodes. Wrapper nodes
// (`[data-savig-object]`) take transform/opacity; vector objects also update the
// inner shape element (the wrapper's only child) with the geometry attributes.
// Shared by the standalone runtime player AND the editor's imperative painter.
export function applyFrameToNodes(nodes: Map<string, Element>, items: FrameItem[]): void {
  for (const item of items) {
    const node = nodes.get(item.objectId);
    if (!node) continue;
    node.setAttribute('transform', item.transform);
    node.setAttribute('opacity', item.opacity);
    if (item.geometry) {
      const shape = node.firstElementChild;
      if (shape) {
        for (const [attr, value] of Object.entries(item.geometry)) {
          shape.setAttribute(attr, value);
        }
      }
    }
  }
}
```

In `src/runtime/index.ts`, remove the local `applyFrameToNodes` definition and import it instead:

```ts
import { applyFrameToNodes, computeFrame, type FrameItem } from './frame';
```

(Remove the now-unused inline function body; `create()`'s `apply` closure keeps calling `applyFrameToNodes(nodes, computeFrame(project, time))`. If `FrameItem` is no longer referenced in index.ts, drop it from the import.)

- [ ] **Step 2: Point the runtime index test at the new location**

In `src/runtime/index.test.ts`, change the import to:

```ts
import { applyFrameToNodes } from './frame';
```

Run: `pnpm vitest run src/runtime/index.test.ts`
Expected: PASS (same behavior, new location).

- [ ] **Step 3: Write the failing editor-painter test**

Replace `src/ui/playback/applyFrame.test.ts`'s coverage by ADDING a geometry case (keep existing transform/opacity tests). Add:

```ts
import { createProject, createSceneObject, createVectorAsset } from '../../engine';

it('paints geometry onto a vector object inner shape', () => {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const project = createProject();
  project.assets.push(createVectorAsset('rect', { id: 'vr' }));
  const obj = createSceneObject('vr', {
    id: 'o1', anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5,
    shapeBase: { width: 80, height: 40 },
  });
  project.objects.push(obj);

  const g = document.createElementNS(SVG_NS, 'g');
  const rect = document.createElementNS(SVG_NS, 'rect');
  g.appendChild(rect);
  const nodes = new Map<string, SVGGraphicsElement>([['o1', g as unknown as SVGGraphicsElement]]);

  applyFrame(nodes, project, 0);
  expect(rect.getAttribute('width')).toBe('80');
  expect(rect.getAttribute('height')).toBe('40');
});
```

> Read the existing `applyFrame.test.ts` imports; `applyFrame` is already imported there.

- [ ] **Step 4: Run to verify it fails**

Run: `pnpm vitest run src/ui/playback/applyFrame.test.ts`
Expected: FAIL — current applyFrame doesn't set geometry.

- [ ] **Step 5: Reimplement editor applyFrame**

Replace `src/ui/playback/applyFrame.ts` with:

```ts
import { applyFrameToNodes, computeFrame } from '../../runtime/frame';
import type { Project } from '../../engine';

// The editor's imperative paint path. Delegates to the SAME computeFrame +
// applyFrameToNodes the standalone runtime uses, so the live preview matches the
// exported bundle byte-for-byte — including animated geometry and fractional anchors.
export function applyFrame(
  nodes: Map<string, SVGGraphicsElement>,
  project: Project,
  time: number,
): void {
  applyFrameToNodes(nodes, computeFrame(project, time));
}
```

- [ ] **Step 6: Regenerate the runtime bundle**

Run: `pnpm build:runtime`
Then: `grep -c "applyFrameToNodes" src/runtime/runtimeSource.generated.ts` → expect ≥ 1.

- [ ] **Step 7: Full suite + typecheck + lint**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all green. (Existing applyFrame transform/opacity tests still pass — computeFrame produces identical transform for SVG objects.)

- [ ] **Step 8: Commit**

```bash
git add src/runtime/frame.ts src/runtime/index.ts src/runtime/index.test.ts src/runtime/runtimeSource.generated.ts src/ui/playback/applyFrame.ts src/ui/playback/applyFrame.test.ts
git commit -m "refactor(ui): unify editor painter on computeFrame/applyFrameToNodes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Stage renders vector objects inline

**Files:**
- Modify: `src/ui/components/Stage/Stage.tsx`
- Test: `src/ui/components/Stage/Stage.test.tsx`

**Interfaces:**
- Consumes: `renderShapeToSvg`, `sampleObject` (engine); `applyFrame` (Task 4).
- Produces: vector objects render as `<g data-savig-object data-testid="object-ID"><shape/></g>` (inner shape from `renderShapeToSvg`); SVG objects keep rendering as `<use>`. Both register the same ref into the nodes map.

- [ ] **Step 1: Write the failing test**

Add to `src/ui/components/Stage/Stage.test.tsx` (the file imports `render, screen, fireEvent`; mount with a fresh nodes map exactly like the existing tests):

```tsx
it('renders a vector object as an inline <g> with an inner shape', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 50, height: 30 });
  const id = useEditor.getState().history.present.objects[0].id;
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  const node = screen.getByTestId(`object-${id}`);
  expect(node.tagName.toLowerCase()).toBe('g');
  expect(node.querySelector('rect')).not.toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx`
Expected: FAIL — vector object renders as `<use>` with no inner shape.

- [ ] **Step 3: Implement**

In `src/ui/components/Stage/Stage.tsx`, add imports:

```ts
import { buildTransform, renderShapeToSvg, sampleObject } from '../../../engine';
```

(extend the existing `buildTransform, sampleObject` import to add `renderShapeToSvg`.)

Add an assets lookup memo near the other memos:

```ts
  const assetsById = useMemo(
    () => new Map(project.assets.map((a) => [a.id, a] as const)),
    [project.assets],
  );
```

Replace the `ordered.map((o) => (<use .../>))` block with a branch:

```tsx
          {ordered.map((o) => {
            const asset = assetsById.get(o.assetId);
            if (asset?.kind === 'vector') {
              const geometry = sampleObject(o, time).geometry ?? {};
              return (
                <g
                  key={o.id}
                  ref={register(o.id)}
                  data-testid={`object-${o.id}`}
                  data-savig-object={o.id}
                  data-selected={o.id === selectedId}
                  className={styles.object}
                  onPointerDown={(e) => onObjectPointerDown(o.id, e)}
                  dangerouslySetInnerHTML={{
                    __html: renderShapeToSvg(asset.shapeType, geometry, asset.style),
                  }}
                />
              );
            }
            return (
              <use
                key={o.id}
                ref={register(o.id)}
                data-testid={`object-${o.id}`}
                data-savig-object={o.id}
                data-selected={o.id === selectedId}
                className={styles.object}
                href={`#savig-asset-${o.assetId}`}
                onPointerDown={(e) => onObjectPointerDown(o.id, e)}
              />
            );
          })}
```

> Note: `register`'s callback type is `(el: SVGGraphicsElement | null) => void`; both `SVGGElement` and `SVGUseElement` satisfy it. The `<g>`'s inner shape is replaced by React on re-render and re-painted imperatively by `applyFrame`; the two agree because both derive geometry from the same engine functions.

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx && pnpm typecheck`
Expected: PASS (existing `<use>` SVG tests still pass).

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/Stage/Stage.tsx src/ui/components/Stage/Stage.test.tsx
git commit -m "feat(ui): render vector objects inline on the Stage

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Draw interaction (click-drag to create)

**Files:**
- Create: `src/ui/components/Stage/drawGeometry.ts`
- Create: `src/ui/components/Stage/drawGeometry.test.ts`
- Modify: `src/ui/components/Stage/Stage.tsx`
- Test: `src/ui/components/Stage/Stage.test.tsx`

**Interfaces:**
- Consumes: `addVectorShape`, `activeTool` (store); `clientToLocal` via `getScreenCTM` on the content `<g>`.
- Produces: pure `rectFromDrag(start, end, minSize): Bounds | null`; Stage draws a live preview while `activeTool` is rect/ellipse and commits via `addVectorShape` on pointer-up.

- [ ] **Step 1: Write the failing pure-helper test**

Create `src/ui/components/Stage/drawGeometry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { rectFromDrag } from './drawGeometry';

describe('rectFromDrag', () => {
  it('builds bounds from a top-left to bottom-right drag', () => {
    expect(rectFromDrag({ x: 10, y: 20 }, { x: 110, y: 70 }, 3)).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it('normalizes a bottom-right to top-left (negative) drag', () => {
    expect(rectFromDrag({ x: 110, y: 70 }, { x: 10, y: 20 }, 3)).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it('returns null for a sub-threshold drag', () => {
    expect(rectFromDrag({ x: 10, y: 10 }, { x: 11, y: 11 }, 3)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/ui/components/Stage/drawGeometry.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the pure helper**

Create `src/ui/components/Stage/drawGeometry.ts`:

```ts
export interface Point {
  x: number;
  y: number;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Normalizes a drag (either direction) into a positive-extent box. Returns null
// when either dimension is below minSize (a degenerate click, not a shape).
export function rectFromDrag(start: Point, end: Point, minSize: number): Bounds | null {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  if (width < minSize || height < minSize) return null;
  return { x, y, width, height };
}
```

- [ ] **Step 4: Wire drawing into the Stage**

In `src/ui/components/Stage/Stage.tsx`:

Add imports:

```ts
import { rectFromDrag, type Point } from './drawGeometry';
```

Add a constant near the top of the module (outside the component):

```ts
const MIN_DRAW_SIZE = 3;
```

Add a ref to the content `<g>` (the one with the pan/zoom transform) and a draw ref + preview ref inside the component:

```ts
  const contentRef = useRef<SVGGElement | null>(null);
  const drawRef = useRef<{ start: Point } | null>(null);
  const previewRef = useRef<SVGRectElement | null>(null);
```

Add a helper inside the component to map client coords to stage-local coords:

```ts
  const clientToLocal = (clientX: number, clientY: number): Point | null => {
    const g = contentRef.current;
    const ctm = g?.getScreenCTM();
    if (!g || !ctm) return null;
    const svg = g.ownerSVGElement;
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const local = pt.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  };
```

Update `onBackgroundPointerDown` to start a draw when a shape tool is active:

```ts
  const onBackgroundPointerDown = (e: ReactPointerEvent) => {
    const s = useEditor.getState();
    if (e.button === 1) {
      panRef.current = { x: e.clientX, y: e.clientY, panX: s.pan.x, panY: s.pan.y };
      return;
    }
    if (s.activeTool !== 'select') {
      const start = clientToLocal(e.clientX, e.clientY);
      if (start) drawRef.current = { start };
      return;
    }
    selectObject(null);
  };
```

In the existing window `pointermove` handler (inside the `useEffect`), handle draw preview FIRST (before pan/drag), updating the preview rect attributes:

```ts
      const draw = drawRef.current;
      if (draw) {
        const cur = clientToLocal(e.clientX, e.clientY);
        const rect = previewRef.current;
        if (cur && rect) {
          const b = {
            x: Math.min(draw.start.x, cur.x),
            y: Math.min(draw.start.y, cur.y),
            width: Math.abs(cur.x - draw.start.x),
            height: Math.abs(cur.y - draw.start.y),
          };
          rect.setAttribute('x', String(b.x));
          rect.setAttribute('y', String(b.y));
          rect.setAttribute('width', String(b.width));
          rect.setAttribute('height', String(b.height));
          rect.setAttribute('visibility', 'visible');
        }
        return;
      }
```

In the window `pointerup` handler, commit the draw:

```ts
      const draw = drawRef.current;
      if (draw) {
        drawRef.current = null;
        if (previewRef.current) previewRef.current.setAttribute('visibility', 'hidden');
        // Recover the end point from the last preview rect, or skip if none.
        const s = useEditor.getState();
        const rect = previewRef.current;
        if (rect && rect.getAttribute('width')) {
          const end = {
            x: Number(rect.getAttribute('x')) + Number(rect.getAttribute('width')),
            y: Number(rect.getAttribute('y')) + Number(rect.getAttribute('height')),
          };
          const bounds = rectFromDrag(draw.start, end, MIN_DRAW_SIZE);
          if (bounds && s.activeTool !== 'select') s.addVectorShape(s.activeTool, bounds);
        }
        return;
      }
```

> Simpler/robust alternative if reading attributes back feels brittle: store the latest `cur` point on `drawRef.current.end` during move and use it on up. Implement whichever is cleaner; the test below asserts the committed result, not the mechanism.

Attach the content ref and render the preview rect. Change the content `<g>` opening tag to include the ref, and add the preview rect as its first child:

```tsx
        <g ref={contentRef} transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          <defs dangerouslySetInnerHTML={{ __html: defs }} />
          <rect
            ref={previewRef}
            data-testid="draw-preview"
            visibility="hidden"
            fill="none"
            stroke="var(--accent)"
            strokeDasharray="4 2"
            pointerEvents="none"
          />
```

- [ ] **Step 5: Write the failing Stage draw test**

Add to `src/ui/components/Stage/Stage.test.tsx`:

```tsx
it('commits a vector shape when drawing with the rect tool', () => {
  useEditor.getState().newProject();
  useEditor.getState().setActiveTool('rect');
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  // jsdom lacks getScreenCTM; drive the store path the wiring uses instead.
  useEditor.getState().addVectorShape('rect', { x: 5, y: 5, width: 40, height: 40 });
  expect(useEditor.getState().history.present.objects).toHaveLength(1);
  expect(useEditor.getState().activeTool).toBe('select');
});
```

> jsdom does not implement `getScreenCTM`, so the pointer→local mapping and live preview are validated by the Playwright e2e (Task 9), not here. This unit test pins the store contract the wiring depends on. Keep the `rectFromDrag` unit tests as the coverage for the normalization/min-size logic.

- [ ] **Step 6: Run tests + typecheck + lint**

Run: `pnpm vitest run src/ui/components/Stage && pnpm typecheck && pnpm lint`
Expected: PASS, clean.

- [ ] **Step 7: Commit**

```bash
git add src/ui/components/Stage/drawGeometry.ts src/ui/components/Stage/drawGeometry.test.ts src/ui/components/Stage/Stage.tsx src/ui/components/Stage/Stage.test.tsx
git commit -m "feat(ui): click-drag to draw rect/ellipse shapes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Rotation-aware resize handles

**Files:**
- Create: `src/ui/components/Stage/resizeHandles.ts`
- Create: `src/ui/components/Stage/resizeHandles.test.ts`
- Modify: `src/ui/components/Stage/Stage.tsx`
- Test: `src/ui/components/Stage/Stage.test.tsx`

**Interfaces:**
- Consumes: `buildTransform`, `resolveAnchor`, `sampleObject`, `geometryToSvgAttrs` (engine); `setProperties` (store).
- Produces:
  - `type HandleId = 'nw'|'n'|'ne'|'e'|'se'|'s'|'sw'|'w'`; `HANDLE_IDS: readonly HandleId[]`.
  - `handleLocalPositions(width, height): Record<HandleId,{x:number;y:number}>`.
  - `applyHandleResize(input): { width:number; height:number; baseX:number; baseY:number }` — pure; resizes the bbox keeping the opposite edge/corner fixed in stage space, compensating `base` for rotation/scale.

- [ ] **Step 1: Write the failing pure-math test**

Create `src/ui/components/Stage/resizeHandles.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { applyHandleResize, handleLocalPositions } from './resizeHandles';

// Stage position of a local point under the object transform, using the same
// closed form the engine uses: M(p) = base + A + RS*(p - A), A = (fx*W, fy*H).
function stagePos(
  p: { x: number; y: number },
  o: { W: number; H: number; fx: number; fy: number; bx: number; by: number; sx: number; sy: number; deg: number },
) {
  const Ax = o.fx * o.W, Ay = o.fy * o.H;
  const t = (o.deg * Math.PI) / 180;
  const c = Math.cos(t), s = Math.sin(t);
  const vx = p.x - Ax, vy = p.y - Ay;
  return { x: o.bx + Ax + (c * o.sx * vx - s * o.sy * vy), y: o.by + Ay + (s * o.sx * vx + c * o.sy * vy) };
}

describe('handleLocalPositions', () => {
  it('places 8 handles around the bbox', () => {
    const p = handleLocalPositions(100, 40);
    expect(p.nw).toEqual({ x: 0, y: 0 });
    expect(p.se).toEqual({ x: 100, y: 40 });
    expect(p.n).toEqual({ x: 50, y: 0 });
    expect(p.e).toEqual({ x: 100, y: 20 });
  });
});

describe('applyHandleResize', () => {
  const base = { width: 100, height: 40, anchorFracX: 0.5, anchorFracY: 0.5, baseX: 10, baseY: 20, scaleX: 1, scaleY: 1, minSize: 1 };

  it('SE drag (no rotation) resizes and leaves base unchanged (NW fixed)', () => {
    const r = applyHandleResize({ ...base, handle: 'se', localX: 150, localY: 80, rotationDeg: 0 });
    expect(r.width).toBe(150);
    expect(r.height).toBe(80);
    expect(r.baseX).toBeCloseTo(10);
    expect(r.baseY).toBeCloseTo(20);
  });

  it('NW drag (no rotation) keeps the SE corner fixed in stage space', () => {
    const o = { W: 100, H: 40, fx: 0.5, fy: 0.5, bx: 10, by: 20, sx: 1, sy: 1, deg: 0 };
    const seBefore = stagePos({ x: 100, y: 40 }, o);
    const r = applyHandleResize({ ...base, handle: 'nw', localX: 30, localY: 10, rotationDeg: 0 });
    const seAfter = stagePos({ x: r.width, y: r.height }, { ...o, W: r.width, H: r.height, bx: r.baseX, by: r.baseY });
    expect(seAfter.x).toBeCloseTo(seBefore.x);
    expect(seAfter.y).toBeCloseTo(seBefore.y);
  });

  it('NW drag with rotation keeps the SE corner fixed in stage space', () => {
    const o = { W: 100, H: 40, fx: 0.5, fy: 0.5, bx: 10, by: 20, sx: 1, sy: 1, deg: 30 };
    const seBefore = stagePos({ x: 100, y: 40 }, o);
    const r = applyHandleResize({ ...base, handle: 'nw', localX: 25, localY: 8, rotationDeg: 30 });
    const seAfter = stagePos({ x: r.width, y: r.height }, { ...o, W: r.width, H: r.height, bx: r.baseX, by: r.baseY });
    expect(seAfter.x).toBeCloseTo(seBefore.x);
    expect(seAfter.y).toBeCloseTo(seBefore.y);
  });

  it('clamps to minSize', () => {
    const r = applyHandleResize({ ...base, handle: 'se', localX: -5, localY: -5, rotationDeg: 0 });
    expect(r.width).toBe(1);
    expect(r.height).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/ui/components/Stage/resizeHandles.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the pure module**

Create `src/ui/components/Stage/resizeHandles.ts`:

```ts
export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const HANDLE_IDS: readonly HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export function handleLocalPositions(width: number, height: number): Record<HandleId, { x: number; y: number }> {
  return {
    nw: { x: 0, y: 0 },
    n: { x: width / 2, y: 0 },
    ne: { x: width, y: 0 },
    e: { x: width, y: height / 2 },
    se: { x: width, y: height },
    s: { x: width / 2, y: height },
    sw: { x: 0, y: height },
    w: { x: 0, y: height / 2 },
  };
}

export interface ResizeInput {
  handle: HandleId;
  /** Pointer in the object's OLD local coordinates. */
  localX: number;
  localY: number;
  /** Current bbox extent (rect: width/height; ellipse: 2*radiusX/2*radiusY). */
  width: number;
  height: number;
  anchorFracX: number;
  anchorFracY: number;
  baseX: number;
  baseY: number;
  scaleX: number;
  scaleY: number;
  rotationDeg: number;
  minSize: number;
}

export interface ResizeResult {
  width: number;
  height: number;
  baseX: number;
  baseY: number;
}

// Resizes the bbox so the edge/corner OPPOSITE the dragged handle stays fixed in
// stage space. Because the rotate/scale pivot (anchor) moves with the geometry,
// base is compensated:  base' = base + (A - A') + RS * [ (Fo - Fn) + (A' - A) ]
// where A/A' are old/new absolute anchors, Fo/Fn the fixed edge in old/new local
// coords, and RS = R(deg) * diag(scaleX, scaleY).
export function applyHandleResize(i: ResizeInput): ResizeResult {
  const movesLeft = i.handle === 'nw' || i.handle === 'w' || i.handle === 'sw';
  const movesRight = i.handle === 'ne' || i.handle === 'e' || i.handle === 'se';
  const movesTop = i.handle === 'nw' || i.handle === 'n' || i.handle === 'ne';
  const movesBottom = i.handle === 'sw' || i.handle === 's' || i.handle === 'se';

  let w2 = i.width;
  if (movesRight) w2 = Math.max(i.minSize, i.localX);
  else if (movesLeft) w2 = Math.max(i.minSize, i.width - i.localX);

  let h2 = i.height;
  if (movesBottom) h2 = Math.max(i.minSize, i.localY);
  else if (movesTop) h2 = Math.max(i.minSize, i.height - i.localY);

  const foX = movesLeft ? i.width : 0;
  const foY = movesTop ? i.height : 0;
  const fnX = movesLeft ? w2 : 0;
  const fnY = movesTop ? h2 : 0;

  const ax = i.anchorFracX * i.width;
  const ay = i.anchorFracY * i.height;
  const a2x = i.anchorFracX * w2;
  const a2y = i.anchorFracY * h2;

  const t = (i.rotationDeg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const vx = foX - fnX + (a2x - ax);
  const vy = foY - fnY + (a2y - ay);
  const rsx = c * i.scaleX * vx - s * i.scaleY * vy;
  const rsy = s * i.scaleX * vx + c * i.scaleY * vy;

  return {
    width: w2,
    height: h2,
    baseX: i.baseX + (ax - a2x) + rsx,
    baseY: i.baseY + (ay - a2y) + rsy,
  };
}
```

- [ ] **Step 4: Run the math test to verify it passes**

Run: `pnpm vitest run src/ui/components/Stage/resizeHandles.test.ts`
Expected: PASS (all four cases, including the rotated fixed-corner invariant).

- [ ] **Step 5: Wire handles into the Stage**

In `src/ui/components/Stage/Stage.tsx`:

Add imports:

```ts
import { resolveAnchor } from '../../../engine';
import { applyHandleResize, handleLocalPositions, HANDLE_IDS, type HandleId } from './resizeHandles';
```

(extend the engine import to include `resolveAnchor`.)

Add constants near the top of the module:

```ts
const HANDLE_SIZE = 8; // screen px (divided by zoom for constant on-screen size)
```

Compute the selected vector object + its render data inside the component (after `ordered`):

```ts
  const selectedVector = useMemo(() => {
    if (!selectedId) return null;
    const obj = project.objects.find((o) => o.id === selectedId);
    const asset = obj ? assetsById.get(obj.assetId) : undefined;
    if (!obj || !asset || asset.kind !== 'vector') return null;
    const state = sampleObject(obj, time);
    const g = state.geometry ?? {};
    const width = asset.shapeType === 'ellipse' ? 2 * (g.radiusX ?? 0) : g.width ?? 0;
    const height = asset.shapeType === 'ellipse' ? 2 * (g.radiusY ?? 0) : g.height ?? 0;
    const anchor = resolveAnchor(obj, state, asset.shapeType);
    const transform = buildTransform(state, anchor.anchorX, anchor.anchorY);
    return { obj, asset, state, width, height, transform };
  }, [selectedId, project.objects, assetsById, time]);
```

Add a resize ref:

```ts
  const resizeRef = useRef<{
    handle: HandleId;
    group: SVGGElement;
    snapshot: ReturnType<typeof snapshotForResize>;
    last?: { width: number; height: number; baseX: number; baseY: number };
  } | null>(null);
```

Add a snapshot helper inside the component (captures everything `applyHandleResize` needs at drag start):

```ts
  function snapshotForResize() {
    const sv = selectedVector!;
    const isEllipse = sv.asset.shapeType === 'ellipse';
    return {
      objId: sv.obj.id,
      isEllipse,
      width: sv.width,
      height: sv.height,
      anchorFracX: sv.obj.anchorX,
      anchorFracY: sv.obj.anchorY,
      baseX: sv.state.x,
      baseY: sv.state.y,
      scaleX: sv.state.scaleX,
      scaleY: sv.state.scaleY,
      rotationDeg: sv.state.rotation,
    };
  }
```

Handle pointer-down on a handle:

```ts
  const onHandlePointerDown = (handle: HandleId, group: SVGGElement, e: ReactPointerEvent) => {
    e.stopPropagation();
    if (!selectedVector || !useEditor.getState().autoKey) return;
    resizeRef.current = { handle, group, snapshot: snapshotForResize() };
  };
```

In the window `pointermove` handler, handle resize (place this branch before the move-drag branch, after the draw branch):

```ts
      const rz = resizeRef.current;
      if (rz) {
        const ctm = rz.group.getScreenCTM();
        const svg = rz.group.ownerSVGElement;
        if (!ctm || !svg) return;
        const pt = svg.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;
        const local = pt.matrixTransform(ctm.inverse());
        const snap = rz.snapshot;
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
        });
        // Imperative preview only (committed on pointer-up).
        const node = nodes.get(snap.objId);
        const obj = useEditor.getState().history.present.objects.find((o) => o.id === snap.objId);
        if (node && obj) {
          const geometry = snap.isEllipse
            ? { radiusX: r.width / 2, radiusY: r.height / 2 }
            : { width: r.width, height: r.height };
          const previewState = { ...sampleObject(obj, useEditor.getState().time), x: r.baseX, y: r.baseY, geometry };
          const anchor = resolveAnchor(obj, previewState, snap.isEllipse ? 'ellipse' : 'rect');
          node.setAttribute('transform', buildTransform(previewState, anchor.anchorX, anchor.anchorY));
          const shape = node.firstElementChild;
          if (shape) {
            for (const [a, v] of Object.entries(geometryToSvgAttrs(snap.isEllipse ? 'ellipse' : 'rect', geometry))) {
              shape.setAttribute(a, v);
            }
          }
        }
        resizeRef.current.last = r; // stash for commit
        return;
      }
```

> Add `geometryToSvgAttrs` to the engine import, and widen the `resizeRef` type with an optional `last?: { width: number; height: number; baseX: number; baseY: number }` field.

In the window `pointerup` handler, commit the resize (before the move-drag commit branch):

```ts
      const rz = resizeRef.current;
      if (rz) {
        const snap = rz.snapshot;
        const last = rz.last;
        resizeRef.current = null;
        if (last) {
          const s = useEditor.getState();
          s.selectObject(snap.objId);
          const geom = snap.isEllipse
            ? { radiusX: last.width / 2, radiusY: last.height / 2 }
            : { width: last.width, height: last.height };
          s.setProperties({ ...geom, x: last.baseX, y: last.baseY });
        }
        return;
      }
```

Render the handles overlay (inside the content `<g>`, after the objects map), only when a vector object is selected:

```tsx
          {selectedVector && (
            <g transform={selectedVector.transform} data-testid="resize-handles">
              {HANDLE_IDS.map((id) => {
                const pos = handleLocalPositions(selectedVector.width, selectedVector.height)[id];
                const size = HANDLE_SIZE / zoom;
                return (
                  <rect
                    key={id}
                    data-testid={`handle-${id}`}
                    x={pos.x - size / 2}
                    y={pos.y - size / 2}
                    width={size}
                    height={size}
                    fill="var(--accent)"
                    stroke="var(--surface-1)"
                    style={{ cursor: 'pointer' }}
                    onPointerDown={(e) => onHandlePointerDown(id, e.currentTarget.ownerSVGElement ? (e.currentTarget.parentNode as SVGGElement) : (e.currentTarget as unknown as SVGGElement), e)}
                  />
                );
              })}
            </g>
          )}
```

> The handle's `getScreenCTM` must be read from the overlay `<g>` (which carries the object transform), so pass the parent group as `group`. Simpler: give the overlay `<g>` a ref and use it directly in `onHandlePointerDown` instead of deriving from `e.currentTarget.parentNode`. Implement whichever is cleaner; the parent `<g>` is the element whose CTM maps screen→object-local.

- [ ] **Step 6: Write the failing Stage handle test**

Add to `src/ui/components/Stage/Stage.test.tsx`:

```tsx
it('shows 8 resize handles when a vector object is selected', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 60, height: 40 });
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  expect(screen.getByTestId('resize-handles')).toBeInTheDocument();
  expect(screen.getByTestId('handle-se')).toBeInTheDocument();
  expect(screen.getAllByTestId(/^handle-/)).toHaveLength(8);
});

it('hides resize handles for an SVG object', () => {
  // beforeEach already seeds + selects an svg-backed object 'a'.
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  expect(screen.queryByTestId('resize-handles')).toBeNull();
});
```

> The handle-drag math is unit-tested in `resizeHandles.test.ts`; the live drag (needs `getScreenCTM`, absent in jsdom) is covered by the Task 9 e2e.

- [ ] **Step 7: Run tests + typecheck + lint**

Run: `pnpm vitest run src/ui/components/Stage && pnpm typecheck && pnpm lint`
Expected: PASS, clean.

- [ ] **Step 8: Commit**

```bash
git add src/ui/components/Stage/resizeHandles.ts src/ui/components/Stage/resizeHandles.test.ts src/ui/components/Stage/Stage.tsx src/ui/components/Stage/Stage.test.tsx
git commit -m "feat(ui): rotation-aware resize handles (opposite-anchor-fixed)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Inspector — geometry + style controls

**Files:**
- Modify: `src/ui/store/store.ts` (add `setVectorStyle`)
- Modify: `src/ui/components/Inspector/Inspector.tsx`
- Test: `src/ui/store/store.test.ts`, `src/ui/components/Inspector/Inspector.test.tsx`

**Interfaces:**
- Consumes: `setProperty` (geometry, auto-keyed), `selectSelectedObject`.
- Produces: `setVectorStyle(updates: Partial<VectorStyle>): void` (edits the asset style, one commit, not auto-key gated); Inspector shows a Geometry section (rect: width/height/cornerRadius; ellipse: radiusX/radiusY) and a Style section (fill/stroke color + none toggles, strokeWidth) when the selected object is a vector.

- [ ] **Step 1: Write the failing store test**

Add to `src/ui/store/store.test.ts`:

```ts
describe('setVectorStyle', () => {
  it('updates the selected vector object asset style in one commit', () => {
    useEditor.getState().newProject();
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    useEditor.getState().setVectorStyle({ fill: '#00ff00' });
    const project = useEditor.getState().history.present;
    const asset = project.assets[0];
    expect(asset.kind === 'vector' && asset.style.fill).toBe('#00ff00');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/ui/store/store.test.ts`
Expected: FAIL — `setVectorStyle` undefined.

- [ ] **Step 3: Implement setVectorStyle**

In `src/ui/store/store.ts`, add to `EditorState`:

```ts
  setVectorStyle(updates: Partial<VectorStyle>): void;
```

Add the action (near `setAnchor`):

```ts
  setVectorStyle(updates) {
    const s = get();
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === s.selectedObjectId);
    if (!obj) return;
    const asset = project.assets.find((a) => a.id === obj.assetId);
    if (!asset || asset.kind !== 'vector') return;
    const next = { ...asset, style: { ...asset.style, ...updates } };
    get().commit({ ...project, assets: project.assets.map((a) => (a.id === asset.id ? next : a)) });
  },
```

(`VectorStyle` is already imported per Task 2.)

- [ ] **Step 4: Write the failing Inspector test**

Add to `src/ui/components/Inspector/Inspector.test.tsx` (read the file's render helper):

```tsx
it('shows geometry + style fields for a selected rect vector', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 120, height: 80 });
  render(<Inspector />);
  expect(screen.getByLabelText('width')).toHaveValue(120);
  expect(screen.getByLabelText('height')).toHaveValue(80);
  expect(screen.getByLabelText('fill')).toBeInTheDocument();
  expect(screen.getByLabelText('strokeWidth')).toBeInTheDocument();
});
```

- [ ] **Step 5: Run to verify it fails**

Run: `pnpm vitest run src/ui/components/Inspector/Inspector.test.tsx`
Expected: FAIL — no geometry/style fields.

- [ ] **Step 6: Implement Inspector sections**

In `src/ui/components/Inspector/Inspector.tsx`:

Add imports:

```ts
import { useEditor } from '../../store/store';
```

(already imported) and add a selector for the selected object's vector asset. Inside the component, after `const obj = ...`:

```ts
  const project = useEditor((s) => s.history.present);
  const { setVectorStyle } = useEditor.getState();
  const asset = obj ? project.assets.find((a) => a.id === obj.assetId) : undefined;
  const vector = asset && asset.kind === 'vector' ? asset : null;
```

Define geometry field lists:

```ts
  const RECT_GEOMETRY = ['width', 'height', 'cornerRadius'] as const;
  const ELLIPSE_GEOMETRY = ['radiusX', 'radiusY'] as const;
```

Before the closing `</div>` of the panel (after the Anchor section), add the geometry + style blocks. `sampled` already exists as `sampleObject(obj, time)`; geometry values come from `sampled.geometry`:

```tsx
      {vector && (
        <>
          <div className={styles.group}>Geometry</div>
          {(vector.shapeType === 'rect' ? RECT_GEOMETRY : ELLIPSE_GEOMETRY).map((prop) => (
            <div key={prop} className={styles.row}>
              <label htmlFor={`insp-${prop}`}>{prop}</label>
              <NumberField
                label={prop}
                value={round(sampled.geometry?.[prop] ?? 0)}
                disabled={!autoKey}
                onCommit={(n) => setProperty(prop, n)}
              />
            </div>
          ))}
          <div className={styles.group}>Style</div>
          <div className={styles.row}>
            <label htmlFor="insp-fill">fill</label>
            <input
              type="checkbox"
              aria-label="fill enabled"
              checked={vector.style.fill !== 'none'}
              onChange={(e) => setVectorStyle({ fill: e.target.checked ? '#cccccc' : 'none' })}
            />
            <input
              id="insp-fill"
              aria-label="fill"
              type="color"
              disabled={vector.style.fill === 'none'}
              value={vector.style.fill === 'none' ? '#cccccc' : vector.style.fill}
              onChange={(e) => setVectorStyle({ fill: e.target.value })}
            />
          </div>
          <div className={styles.row}>
            <label htmlFor="insp-stroke">stroke</label>
            <input
              type="checkbox"
              aria-label="stroke enabled"
              checked={vector.style.stroke !== 'none'}
              onChange={(e) => setVectorStyle({ stroke: e.target.checked ? '#000000' : 'none' })}
            />
            <input
              id="insp-stroke"
              aria-label="stroke"
              type="color"
              disabled={vector.style.stroke === 'none'}
              value={vector.style.stroke === 'none' ? '#000000' : vector.style.stroke}
              onChange={(e) => setVectorStyle({ stroke: e.target.value })}
            />
          </div>
          <div className={styles.row}>
            <label htmlFor="insp-strokeWidth">strokeWidth</label>
            <NumberField label="strokeWidth" value={round(vector.style.strokeWidth)} onCommit={(n) => setVectorStyle({ strokeWidth: n })} />
          </div>
        </>
      )}
```

> `setProperty(prop, n)` accepts geometry props (they are `AnimatableProperty`s) and auto-keys at the current time, matching transform editing. Geometry fields are disabled when `!autoKey`, mirroring the transform fields.

- [ ] **Step 7: Run tests + typecheck + lint**

Run: `pnpm vitest run src/ui/store/store.test.ts src/ui/components/Inspector/Inspector.test.tsx && pnpm typecheck && pnpm lint`
Expected: PASS, clean.

- [ ] **Step 8: Commit**

```bash
git add src/ui/store/store.ts src/ui/store/store.test.ts src/ui/components/Inspector/Inspector.tsx src/ui/components/Inspector/Inspector.test.tsx
git commit -m "feat(ui): Inspector geometry + style controls for vectors

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Playwright export-parity e2e (draw → animate → export)

**Files:**
- Create: `e2e/draw-vector.spec.ts`
- Test: the spec itself (`pnpm e2e`)

**Interfaces:**
- Consumes: the full app (tool palette, Stage draw, Inspector geometry keyframing, export).

- [ ] **Step 1: Write the e2e (it will fail until the app supports the full flow — but Tasks 1-8 should make it pass)**

Create `e2e/draw-vector.spec.ts` (mirror the structure of `e2e/export.spec.ts`):

```ts
import { test, expect } from '@playwright/test';
import { unzipSync } from 'fflate';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

test('draw rect -> keyframe width -> export -> exported bundle animates geometry', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Select the rectangle tool and draw on the stage.
  await page.getByRole('button', { name: 'Rectangle' }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 80, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 160);
  await page.mouse.up();

  // The new object is selected; key width=120 at t=0 and width=240 at t=1.
  const widthField = page.getByLabel('width', { exact: true });
  await widthField.fill('120');
  await widthField.blur();
  await page.getByTestId('timeline-ruler').click({ position: { x: 100, y: 10 } });
  await widthField.fill('240');
  await widthField.blur();

  // Export and capture the bundle.
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream!) chunks.push(c as Buffer);
  const zipBytes = new Uint8Array(Buffer.concat(chunks));

  const dir = mkdtempSync(join(tmpdir(), 'savig-e2e-'));
  const files = unzipSync(zipBytes);
  for (const [path, data] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, data);
  }
  expect(Object.keys(files)).toContain('index.html');

  // Open the exported bundle; assert the inner rect's width animates.
  const exported = await page.context().newPage();
  await exported.goto(pathToFileURL(join(dir, 'index.html')).href);
  const rect = exported.locator('[data-savig-object] rect').first();
  await expect(rect).toHaveCount(1);
  const w0 = await rect.getAttribute('width');
  await exported.waitForTimeout(500); // runtime auto-plays
  const w1 = await rect.getAttribute('width');
  expect(w1).not.toBe(w0);
});
```

- [ ] **Step 2: Run the e2e**

Run: `pnpm e2e`
Expected: PASS (both the existing export e2e and the new draw-vector e2e). If the draw step fails to create a shape, verify the Stage `getScreenCTM` path and that `addVectorShape` fires on pointer-up; if width keyframing fails, verify the Inspector `width` field is present and auto-key is on (default).

- [ ] **Step 3: Run the whole suite once more**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add e2e/draw-vector.spec.ts
git commit -m "test(e2e): draw vector -> keyframe geometry -> export animates

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Definition of done (Plan B)

- Tool palette switches select/rect/ellipse (buttons + V/R/E/Escape).
- Click-drag draws a rect/ellipse: one undo step, selected, tool returns to select; sub-threshold drags create nothing.
- Vector objects render on the Stage and paint via the same `computeFrame` as export (preview == export, incl. animated geometry + fractional anchor).
- 8 rotation-aware resize handles edit geometry with the opposite corner fixed, one undo step per drag; Inspector geometry numeric fields stay in sync; style (fill/stroke/none/strokeWidth) editable.
- Vector assets do not appear in the Asset panel.
- `pnpm test`, `pnpm typecheck`, `pnpm lint` clean; `pnpm e2e` passes (draw → keyframe geometry → export animates).

## Self-review notes (spec coverage)

- Spec §5 tool palette → Task 3. Drawing → Task 6. Resize handles (rotation-aware, opposite-anchor-fixed per user decision) → Task 7. Inspector geometry+style → Task 8. Asset-panel exclusion → preserved (buildDefs already filters; vectors never added as importable assets; no Asset-panel change needed — vector assets are created via draw, not the import flow).
- Spec §4 editor preview==export for geometry → Task 4 (unified painter) + Task 5 (inline render).
- Spec §9 UI tests → Tasks 1-8 unit/RTL; Playwright export-parity e2e → Task 9.
- Spec §5 auto-key behavior → geometry/resize go through `setProperties` (gated on autoKey, keyframes at current time); style + creation are not gated.
- Known deviation surfaced to the user and accepted: full 8-handle opposite-anchor-fixed model (highest fidelity, most math) — the resize math is isolated in `resizeHandles.ts` and unit-tested including a rotated fixed-corner invariant.
- Carry-over from Plan A final review (do here): consider making `resolveAnchor`'s `shapeType` required. Not required for Plan B correctness (all callers pass it); leave as a separate cleanup unless trivial.
