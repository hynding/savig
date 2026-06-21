# Slice 11 On-Canvas Gradient Handles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user reshape a vector object's gradient by dragging on-canvas handles (linear start/end; radial center/radius/focal), reusing the existing `setVectorGradient` store action so a drag is one undo step and auto-keys when autoKey is on.

**Architecture:** Pure geometry helpers (`shapeLocalBBox`, `gradientHandlePositions`, `applyGradientHandleDrag`) map between objectBoundingBox fractions and object-local coordinates. A Stage overlay (`<g transform>` in object-local space, the resize-handle pattern) renders the handles from the sampled gradient and drives a React-state drag preview; the drag commits once via `setVectorGradient` on release. Editor-only chrome — NO render/runtime/export/persistence change (the gradient data already round-trips from Slices 8–9).

**Tech Stack:** TypeScript (strict), Vitest + RTL, Playwright; the existing `src/engine` pure core + `src/ui/components/Stage` overlay/drag machinery.

## Global Constraints

- TypeScript strict; no `any`. Match surrounding code style.
- Gradient coordinates are `objectBoundingBox` fractions (0..1 of the shape's object-local bbox). Fractions clamp to [0,1]; radial `r` clamps `>= 0` (and may exceed 1).
- Gradient handles are EDITOR-ONLY chrome — never exported. NO change to renderShape/renderDocument/frame/runtime bundle, NO persistence migration (project stays v4).
- A drag is ONE undo step: imperative/React-state preview during the drag, a single `setVectorGradient` commit on pointer-up (autoKey ON → gradient keyframe; OFF → static).
- Drag commits must run OUTSIDE React state updaters via a ref (StrictMode-safe), as established in prior slices.
- Overlay renders only under the **select** tool when the selected vector object has a gradient (fill preferred, else stroke).
- Run the full gate before declaring done: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`.

---

### Task 1: `shapeLocalBBox` pure helper

**Files:**
- Create: `src/engine/gradientHandles.ts`
- Create: `src/engine/gradientHandles.test.ts`
- Modify: `src/engine/index.ts` (barrel export)

**Interfaces:**
- Consumes: `pathBounds` (from `./path`), `Gradient`/`PathData`/`ResolvedGeometry`/`VectorShapeType` (from `./types`).
- Produces: `LocalRect { x; y; width; height }`; `shapeLocalBBox(shapeType, geometry, path?): LocalRect`.

- [ ] **Step 1: Write the failing test**

Create `src/engine/gradientHandles.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { shapeLocalBBox } from './gradientHandles';
import type { PathData } from './types';

describe('shapeLocalBBox', () => {
  it('rect -> origin bbox of width/height', () => {
    expect(shapeLocalBBox('rect', { width: 100, height: 60 })).toEqual({ x: 0, y: 0, width: 100, height: 60 });
  });
  it('ellipse -> 2*radius bbox', () => {
    expect(shapeLocalBBox('ellipse', { radiusX: 30, radiusY: 20 })).toEqual({ x: 0, y: 0, width: 60, height: 40 });
  });
  it('path -> pathBounds', () => {
    const path: PathData = { nodes: [{ anchor: { x: 5, y: 5 } }, { anchor: { x: 25, y: 15 } }], closed: false };
    expect(shapeLocalBBox('path', {}, path)).toEqual({ x: 5, y: 5, width: 20, height: 10 });
  });
  it('missing geometry -> zero bbox', () => {
    expect(shapeLocalBBox('rect', {})).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/engine/gradientHandles.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `shapeLocalBBox`**

Create `src/engine/gradientHandles.ts`:

```ts
import { pathBounds } from './path';
import type { Gradient, PathData, ResolvedGeometry, VectorShapeType } from './types';

export interface LocalRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const EMPTY_PATH: PathData = { nodes: [], closed: false };

/** The object-local bbox a gradient's objectBoundingBox normalizes against. */
export function shapeLocalBBox(
  shapeType: VectorShapeType,
  geometry: ResolvedGeometry,
  path?: PathData,
): LocalRect {
  if (shapeType === 'rect') {
    return { x: 0, y: 0, width: geometry.width ?? 0, height: geometry.height ?? 0 };
  }
  if (shapeType === 'ellipse') {
    return { x: 0, y: 0, width: 2 * (geometry.radiusX ?? 0), height: 2 * (geometry.radiusY ?? 0) };
  }
  return pathBounds(path ?? EMPTY_PATH);
}
```

> `Gradient` is imported now (unused until Task 2) — add it in Task 2 instead if your linter flags unused imports. To keep this task lint-clean, import only `PathData, ResolvedGeometry, VectorShapeType` here and add `Gradient` in Task 2.

- [ ] **Step 4: Add the barrel export**

In `src/engine/index.ts`, after `export * from './gradientAnim';`:

```ts
export * from './gradientHandles';
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm vitest run src/engine/gradientHandles.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/engine/gradientHandles.ts src/engine/gradientHandles.test.ts src/engine/index.ts
git commit -m "feat(slice11): shapeLocalBBox helper for gradient handles"
```

---

### Task 2: `gradientHandlePositions` pure helper

**Files:**
- Modify: `src/engine/gradientHandles.ts`
- Test: `src/engine/gradientHandles.test.ts`

**Interfaces:**
- Consumes: `LocalRect` (Task 1), `Gradient`.
- Produces: `GradientHandleId = 'start'|'end'|'center'|'radius'|'focal'`; `GradientHandle { id; x; y }`; `gradientHandlePositions(g, bbox): GradientHandle[]` — linear → [start,end]; radial → [center,radius,focal] (radius at center+(r,0); focal defaults to center).

- [ ] **Step 1: Write the failing test**

Append to `src/engine/gradientHandles.test.ts`:

```ts
import { gradientHandlePositions } from './gradientHandles';
import type { Gradient } from './types';

describe('gradientHandlePositions', () => {
  const bbox = { x: 0, y: 0, width: 100, height: 100 };

  it('linear -> start and end at local fraction coords', () => {
    const g: Gradient = { type: 'linear', x1: 0, y1: 0.5, x2: 1, y2: 0.5, stops: [] };
    expect(gradientHandlePositions(g, bbox)).toEqual([
      { id: 'start', x: 0, y: 50 },
      { id: 'end', x: 100, y: 50 },
    ]);
  });

  it('radial -> center, radius (center+r rightward), focal (defaults to center)', () => {
    const g: Gradient = { type: 'radial', cx: 0.5, cy: 0.5, r: 0.5, stops: [] };
    expect(gradientHandlePositions(g, bbox)).toEqual([
      { id: 'center', x: 50, y: 50 },
      { id: 'radius', x: 100, y: 50 },
      { id: 'focal', x: 50, y: 50 },
    ]);
  });

  it('radial focal uses fx/fy when present', () => {
    const g: Gradient = { type: 'radial', cx: 0.5, cy: 0.5, r: 0.5, fx: 0.2, fy: 0.8, stops: [] };
    const focal = gradientHandlePositions(g, bbox).find((h) => h.id === 'focal');
    expect(focal).toEqual({ id: 'focal', x: 20, y: 80 });
  });

  it('respects a non-zero bbox origin (path)', () => {
    const g: Gradient = { type: 'linear', x1: 0, y1: 0, x2: 1, y2: 1, stops: [] };
    expect(gradientHandlePositions(g, { x: 10, y: 20, width: 100, height: 50 })).toEqual([
      { id: 'start', x: 10, y: 20 },
      { id: 'end', x: 110, y: 70 },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/engine/gradientHandles.test.ts`
Expected: FAIL — `gradientHandlePositions` not exported.

- [ ] **Step 3: Implement**

In `src/engine/gradientHandles.ts`, ensure `Gradient` is imported, then add:

```ts
export type GradientHandleId = 'start' | 'end' | 'center' | 'radius' | 'focal';

export interface GradientHandle {
  id: GradientHandleId;
  x: number; // object-local coords
  y: number;
}

function toLocal(bbox: LocalRect, fx: number, fy: number): { x: number; y: number } {
  return { x: bbox.x + fx * bbox.width, y: bbox.y + fy * bbox.height };
}

/** Handle positions in object-local space. Linear -> [start, end];
 *  Radial -> [center, radius (center + r rightward), focal (defaults to center)]. */
export function gradientHandlePositions(g: Gradient, bbox: LocalRect): GradientHandle[] {
  if (g.type === 'linear') {
    return [
      { id: 'start', ...toLocal(bbox, g.x1, g.y1) },
      { id: 'end', ...toLocal(bbox, g.x2, g.y2) },
    ];
  }
  return [
    { id: 'center', ...toLocal(bbox, g.cx, g.cy) },
    { id: 'radius', ...toLocal(bbox, g.cx + g.r, g.cy) },
    { id: 'focal', ...toLocal(bbox, g.fx ?? g.cx, g.fy ?? g.cy) },
  ];
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/engine/gradientHandles.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/gradientHandles.ts src/engine/gradientHandles.test.ts
git commit -m "feat(slice11): gradientHandlePositions"
```

---

### Task 3: `applyGradientHandleDrag` pure helper

**Files:**
- Modify: `src/engine/gradientHandles.ts`
- Test: `src/engine/gradientHandles.test.ts`

**Interfaces:**
- Consumes: `LocalRect`, `GradientHandleId`, `Gradient`.
- Produces: `applyGradientHandleDrag(g, handleId, local: {x;y}, bbox): Gradient`.

- [ ] **Step 1: Write the failing test**

Append to `src/engine/gradientHandles.test.ts`:

```ts
import { applyGradientHandleDrag } from './gradientHandles';

describe('applyGradientHandleDrag', () => {
  const bbox = { x: 0, y: 0, width: 100, height: 100 };
  const lin: Gradient = { type: 'linear', x1: 0, y1: 0.5, x2: 1, y2: 0.5, stops: [] };
  const rad: Gradient = { type: 'radial', cx: 0.5, cy: 0.5, r: 0.5, stops: [] };

  it('linear end -> sets x2/y2 as fraction of the drag point', () => {
    const r = applyGradientHandleDrag(lin, 'end', { x: 100, y: 0 }, bbox) as Extract<Gradient, { type: 'linear' }>;
    expect(r.x2).toBe(1);
    expect(r.y2).toBe(0);
    expect(r.x1).toBe(0); // start unchanged
  });

  it('linear start clamps fractions to [0,1]', () => {
    const r = applyGradientHandleDrag(lin, 'start', { x: -50, y: 200 }, bbox) as Extract<Gradient, { type: 'linear' }>;
    expect(r.x1).toBe(0);
    expect(r.y1).toBe(1);
  });

  it('radial center -> sets cx/cy, leaves fx/fy untouched', () => {
    const withFocal: Gradient = { ...rad, fx: 0.2, fy: 0.2 };
    const r = applyGradientHandleDrag(withFocal, 'center', { x: 30, y: 70 }, bbox) as Extract<Gradient, { type: 'radial' }>;
    expect([r.cx, r.cy]).toEqual([0.3, 0.7]);
    expect([r.fx, r.fy]).toEqual([0.2, 0.2]);
  });

  it('radial radius -> r = fraction distance from center (may exceed 1, never negative)', () => {
    const r = applyGradientHandleDrag(rad, 'radius', { x: 80, y: 50 }, bbox) as Extract<Gradient, { type: 'radial' }>;
    expect(r.r).toBeCloseTo(0.3);
  });

  it('radial focal -> sets fx/fy', () => {
    const r = applyGradientHandleDrag(rad, 'focal', { x: 25, y: 75 }, bbox) as Extract<Gradient, { type: 'radial' }>;
    expect([r.fx, r.fy]).toEqual([0.25, 0.75]);
  });

  it('zero-width bbox -> 0 fraction, no NaN', () => {
    const r = applyGradientHandleDrag(lin, 'end', { x: 50, y: 50 }, { x: 0, y: 0, width: 0, height: 0 }) as Extract<Gradient, { type: 'linear' }>;
    expect(r.x2).toBe(0);
    expect(r.y2).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/engine/gradientHandles.test.ts`
Expected: FAIL — `applyGradientHandleDrag` not exported.

- [ ] **Step 3: Implement**

In `src/engine/gradientHandles.ts`, add:

```ts
const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

function toFraction(bbox: LocalRect, x: number, y: number): { fx: number; fy: number } {
  return {
    fx: bbox.width === 0 ? 0 : (x - bbox.x) / bbox.width,
    fy: bbox.height === 0 ? 0 : (y - bbox.y) / bbox.height,
  };
}

/** Drag `handleId` to object-local point `local`; return the updated gradient.
 *  Fractions clamp to [0,1]; radial r clamps >= 0 (may exceed 1). */
export function applyGradientHandleDrag(
  g: Gradient,
  handleId: GradientHandleId,
  local: { x: number; y: number },
  bbox: LocalRect,
): Gradient {
  const { fx, fy } = toFraction(bbox, local.x, local.y);
  if (g.type === 'linear') {
    if (handleId === 'start') return { ...g, x1: clamp01(fx), y1: clamp01(fy) };
    if (handleId === 'end') return { ...g, x2: clamp01(fx), y2: clamp01(fy) };
    return g;
  }
  if (handleId === 'center') return { ...g, cx: clamp01(fx), cy: clamp01(fy) };
  if (handleId === 'focal') return { ...g, fx: clamp01(fx), fy: clamp01(fy) };
  if (handleId === 'radius') {
    return { ...g, r: Math.max(0, Math.hypot(fx - g.cx, fy - g.cy)) };
  }
  return g;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/engine/gradientHandles.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/gradientHandles.ts src/engine/gradientHandles.test.ts
git commit -m "feat(slice11): applyGradientHandleDrag"
```

---

### Task 4: Stage — `selectedGradient` memo + handle overlay render

**Files:**
- Modify: `src/ui/components/Stage/Stage.tsx`
- Test: `src/ui/components/Stage/Stage.test.tsx`

**Interfaces:**
- Consumes: `shapeLocalBBox`, `gradientHandlePositions` (Tasks 1–2); `sampleObject`, `resolveAnchor`, `buildTransform`, `pathBounds` (already imported in Stage).
- Produces: a `<g data-testid="gradient-handles">` overlay with `data-testid="gradient-handle-<id>"` circles, rendered under the select tool when the selected vector object has a gradient.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/components/Stage/Stage.test.tsx`:

```ts
it('renders linear gradient handles (start/end) for a selected rect with a fill gradient', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 50, height: 30 });
  useEditor.getState().toggleAutoKey(); // off -> static gradient
  useEditor.getState().setVectorGradient('fill', {
    type: 'linear', x1: 0, y1: 0.5, x2: 1, y2: 0.5,
    stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }],
  });
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  expect(screen.getByTestId('gradient-handles')).toBeInTheDocument();
  expect(screen.getByTestId('gradient-handle-start')).toBeInTheDocument();
  expect(screen.getByTestId('gradient-handle-end')).toBeInTheDocument();
});

