# Slice 12 On-Canvas Rotation Handle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user rotate a vector object by dragging a handle (stalk + circle above the bbox), reusing `setProperty('rotation', …)` so a drag is one undo step and auto-keys when autoKey is on.

**Architecture:** A pure helper (`rotateHandle.ts`: `angleDeg`, `rotationFromDrag`, `rotateHandleLocal`) does the screen-space angle math. A `selectedRotatable` memo (reuses Slice-11's `shapeLocalBBox`) + a Stage overlay `<g transform>` render the handle; the drag captures the rotation pivot once at pointer-down (the resolved anchor mapped to screen, invariant under rotation), previews imperatively on the object node + overlay group, and commits once via `setProperty('rotation')` on release. Editor chrome over real transform data — NO engine/runtime/export/persistence change.

**Tech Stack:** TypeScript (strict), Vitest + RTL, Playwright; the existing `src/ui/components/Stage` overlay/drag machinery.

## Global Constraints

- TypeScript strict; no `any`. Match surrounding code style.
- Rotation handle is EDITOR chrome over the existing `Transform2D.rotation` data — NO change to engine render/runtime/export/persistence, NO migration (project stays v4), NO bundle regen.
- A drag is ONE undo step: imperative preview during the drag, a single `setProperty('rotation', value)` commit on pointer-up (autoKey ON → rotation keyframe; OFF → static `base.rotation`). Works with autoKey on OR off (unlike resize).
- Commit reads the drag state from a ref (StrictMode-safe), nulling the ref before committing.
- The pivot is captured ONCE at pointer-down (the resolved anchor mapped to screen via the overlay group CTM) and reused for the whole drag (rotation-invariant).
- Overlay renders only under the **select** tool for a selected vector object (rect/ellipse/path). No-op clicks (down+up, no move) commit nothing.
- Run the full gate before declaring done: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`.

---

### Task 1: Pure helper — `rotateHandle.ts`

**Files:**
- Create: `src/ui/components/Stage/rotateHandle.ts`
- Create: `src/ui/components/Stage/rotateHandle.test.ts`

**Interfaces:**
- Produces: `Pt { x; y }`; `angleDeg(pivot: Pt, p: Pt): number`; `rotationFromDrag(pivot: Pt, start: Pt, cur: Pt, startRotationDeg: number): number`; `rotateHandleLocal(bbox: {x;y;width;height}, stalk: number): { base: Pt; handle: Pt }`.

- [ ] **Step 1: Write the failing test**

Create `src/ui/components/Stage/rotateHandle.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { angleDeg, rotationFromDrag, rotateHandleLocal } from './rotateHandle';

describe('angleDeg', () => {
  const pivot = { x: 0, y: 0 };
  it('0 to the right, 90 down, 180 left, -90 up (screen y-down)', () => {
    expect(angleDeg(pivot, { x: 10, y: 0 })).toBeCloseTo(0);
    expect(angleDeg(pivot, { x: 0, y: 10 })).toBeCloseTo(90);
    expect(angleDeg(pivot, { x: -10, y: 0 })).toBeCloseTo(180);
    expect(angleDeg(pivot, { x: 0, y: -10 })).toBeCloseTo(-90);
  });
});

describe('rotationFromDrag', () => {
  const pivot = { x: 50, y: 50 };
  it('adds the swept angular delta to the start rotation', () => {
    // start above the pivot (-90deg), drag to the right (0deg) => +90 sweep
    expect(rotationFromDrag(pivot, { x: 50, y: 0 }, { x: 100, y: 50 }, 0)).toBeCloseTo(90);
  });
  it('is relative to the start rotation (no jump when grabbing off-center)', () => {
    expect(rotationFromDrag(pivot, { x: 50, y: 0 }, { x: 50, y: 0 }, 30)).toBeCloseTo(30);
  });
});

describe('rotateHandleLocal', () => {
  it('base at bbox top-center, handle a stalk above', () => {
    expect(rotateHandleLocal({ x: 0, y: 0, width: 100, height: 60 }, 24)).toEqual({
      base: { x: 50, y: 0 },
      handle: { x: 50, y: -24 },
    });
  });
  it('respects a non-zero bbox origin', () => {
    expect(rotateHandleLocal({ x: 10, y: 20, width: 40, height: 40 }, 10)).toEqual({
      base: { x: 30, y: 20 },
      handle: { x: 30, y: 10 },
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/ui/components/Stage/rotateHandle.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `rotateHandle.ts`**

Create `src/ui/components/Stage/rotateHandle.ts`:

```ts
export interface Pt {
  x: number;
  y: number;
}

/** Screen-space angle (degrees) from pivot to point (y grows downward). */
export function angleDeg(pivot: Pt, p: Pt): number {
  return (Math.atan2(p.y - pivot.y, p.x - pivot.x) * 180) / Math.PI;
}

/** New rotation for a handle drag: the start rotation plus the angular delta the
 *  pointer swept around the pivot. Relative, so grabbing off-center doesn't jump. */
export function rotationFromDrag(pivot: Pt, start: Pt, cur: Pt, startRotationDeg: number): number {
  return startRotationDeg + angleDeg(pivot, cur) - angleDeg(pivot, start);
}

/** Connector base (bbox top-center) + handle position (a stalk above it), object-local. */
export function rotateHandleLocal(
  bbox: { x: number; y: number; width: number; height: number },
  stalk: number,
): { base: Pt; handle: Pt } {
  const cx = bbox.x + bbox.width / 2;
  return { base: { x: cx, y: bbox.y }, handle: { x: cx, y: bbox.y - stalk } };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/ui/components/Stage/rotateHandle.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/Stage/rotateHandle.ts src/ui/components/Stage/rotateHandle.test.ts
git commit -m "feat(slice12): rotateHandle pure helpers (angle/drag/placement)"
```

---

### Task 2: Stage — rotate-handle overlay + drag

**Files:**
- Modify: `src/ui/components/Stage/Stage.tsx`
- Test: `src/ui/components/Stage/Stage.test.tsx`

**Interfaces:**
- Consumes: `angleDeg`/`rotationFromDrag`/`rotateHandleLocal`/`Pt` (Task 1); `shapeLocalBBox` (Slice 11, already imported); `sampleObject`/`resolveAnchor`/`buildTransform`/`pathBounds` (already imported); `setProperty`/`selectObject` (store).
- Produces: a `<g data-testid="rotate-handle-overlay">` with a `data-testid="rotate-handle"` circle, rendered under the select tool for a selected vector object; dragging it rotates the object (one undo step).

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/components/Stage/Stage.test.tsx`:

```ts
it('renders a rotate handle for a selected rect', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 50, height: 30 });
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  expect(screen.getByTestId('rotate-handle-overlay')).toBeInTheDocument();
  expect(screen.getByTestId('rotate-handle')).toBeInTheDocument();
});

it('renders a rotate handle for a selected path', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorPath({ nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 20, y: 0 } }, { anchor: { x: 20, y: 20 } }], closed: true });
  useEditor.getState().setActiveTool('select');
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  expect(screen.getByTestId('rotate-handle')).toBeInTheDocument();
});