it('renders radial gradient handles (center/radius/focal)', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 50, height: 30 });
  useEditor.getState().toggleAutoKey();
  useEditor.getState().setVectorGradient('fill', {
    type: 'radial', cx: 0.5, cy: 0.5, r: 0.5,
    stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }],
  });
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  expect(screen.getByTestId('gradient-handle-center')).toBeInTheDocument();
  expect(screen.getByTestId('gradient-handle-radius')).toBeInTheDocument();
  expect(screen.getByTestId('gradient-handle-focal')).toBeInTheDocument();
});

it('renders no gradient handles for a solid object', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 50, height: 30 });
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  expect(screen.queryByTestId('gradient-handles')).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx`
Expected: FAIL — no `gradient-handles` testid.

- [ ] **Step 3: Add the `selectedGradient` memo**

In `src/ui/components/Stage/Stage.tsx`, after the `selectedVector` memo (near line 100), add (and import the new helpers + a `GradientHandleId`/`Gradient`/`LocalRect` type from `../../../engine`):

```ts
  // The selected vector object's gradient + the bbox/transform needed to draw the
  // on-canvas handle overlay (select tool only). Edits fill gradient if present,
  // else stroke; reflects the SAMPLED gradient at the playhead.
  const selectedGradient = useMemo(() => {
    if (activeTool !== 'select' || !selectedId) return null;
    const obj = project.objects.find((o) => o.id === selectedId);
    const asset = obj ? assetsById.get(obj.assetId) : undefined;
    if (!obj || !asset || asset.kind !== 'vector') return null;
    const state = sampleObject(obj, time);
    const fillG = state.fillGradient ?? asset.style.fillGradient;
    const strokeG = state.strokeGradient ?? asset.style.strokeGradient;
    const property: 'fill' | 'stroke' | null = fillG ? 'fill' : strokeG ? 'stroke' : null;
    if (!property) return null;
    const gradient = (property === 'fill' ? fillG : strokeG)!;
    const sampledPath =
      asset.shapeType === 'path' ? state.path ?? asset.path ?? { nodes: [], closed: false } : undefined;
    const bbox = shapeLocalBBox(asset.shapeType, state.geometry ?? {}, sampledPath);
    const anchor = resolveAnchor(obj, state, asset.shapeType, sampledPath ? pathBounds(sampledPath) : undefined);
    const transform = buildTransform(state, anchor.anchorX, anchor.anchorY);
    return { obj, property, gradient, bbox, transform };
  }, [activeTool, selectedId, project.objects, assetsById, time]);
```

- [ ] **Step 4: Render the overlay**

Add a `gradientHandleGroupRef` near the other refs:

```ts
  const gradientHandleGroupRef = useRef<SVGGElement | null>(null);
```

After the `selectedVector` resize-handle overlay block (after its closing `)}`), add the gradient-handle overlay (use `gradientDrag?.gradient ?? selectedGradient.gradient` — `gradientDrag` is added in Task 5; for THIS task render from `selectedGradient.gradient` directly and switch to `gradientDrag?.gradient ?? …` in Task 5):

```tsx
          {selectedGradient && (
            <g
              ref={gradientHandleGroupRef}
              transform={selectedGradient.transform}
              data-testid="gradient-handles"
            >
              {(() => {
                const handles = gradientHandlePositions(selectedGradient.gradient, selectedGradient.bbox);
                const size = HANDLE_SIZE / zoom;
                const byId = Object.fromEntries(handles.map((h) => [h.id, h]));
                const lines =
                  selectedGradient.gradient.type === 'linear'
                    ? [['start', 'end'] as const]
                    : ([['center', 'radius'], ['center', 'focal']] as const);
                return (
                  <>
                    {lines.map(([a, b]) =>
                      byId[a] && byId[b] ? (
                        <line
                          key={`${a}-${b}`}
                          x1={byId[a].x}
                          y1={byId[a].y}
                          x2={byId[b].x}
                          y2={byId[b].y}
                          stroke="var(--color-accent)"
                          strokeWidth={1 / zoom}
                          pointerEvents="none"
                        />
                      ) : null,
                    )}
                    {handles.map((h) => (
                      <circle
                        key={h.id}
                        data-testid={`gradient-handle-${h.id}`}
                        cx={h.x}
                        cy={h.y}
                        r={size / 2}
                        fill="var(--color-panel)"
                        stroke="var(--color-accent)"
                        strokeWidth={1 / zoom}
                        style={{ cursor: 'pointer' }}
                        onPointerDown={(e) => onGradientHandlePointerDown(h.id, e)}
                      />
                    ))}
                  </>
                );
              })()}
            </g>
          )}