it('renders no rotate handle for a non-vector (imported svg) object', () => {
  const svgText = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>';
  useEditor.getState().newProject();
  useEditor.getState().addAsset({ id: 'a', kind: 'svg', name: 'box', normalizedContent: svgText, viewBox: '0 0 10 10', width: 10, height: 10 });
  useEditor.getState().addObject('a');
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  expect(screen.queryByTestId('rotate-handle')).toBeNull();
});

it('dragging the rotate handle commits a rotation (autoKey off -> base.rotation)', () => {
  stubIdentityCTM(); // client coords == object-local coords; pivot maps to the anchor
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 100, height: 100 });
  useEditor.getState().toggleAutoKey(); // off
  const id = useEditor.getState().selectedObjectId!;
  const nodes = new Map<string, SVGGraphicsElement>([[id, document.createElementNS('http://www.w3.org/2000/svg', 'g')]]);
  render(<Stage nodes={nodes} />);
  const handle = screen.getByTestId('rotate-handle');
  // Pivot is the resolved anchor; for a 100x100 rect with fraction-0.5 anchor it is (50,50).
  // Start above the pivot (50,0) -> -90deg; drag to the right (100,50) -> 0deg => +90.
  fireEvent.pointerDown(handle, { clientX: 50, clientY: 0, button: 0 });
  fireEvent.pointerMove(window, { clientX: 100, clientY: 50 });
  fireEvent.pointerUp(window, { clientX: 100, clientY: 50 });
  const obj = useEditor.getState().history.present.objects.find((o) => o.id === id)!;
  expect(obj.base.rotation).toBeCloseTo(90);
});
```

> The `stubIdentityCTM` helper makes `createSVGPoint().matrixTransform(m)` return the point's own coords for ANY matrix, so the pivot (anchor mapped through the group CTM) resolves to `(anchorX, anchorY)` = `(50, 50)` and client coords map straight to screen coords. The fraction-0.5 anchor on a 100×100 rect gives `(50, 50)`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx`
Expected: FAIL — no `rotate-handle` testid.

- [ ] **Step 3: Imports + constants**

In `src/ui/components/Stage/Stage.tsx`:

1. Add the helper import + `Pt` type, and `RenderState` to the engine type import:

```ts
import { rotateHandleLocal, rotationFromDrag, type Pt } from './rotateHandle';
```
Add `RenderState` to the existing `import type { … } from '../../../engine'` line (it is the only new engine type needed — `buildTransform` accepts the spread `{ ...renderState, rotation }` structurally, so `Transform2D` need not be imported).

2. Below `const HANDLE_SIZE = 8;` add:

```ts
const ROTATE_STALK = 24;
```

- [ ] **Step 4: `selectedRotatable` memo**

After the `selectedGradient` memo (Slice 11), add:

```ts
  // The selected vector object's bbox + anchor + transform for the rotate-handle
  // overlay (select tool only). Covers rect/ellipse AND path (unlike selectedVector).
  const selectedRotatable = useMemo(() => {
    if (activeTool !== 'select' || !selectedId) return null;
    const obj = project.objects.find((o) => o.id === selectedId);
    const asset = obj ? assetsById.get(obj.assetId) : undefined;
    if (!obj || !asset || asset.kind !== 'vector') return null;
    const state = sampleObject(obj, time);
    const sampledPath =
      asset.shapeType === 'path' ? state.path ?? asset.path ?? { nodes: [], closed: false } : undefined;
    const bbox = shapeLocalBBox(asset.shapeType, state.geometry ?? {}, sampledPath);
    const pathBox = sampledPath ? pathBounds(sampledPath) : undefined;
    const anchor = resolveAnchor(obj, state, asset.shapeType, pathBox);
    const transform = buildTransform(state, anchor.anchorX, anchor.anchorY);
    return { obj, state, bbox, anchorX: anchor.anchorX, anchorY: anchor.anchorY, transform };
  }, [activeTool, selectedId, project.objects, assetsById, time]);
```

- [ ] **Step 5: Ref + pointer-down handler**

Near the other refs/handlers (e.g. after the gradient-handle ref block), add:

```ts
  const rotateHandleGroupRef = useRef<SVGGElement | null>(null);
  const rotateRef = useRef<{
    objId: string;
    pivot: Pt;
    start: Pt;
    startRotation: number;
    anchorX: number;
    anchorY: number;
    state: RenderState;
    last: number | undefined;
  } | null>(null);
  const onRotateHandlePointerDown = (e: ReactPointerEvent) => {
    if (!selectedRotatable) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const group = rotateHandleGroupRef.current;
    const ctm = group?.getScreenCTM();
    const svg = group?.ownerSVGElement;
    if (!group || !ctm || !svg) return;
    // The resolved anchor mapped to screen = the rotation pivot (invariant under rot).
    const p = svg.createSVGPoint();
    p.x = selectedRotatable.anchorX;
    p.y = selectedRotatable.anchorY;
    const pivot = p.matrixTransform(ctm);
    rotateRef.current = {
      objId: selectedRotatable.obj.id,
      pivot: { x: pivot.x, y: pivot.y },
      start: { x: e.clientX, y: e.clientY },
      startRotation: selectedRotatable.state.rotation,
      anchorX: selectedRotatable.anchorX,
      anchorY: selectedRotatable.anchorY,
      state: selectedRotatable.state,
      last: undefined,
    };
  };
```

- [ ] **Step 6: onMove + onUp branches**

In the window pointer-MOVE handler, add a `rotateRef` branch at the TOP (before the gradient/resize branches):

```ts
      const rot = rotateRef.current;
      if (rot) {
        const next = rotationFromDrag(rot.pivot, rot.start, { x: e.clientX, y: e.clientY }, rot.startRotation);
        rot.last = next;
        const previewTransform = buildTransform({ ...rot.state, rotation: next }, rot.anchorX, rot.anchorY);
        const node = nodes.get(rot.objId);
        if (node) node.setAttribute('transform', previewTransform);
        const group = rotateHandleGroupRef.current;
        if (group) group.setAttribute('transform', previewTransform);
        return;
      }
```

In the window pointer-UP handler, add a `rotateRef` branch at the TOP:

```ts
      const rotUp = rotateRef.current;
      if (rotUp) {
        rotateRef.current = null;
        if (rotUp.last !== undefined) {
          useEditor.getState().selectObject(rotUp.objId);
          useEditor.getState().setProperty('rotation', rotUp.last);
        }
        return;
      }
```

- [ ] **Step 7: Render the overlay**

After the gradient-handle overlay block (so the rotate handle is on top), add:

```tsx
          {selectedRotatable && (
            <g
              ref={rotateHandleGroupRef}
              transform={selectedRotatable.transform}
              data-testid="rotate-handle-overlay"
            >
              {(() => {
                const { base, handle } = rotateHandleLocal(selectedRotatable.bbox, ROTATE_STALK / zoom);
                const size = HANDLE_SIZE / zoom;
                return (
                  <>
                    <line
                      x1={base.x}
                      y1={base.y}
                      x2={handle.x}
                      y2={handle.y}
                      stroke="var(--color-accent)"
                      strokeWidth={1 / zoom}
                      pointerEvents="none"
                    />
                    <circle
                      data-testid="rotate-handle"
                      cx={handle.x}
                      cy={handle.y}
                      r={size / 2}
                      fill="var(--color-panel)"
                      stroke="var(--color-accent)"
                      strokeWidth={1 / zoom}
                      style={{ cursor: 'pointer' }}
                      onPointerDown={onRotateHandlePointerDown}
                    />
                  </>
                );
              })()}
            </g>
          )}
```

- [ ] **Step 8: Run to verify it passes**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx`
Expected: PASS (4 new tests + no regressions).

- [ ] **Step 9: Gate + commit**

Run: `pnpm vitest run && pnpm typecheck && pnpm lint`
Expected: all green.

```bash
git add src/ui/components/Stage/Stage.tsx src/ui/components/Stage/Stage.test.tsx
git commit -m "feat(slice12): Stage rotate-handle overlay + drag (preview + commit)"
```

---

### Task 3: End-to-end — drag the rotate handle rotates the object

**Files:**
- Create: `e2e/rotate-handle.spec.ts`

**Interfaces:**
- Consumes: the whole feature.

- [ ] **Step 1: Write the e2e**

Create `e2e/rotate-handle.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('drag the rotate handle rotates the object', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Draw a rect, then switch to the select tool.
  await page.getByRole('button', { name: 'Rectangle' }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 220, box.y + 200);
  await page.mouse.up();
  await page.getByRole('button', { name: 'Select' }).click();

  const obj = page.locator('[data-savig-object]').first();
  const before = await obj.getAttribute('transform');

  // Drag the rotate handle in an arc around the object.
  const handle = page.getByTestId('rotate-handle');
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 80, hb.y + 80); // sweep to the side
  await page.mouse.up();

  const after = await obj.getAttribute('transform');
  expect(after).not.toBe(before);
  expect(after).toMatch(/rotate\(/);
  // The rotate angle is non-zero (not "rotate(0, ...").
  expect(after).not.toMatch(/rotate\(0,/);
});
```

> If the Select button label differs, check `src/ui/components/Toolbar/ToolPalette.tsx` (it renders `{ id: 'select', label: 'Select' }`, so `getByRole('button', { name: 'Select' })` matches).

- [ ] **Step 2: Run to verify it passes**

Run: `pnpm exec playwright test e2e/rotate-handle.spec.ts`
Expected: PASS.

- [ ] **Step 3: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add e2e/rotate-handle.spec.ts
git commit -m "test(e2e): drag the rotate handle rotates the object"
```

---

## Self-Review (plan vs spec)

- **§3 pivot is a fixed point (map anchor via group CTM at pointer-down)** → Task 2 Step 5 (`p.matrixTransform(ctm)` once). ✅
- **§4 pure helpers (angleDeg/rotationFromDrag/rotateHandleLocal)** → Task 1. ✅
- **§5.1 selectedRotatable memo (rect/ellipse/path; reuses shapeLocalBBox)** → Task 2 Step 4. ✅
- **§5.2 render (stalk line + handle circle, sized /zoom)** → Task 2 Step 7. ✅
- **§5.3 drag (capture pivot once; imperative preview on object node + overlay group; commit setProperty('rotation') on release; works autoKey on/off)** → Task 2 Steps 5–6. ✅
- **§5.4 no-op guard (last === undefined -> no commit)** → Task 2 Step 6 (onUp `if (last !== undefined)`). ✅
- **§6 coexistence (renders after gradient/resize, stopPropagation)** → Task 2 Steps 5 (stopPropagation) + 7 (rendered after gradient overlay). ✅
- **§7 no persistence/render/runtime/export change** → only `rotateHandle.ts` + `Stage.tsx` + tests + one e2e touched. ✅
- **§8 tests (pure helper; Stage render rect/path/non-vector; Stage drag; e2e)** → Tasks 1, 2, 3. ✅
- **Type consistency:** `Pt` defined Task 1, consumed Task 2; `rotationFromDrag(pivot, start, cur, startRotationDeg)` signature identical in Task 1 def + Task 2 call; `rotateHandleLocal(bbox, stalk)` identical; `setProperty('rotation', value)` matches the existing store action used by the Inspector. ✅
- **Placeholder scan:** all steps carry concrete code/commands; the e2e Select-button note has a concrete fallback. ✅