```

> `HANDLE_SIZE` and `zoom` are already in scope (used by the resize handles). `onGradientHandlePointerDown` is added in Task 5 — for THIS task, add a temporary no-op `const onGradientHandlePointerDown = (_id: GradientHandleId, _e: ReactPointerEvent) => {};` so the render compiles; Task 5 replaces it with the real handler. (Alternatively, do Tasks 4+5 in one commit — but the render is independently testable, so keep them split with the stub.)

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx`
Expected: PASS (the three new render tests + no regressions).

- [ ] **Step 6: Commit**

```bash
git add src/ui/components/Stage/Stage.tsx src/ui/components/Stage/Stage.test.tsx
git commit -m "feat(slice11): Stage gradient-handle overlay (render)"
```

---

### Task 5: Stage — drag wiring (preview + commit on release)

**Files:**
- Modify: `src/ui/components/Stage/Stage.tsx`
- Test: `src/ui/components/Stage/Stage.test.tsx`

**Interfaces:**
- Consumes: `applyGradientHandleDrag` (Task 3); `selectedGradient` (Task 4); `setVectorGradient` (store).
- Produces: dragging a handle previews the gradient live and commits once via `setVectorGradient` on pointer-up.

- [ ] **Step 1: Write the failing test (identity-CTM drag)**

Append to `src/ui/components/Stage/Stage.test.tsx`:

```ts
it('dragging the end handle commits an updated gradient (autoKey off -> static)', () => {
  stubIdentityCTM(); // client coords == object-local coords
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 100, height: 100 });
  useEditor.getState().toggleAutoKey(); // off
  useEditor.getState().setVectorGradient('fill', {
    type: 'linear', x1: 0, y1: 0.5, x2: 1, y2: 0.5,
    stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }],
  });
  const id = useEditor.getState().selectedObjectId!;
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  const end = screen.getByTestId('gradient-handle-end');
  fireEvent.pointerDown(end, { clientX: 100, clientY: 50, button: 0 });
  fireEvent.pointerMove(window, { clientX: 50, clientY: 0 });
  fireEvent.pointerUp(window, { clientX: 50, clientY: 0 });
  const asset = useEditor.getState().history.present.assets.find((a) => a.kind === 'vector')!;
  const g = asset.kind === 'vector' ? asset.style.fillGradient : undefined;
  expect(g && g.type === 'linear' && [g.x2, g.y2]).toEqual([0.5, 0]);
  expect(useEditor.getState().selectedObjectId).toBe(id);
});
```

> The `stubIdentityCTM` helper (already in the test file) makes `createSVGPoint().matrixTransform(ctm.inverse())` return the client coords, so a drag to `(50, 0)` maps to object-local `(50, 0)` → fraction `(0.5, 0)` on a 100×100 bbox.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx`
Expected: FAIL — the no-op handler does not commit.

- [ ] **Step 3: Add the drag ref + state + handlers**

In `src/ui/components/Stage/Stage.tsx`:

1. Add the ref + preview state near the other refs/state:

```ts
  const gradientDragRef = useRef<{
    id: GradientHandleId;
    property: 'fill' | 'stroke';
    bbox: { x: number; y: number; width: number; height: number };
    start: Gradient;
    current: Gradient;
  } | null>(null);
  const [gradientDrag, setGradientDrag] = useState<{ property: 'fill' | 'stroke'; gradient: Gradient } | null>(null);
```

2. Replace the temporary no-op `onGradientHandlePointerDown` with the real one:

```ts
  const onGradientHandlePointerDown = (id: GradientHandleId, e: ReactPointerEvent) => {
    if (!selectedGradient) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    gradientDragRef.current = {
      id,
      property: selectedGradient.property,
      bbox: selectedGradient.bbox,
      start: selectedGradient.gradient,
      current: selectedGradient.gradient,
    };
    setGradientDrag({ property: selectedGradient.property, gradient: selectedGradient.gradient });
  };
```

3. In the window pointer-MOVE handler, add a `gradientDragRef` branch at the TOP (before the `resizeRef` branch):

```ts
      const gd = gradientDragRef.current;
      if (gd) {
        const group = gradientHandleGroupRef.current;
        const ctm = group?.getScreenCTM();
        const svg = group?.ownerSVGElement;
        if (!group || !ctm || !svg) return;
        const pt = svg.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;
        const local = pt.matrixTransform(ctm.inverse());
        const next = applyGradientHandleDrag(gd.start, gd.id, { x: local.x, y: local.y }, gd.bbox);
        gd.current = next;
        setGradientDrag({ property: gd.property, gradient: next });
        return;
      }
```

4. In the window pointer-UP handler, add a `gradientDragRef` branch at the TOP. Null the ref BEFORE committing (StrictMode-safe), commit once:

```ts
      const gradUp = gradientDragRef.current;
      if (gradUp) {
        gradientDragRef.current = null;
        const finalGradient = gradUp.current;
        setGradientDrag(null);
        // applyGradientHandleDrag returns a fresh object on every move, so
        // current === start means no drag happened -> skip the no-op commit.
        if (finalGradient !== gradUp.start) {
          useEditor.getState().setVectorGradient(gradUp.property, finalGradient);
        }
        return;
      }
```

5. Make the overlay (Task 4 render) + the shape's `<GradientEl>` reflect the live drag. In the Task-4 overlay, change the handle source to `gradientDrag?.gradient ?? selectedGradient.gradient`:

```tsx
                const handles = gradientHandlePositions(
                  gradientDrag?.gradient ?? selectedGradient.gradient,
                  selectedGradient.bbox,
                );
```

   and in the object-render gradient resolution, override the dragged object's paint with the drag gradient:

```ts
              const dragG =
                gradientDrag && selectedGradient?.obj.id === o.id ? gradientDrag : null;
              const fillGrad =
                dragG?.property === 'fill' ? dragG.gradient : (sampledObj.fillGradient ?? asset.style.fillGradient);
              const strokeGrad =
                dragG?.property === 'stroke' ? dragG.gradient : (sampledObj.strokeGradient ?? asset.style.strokeGradient);
```

   (replace the existing `const fillGrad = …` / `const strokeGrad = …` lines added in Slice 9 with these drag-aware versions.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the full unit suite + gate (no regressions in the big Stage file)**

Run: `pnpm vitest run && pnpm typecheck && pnpm lint`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/ui/components/Stage/Stage.tsx src/ui/components/Stage/Stage.test.tsx
git commit -m "feat(slice11): Stage gradient-handle drag preview + commit"
```

---

### Task 6: End-to-end — drag a gradient handle reshapes the gradient

**Files:**
- Create: `e2e/gradient-handles.spec.ts`

**Interfaces:**
- Consumes: the whole feature.

- [ ] **Step 1: Write the e2e**

Create `e2e/gradient-handles.spec.ts` (model the draw/select boilerplate on `e2e/gradient-export.spec.ts`):

```ts
import { test, expect } from '@playwright/test';

test('drag a linear gradient end handle reshapes the gradient', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Draw a rect.
  await page.getByRole('button', { name: 'Rectangle' }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + 80, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 240, box.y + 200);
  await page.mouse.up();

  // Switch back to the select tool, assign a linear fill gradient.
  await page.getByRole('button', { name: 'Select' }).click();
  await page.getByLabel('fill paint').selectOption('linear');

  // The gradient handles are now visible. Read the live linearGradient x2 before/after.
  const grad = page.locator('linearGradient').first();
  const x2Before = await grad.getAttribute('x2');

  const endHandle = page.getByTestId('gradient-handle-end');
  const hb = (await endHandle.boundingBox())!;
  // Drag the end handle to the left by ~60px.
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 - 60, hb.y + hb.height / 2);
  await page.mouse.up();

  const x2After = await grad.getAttribute('x2');
  expect(x2After).not.toBe(x2Before); // the gradient geometry changed
});
```

> If the Select tool button label differs, check the ToolPalette (`getByRole('button', { name: 'Select' })` should match the existing select button; otherwise use its aria-label/testid as the other e2e specs do). Confirm during implementation.

- [ ] **Step 2: Run to verify it passes**

Run: `pnpm exec playwright test e2e/gradient-handles.spec.ts`
Expected: PASS.

- [ ] **Step 3: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add e2e/gradient-handles.spec.ts
git commit -m "test(e2e): drag a gradient handle reshapes the gradient"
```

---

## Self-Review (plan vs spec)

- **§3 coordinate model (bbox map + inverse, per-shape bbox)** → Task 1 (`shapeLocalBBox`) + Tasks 2/3 (`toLocal`/`toFraction`). ✅
- **§4 pure helpers (positions + drag math: linear start/end, radial center/radius/focal, clamps)** → Tasks 2–3. ✅
- **§5.1 selectedGradient memo (fill-first, sampled, per-shape bbox)** → Task 4. ✅
- **§5.2 render (handles + connector lines, sized /zoom)** → Task 4. ✅
- **§5.3 drag (ref-based, StrictMode-safe, one setVectorGradient commit)** → Task 5. ✅
- **§6 coexist with resize handles (render after, stopPropagation)** → Task 4 render is after the `selectedVector` block; handle `onPointerDown` calls `stopPropagation` (Task 5). ✅
- **§7 no persistence/render/runtime/export change** → no such files touched. ✅
- **§8 tests (pure helpers, Stage render, Stage drag, e2e)** → Tasks 1–3, 4, 5, 6. ✅
- **Type consistency:** `GradientHandleId`/`GradientHandle`/`LocalRect` defined Task 1–2, consumed Tasks 4–5; `applyGradientHandleDrag(g, id, {x,y}, bbox)` signature identical in Task 3 def + Task 5 call; `setVectorGradient(property, gradient)` matches the existing store signature. ✅
- **Placeholder scan:** the Task 4 no-op handler is an explicit, replaced-in-Task-5 stub (called out), not a left TODO; the e2e Select-button-label note has a concrete fallback. ✅
- **Spec §2 "editor-only, zero pipeline":** confirmed — only `src/engine/gradientHandles.ts`, `src/engine/index.ts`, `Stage.tsx`, tests, and one e2e are touched. No migration, no bundle regen.
