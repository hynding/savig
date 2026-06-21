# Slice 23 Scale Handles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give imported-SVG and path objects four corner scale handles that resize them via `Transform2D.scaleX/scaleY`, keeping the opposite corner fixed (rotation-aware).

**Architecture:** A pure `scaleHandles.ts` (`applyScaleHandleDrag` + corner helpers) computes the new scale + translation from a drag, opposite-corner-fixed. A `selectedScalable` memo in `Stage.tsx` (svg + path only; rect/ellipse keep resize) drives a corner-handle overlay; a `scaleRef` drag machine maps the pointer to content space via the existing `clientToLocal`, previews imperatively, and commits one `setProperties({scaleX,scaleY,x,y})`. Editor-only — Transform2D already round-trips/animates/exports.

**Tech Stack:** TypeScript (strict), React 18, Zustand, Vitest + RTL, Playwright.

## Global Constraints

- TypeScript strict; no `any`. Match surrounding code style.
- 4 **corner** handles, **opposite-corner-fixed**, rotation-aware, per-axis; `MIN_SCALE = 0.05` clamp (no flip).
- `selectedScalable` is for **path & imported-SVG only**. Rect/ellipse (resize) and audio → null. `selectedVector` (resize)/`selectedGradient` are unchanged, so an object never shows both resize and scale overlays.
- SVG branch: `bbox = {x:0,y:0,width:asset.width,height:asset.height}`, anchor `= resolveAnchor(obj,state,undefined)` (absolute). Path branch: `bbox = shapeLocalBBox('path', state.geometry ?? {}, sampledPath)`, anchor `= resolveAnchor(obj,state,'path',pathBounds(sampledPath))`.
- Keep the `obj.hidden || obj.locked` exclusion (S17/19). autoKey-off → handles render, drag no-ops (resize/rotate parity).
- Commit via `setProperties({scaleX,scaleY,x,y})` (all `AnimatableProperty`) — one undo step; `scaleRef.current = null` BEFORE the commit (StrictMode-safe).
- Editor-only: NO engine/render/runtime/export/migration change. Stays v4.
- Run the full gate before declaring done: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`.

---

### Task 1: Pure `scaleHandles.ts` + unit tests

**Files:**
- Create: `src/ui/components/Stage/scaleHandles.ts`
- Test: `src/ui/components/Stage/scaleHandles.test.ts`

**Interfaces:**
- Produces: `ScaleHandleId`, `SCALE_HANDLE_IDS`, `MIN_SCALE`, `scaleHandleLocalPositions(bbox)`, `oppositeCorner(id)`, `applyScaleHandleDrag(input): { scaleX, scaleY, x, y }` (see signatures below).

- [ ] **Step 1: Write the failing tests**

Create `src/ui/components/Stage/scaleHandles.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { applyScaleHandleDrag, scaleHandleLocalPositions, oppositeCorner, MIN_SCALE } from './scaleHandles';

// 100x100 bbox at origin, anchor at centre (50,50), no rotation, scale 1, base (0,0).
const base = {
  anchorX: 50, anchorY: 50,
  startScaleX: 1, startScaleY: 1,
  baseX: 0, baseY: 0,
  rotationDeg: 0,
};

describe('scaleHandleLocalPositions / oppositeCorner', () => {
  it('places the four corners (respecting a non-zero bbox origin)', () => {
    const p = scaleHandleLocalPositions({ x: 10, y: 20, width: 100, height: 60 });
    expect(p.nw).toEqual({ x: 10, y: 20 });
    expect(p.ne).toEqual({ x: 110, y: 20 });
    expect(p.se).toEqual({ x: 110, y: 80 });
    expect(p.sw).toEqual({ x: 10, y: 80 });
  });
  it('maps each corner to its diagonal opposite', () => {
    expect(oppositeCorner('nw')).toBe('se');
    expect(oppositeCorner('se')).toBe('nw');
    expect(oppositeCorner('ne')).toBe('sw');
    expect(oppositeCorner('sw')).toBe('ne');
  });
});

describe('applyScaleHandleDrag', () => {
  it('dragging SE to (200,200) doubles the scale and keeps NW fixed', () => {
    const r = applyScaleHandleDrag({
      ...base,
      corner: { x: 100, y: 100 }, // SE local
      opposite: { x: 0, y: 0 }, // NW local
      pointerX: 200, pointerY: 200, // content coords
    });
    expect(r.scaleX).toBeCloseTo(2);
    expect(r.scaleY).toBeCloseTo(2);
    expect(r.x).toBeCloseTo(50);
    expect(r.y).toBeCloseTo(50);
    // Recompute the NW (fixed) corner's content position from the result:
    // content(p) = a + R·S·(p-a) + (x,y); rot=0 -> a + S·(p-a) + (x,y).
    const nwContentX = 50 + r.scaleX * (0 - 50) + r.x;
    const nwContentY = 50 + r.scaleY * (0 - 50) + r.y;
    expect(nwContentX).toBeCloseTo(0); // NW stays where it started (content 0,0)
    expect(nwContentY).toBeCloseTo(0);
  });

  it('keeps the opposite corner fixed under rotation (90deg)', () => {
    const rot = 90;
    const corner = { x: 100, y: 100 }; // SE
    const opposite = { x: 0, y: 0 }; // NW (fixed)
    // Start content position of NW with rot=90, scale 1, base (0,0):
    // content = a + R·S·(o-a) + base; R(90)·(o-a) = R(90)·(-50,-50) = (50,-50).
    const startNwX = 50 + 50; // 100
    const startNwY = 50 + -50; // 0
    const r = applyScaleHandleDrag({ ...base, rotationDeg: rot, corner, opposite, pointerX: 300, pointerY: 120 });
    const t = (rot * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
    // content(NW) from the result: a + R·S·(o-a) + (x,y)
    const vx = r.scaleX * (0 - 50), vy = r.scaleY * (0 - 50);
    const nwX = 50 + (c * vx - s * vy) + r.x;
    const nwY = 50 + (s * vx + c * vy) + r.y;
    expect(nwX).toBeCloseTo(startNwX);
    expect(nwY).toBeCloseTo(startNwY);
  });

  it('clamps a collapsing drag to MIN_SCALE', () => {
    const r = applyScaleHandleDrag({
      ...base,
      corner: { x: 100, y: 100 }, opposite: { x: 0, y: 0 },
      pointerX: 0, pointerY: 0, // dragged onto the opposite corner -> would be scale 0
    });
    expect(r.scaleX).toBeCloseTo(MIN_SCALE);
    expect(r.scaleY).toBeCloseTo(MIN_SCALE);
  });
});
```

> Verify the SE case by hand: `u = R(0)·((200,200) − (50,50) − (0,0)) − 1·((0,0)−(50,50)) = (150,150) − (−50,−50) = (200,200)`; `sx = 200/(100−0) = 2`; `(x,y) = (0,0) + (1−2)·((0,0)−(50,50)) = (−1)·(−50,−50) = (50,50)`. ✓

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/ui/components/Stage/scaleHandles.test.ts`
Expected: FAIL — module not found / functions undefined.

- [ ] **Step 3: Implement the helper**

Create `src/ui/components/Stage/scaleHandles.ts`:

```ts
export type ScaleHandleId = 'nw' | 'ne' | 'se' | 'sw';
export const SCALE_HANDLE_IDS: readonly ScaleHandleId[] = ['nw', 'ne', 'se', 'sw'];
export const MIN_SCALE = 0.05;

export function scaleHandleLocalPositions(
  bbox: { x: number; y: number; width: number; height: number },
): Record<ScaleHandleId, { x: number; y: number }> {
  const { x, y, width, height } = bbox;
  return {
    nw: { x, y },
    ne: { x: x + width, y },
    se: { x: x + width, y: y + height },
    sw: { x, y: y + height },
  };
}

export function oppositeCorner(id: ScaleHandleId): ScaleHandleId {
  return ({ nw: 'se', se: 'nw', ne: 'sw', sw: 'ne' } as const)[id];
}

export interface ScaleInput {
  corner: { x: number; y: number };
  opposite: { x: number; y: number };
  anchorX: number;
  anchorY: number;
  startScaleX: number;
  startScaleY: number;
  baseX: number;
  baseY: number;
  rotationDeg: number;
  pointerX: number;
  pointerY: number;
}
export interface ScaleResult {
  scaleX: number;
  scaleY: number;
  x: number;
  y: number;
}

/** Scale the object so the dragged `corner` follows the pointer while the diagonal
 *  `opposite` corner stays fixed in content space (rotation-aware). See the spec §2.
 *  Corner/opposite/anchor are object-local; pointer/base are content coords. */
export function applyScaleHandleDrag(i: ScaleInput): ScaleResult {
  const t = (i.rotationDeg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  // u = R(-rot) · (P - a - base) - S0 · (o - a)
  const dx = i.pointerX - i.anchorX - i.baseX;
  const dy = i.pointerY - i.anchorY - i.baseY;
  const rx = c * dx + s * dy; // R(-t) row 1
  const ry = -s * dx + c * dy; // R(-t) row 2
  const ux = rx - i.startScaleX * (i.opposite.x - i.anchorX);
  const uy = ry - i.startScaleY * (i.opposite.y - i.anchorY);
  const dcx = i.corner.x - i.opposite.x;
  const dcy = i.corner.y - i.opposite.y;
  let sx = dcx === 0 ? i.startScaleX : ux / dcx;
  let sy = dcy === 0 ? i.startScaleY : uy / dcy;
  if (!(sx >= MIN_SCALE)) sx = MIN_SCALE; // also catches NaN / negative
  if (!(sy >= MIN_SCALE)) sy = MIN_SCALE;
  // (x,y) = base + R(rot) · (S0 - S1) · (o - a)
  const vx = (i.startScaleX - sx) * (i.opposite.x - i.anchorX);
  const vy = (i.startScaleY - sy) * (i.opposite.y - i.anchorY);
  const x = i.baseX + (c * vx - s * vy);
  const y = i.baseY + (s * vx + c * vy);
  return { scaleX: sx, scaleY: sy, x, y };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm vitest run src/ui/components/Stage/scaleHandles.test.ts`
Expected: PASS (all 5).

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/Stage/scaleHandles.ts src/ui/components/Stage/scaleHandles.test.ts
git commit -m "feat(slice23): pure applyScaleHandleDrag (opposite-corner-fixed, rotation-aware)"
```

---

### Task 2: Stage — `selectedScalable` memo, overlay, and drag machine

**Files:**
- Modify: `src/ui/components/Stage/Stage.tsx`
- Test: `src/ui/components/Stage/Stage.test.tsx`

**Interfaces:**
- Consumes: Task 1 (`applyScaleHandleDrag`, `scaleHandleLocalPositions`, `oppositeCorner`, `SCALE_HANDLE_IDS`, `ScaleHandleId`, `ScaleResult`); existing `clientToLocal`, `buildTransform`, `sampleObject`, `resolveAnchor`, `shapeLocalBBox`, `pathBounds`, `HANDLE_SIZE`.

- [ ] **Step 1: Write the failing Stage tests**

Append to `src/ui/components/Stage/Stage.test.tsx`:

```ts
it('renders scale handles for a selected imported-svg object', () => {
  const svgText = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>';
  useEditor.getState().newProject();
  useEditor.getState().addAsset({ id: 'a', kind: 'svg', name: 'box', normalizedContent: svgText, viewBox: '0 0 100 100', width: 100, height: 100 });
  useEditor.getState().addObject('a'); // auto-selected
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  expect(screen.getByTestId('scale-handles')).toBeInTheDocument();
  expect(screen.getByTestId('scale-handle-se')).toBeInTheDocument();
});

it('renders scale handles for a selected path object', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorPath({ nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 40, y: 0 } }, { anchor: { x: 40, y: 30 } }], closed: true });
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  expect(screen.getByTestId('scale-handles')).toBeInTheDocument();
});

it('renders NO scale handles for a rect (it has resize handles)', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 50, height: 30 });
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  expect(screen.queryByTestId('scale-handles')).toBeNull();
  expect(screen.getByTestId('resize-handles')).toBeInTheDocument();
});

it('dragging a scale corner on an imported-svg object commits scaleX/scaleY', () => {
  stubIdentityCTM(); // client coords == content coords
  const svgText = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"></svg>';
  useEditor.getState().newProject(); // autoKey on
  useEditor.getState().addAsset({ id: 'a', kind: 'svg', name: 'box', normalizedContent: svgText, viewBox: '0 0 100 100', width: 100, height: 100 });
  useEditor.getState().addObject('a'); // anchor (50,50), at (0,0)
  useEditor.getState().seek(0);
  const id = useEditor.getState().selectedObjectId!;
  const nodes = new Map<string, SVGGraphicsElement>([[id, document.createElementNS('http://www.w3.org/2000/svg', 'g')]]);
  render(<Stage nodes={nodes} />);
  const se = screen.getByTestId('scale-handle-se'); // SE corner, content (100,100) at scale 1
  fireEvent.pointerDown(se, { clientX: 100, clientY: 100, button: 0 });
  fireEvent.pointerMove(window, { clientX: 200, clientY: 200 }); // drag out -> scale 2
  fireEvent.pointerUp(window, { clientX: 200, clientY: 200 });
  const obj = useEditor.getState().history.present.objects.find((o) => o.id === id)!;
  expect(obj.tracks.scaleX?.[0].value).toBeCloseTo(2);
  expect(obj.tracks.scaleY?.[0].value).toBeCloseTo(2);
});
```

> `stubIdentityCTM` stubs BOTH the resize-handle group CTM path and `clientToLocal`'s
> content-group CTM to identity (it stubs `SVGElement.prototype.getScreenCTM` globally), so
> client coords map 1:1 to content coords. The SE corner of a 100×100 svg at scale 1, base
> (0,0) is at content (100,100); dragging to (200,200) gives scale 2 (anchor-50 case, NW fixed).

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx -t "scale"`
Expected: FAIL — no `scale-handles` overlay / no scaleX track committed.

- [ ] **Step 3: Add the imports**

In `src/ui/components/Stage/Stage.tsx`, add the import from `./scaleHandles` (new). `HANDLE_SIZE` is a local module const in `Stage.tsx` (`const HANDLE_SIZE = 8;`, already in scope — no import needed):

```ts
import {
  applyScaleHandleDrag,
  scaleHandleLocalPositions,
  oppositeCorner,
  SCALE_HANDLE_IDS,
  type ScaleHandleId,
  type ScaleResult,
} from './scaleHandles';
```

- [ ] **Step 4: Add the `selectedScalable` memo**

Immediately AFTER the `selectedRotatable` memo (it ends with `}, [activeTool, selectedId, project.objects, assetsById, time]);`), insert:

```ts
  // Path & imported-SVG objects get on-canvas SCALE handles (Transform2D.scaleX/scaleY).
  // Rect/ellipse use the geometry-resize overlay (selectedVector) instead — mutually exclusive.
  const selectedScalable = useMemo(() => {
    if (activeTool !== 'select' || !selectedId) return null;
    const obj = project.objects.find((o) => o.id === selectedId);
    const asset = obj ? assetsById.get(obj.assetId) : undefined;
    if (!obj || obj.hidden || obj.locked || !asset) return null;
    const state = sampleObject(obj, time);
    let bbox: LocalRect;
    let anchorX: number;
    let anchorY: number;
    if (asset.kind === 'vector' && asset.shapeType === 'path') {
      const sampledPath = state.path ?? asset.path ?? { nodes: [], closed: false };
      bbox = shapeLocalBBox('path', state.geometry ?? {}, sampledPath);
      const anchor = resolveAnchor(obj, state, 'path', pathBounds(sampledPath));
      anchorX = anchor.anchorX;
      anchorY = anchor.anchorY;
    } else if (asset.kind === 'svg') {
      bbox = { x: 0, y: 0, width: asset.width, height: asset.height };
      const anchor = resolveAnchor(obj, state, undefined);
      anchorX = anchor.anchorX;
      anchorY = anchor.anchorY;
    } else {
      return null; // rect/ellipse (resize) and audio
    }
    const transform = buildTransform(state, anchorX, anchorY);
    return { obj, state, bbox, anchorX, anchorY, transform };
  }, [activeTool, selectedId, project.objects, assetsById, time]);
```

- [ ] **Step 5: Add the refs + pointer-down handler**

Next to the `rotateRef` declaration (and `rotateHandleGroupRef`), add:

```ts
  const scaleGroupRef = useRef<SVGGElement | null>(null);
  const scaleRef = useRef<{
    snapshot: {
      objId: string;
      state: RenderState;
      corner: { x: number; y: number };
      opposite: { x: number; y: number };
      anchorX: number;
      anchorY: number;
      startScaleX: number;
      startScaleY: number;
      baseX: number;
      baseY: number;
      rotationDeg: number;
    };
    last?: ScaleResult;
  } | null>(null);
  const onScaleHandlePointerDown = (id: ScaleHandleId, e: ReactPointerEvent) => {
    // Transform edits flow through keyframes (setProperties is autoKey-gated) — parity with resize/rotate.
    if (!selectedScalable || !useEditor.getState().autoKey) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const corners = scaleHandleLocalPositions(selectedScalable.bbox);
    scaleRef.current = {
      snapshot: {
        objId: selectedScalable.obj.id,
        state: selectedScalable.state,
        corner: corners[id],
        opposite: corners[oppositeCorner(id)],
        anchorX: selectedScalable.anchorX,
        anchorY: selectedScalable.anchorY,
        startScaleX: selectedScalable.state.scaleX,
        startScaleY: selectedScalable.state.scaleY,
        baseX: selectedScalable.state.x,
        baseY: selectedScalable.state.y,
        rotationDeg: selectedScalable.state.rotation,
      },
    };
  };
```

- [ ] **Step 6: Add the `onMove` + `onUp` branches**

In the window `onMove` (the `useEffect` whose `onMove` starts `const rot = rotateRef.current;`), insert this branch at the very TOP of `onMove`, before `const rot = rotateRef.current;`:

```ts
      const sc = scaleRef.current;
      if (sc) {
        const local = clientToLocal(e.clientX, e.clientY); // content coords
        if (!local) return;
        const snap = sc.snapshot;
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
        });
        sc.last = r;
        const previewTransform = buildTransform(
          { ...snap.state, scaleX: r.scaleX, scaleY: r.scaleY, x: r.x, y: r.y },
          snap.anchorX,
          snap.anchorY,
        );
        const node = nodes.get(snap.objId);
        if (node) node.setAttribute('transform', previewTransform);
        if (scaleGroupRef.current) scaleGroupRef.current.setAttribute('transform', previewTransform);
        return;
      }
```

In the same `useEffect`'s window `onUp` (starts `const onUp = () => {` … with the `rotUp`/`gradUp`/`rz` branches), insert at the very TOP of `onUp`:

```ts
      const scUp = scaleRef.current;
      if (scUp) {
        const snap = scUp.snapshot;
        const last = scUp.last;
        scaleRef.current = null;
        if (last) {
          const s = useEditor.getState();
          s.selectObject(snap.objId);
          s.setProperties({ scaleX: last.scaleX, scaleY: last.scaleY, x: last.x, y: last.y });
        }
        return;
      }
```

- [ ] **Step 7: Add the overlay render**

Immediately AFTER the `selectedVector && (<g … data-testid="resize-handles">…</g>)` block (it closes with `)}` around line 948) and before the `selectedGradient && (…)` block, insert:

```tsx
          {selectedScalable && (
            <g ref={scaleGroupRef} transform={selectedScalable.transform} data-testid="scale-handles">
              {SCALE_HANDLE_IDS.map((id) => {
                const pos = scaleHandleLocalPositions(selectedScalable.bbox)[id];
                const size = HANDLE_SIZE / zoom;
                return (
                  <rect
                    key={id}
                    data-testid={`scale-handle-${id}`}
                    x={pos.x - size / 2}
                    y={pos.y - size / 2}
                    width={size}
                    height={size}
                    fill="var(--color-accent)"
                    stroke="var(--color-panel)"
                    style={{ cursor: 'pointer' }}
                    onPointerDown={(e) => onScaleHandlePointerDown(id, e)}
                  />
                );
              })}
            </g>
          )}
```

- [ ] **Step 8: Run to verify they pass + gate**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx`
Expected: PASS (4 new scale tests + all existing Stage tests).
Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add src/ui/components/Stage/Stage.tsx src/ui/components/Stage/Stage.test.tsx
git commit -m "feat(slice23): scale-handle overlay + drag for imported-svg & path objects"
```

---

### Task 3: End-to-end — scale an imported SVG

**Files:**
- Create: `e2e/scale-handles.spec.ts`

**Interfaces:**
- Consumes: the whole feature (Tasks 1–2).

- [ ] **Step 1: Write the e2e**

Create `e2e/scale-handles.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test('drag a scale corner resizes an imported-svg object', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Import the fixture SVG and instance it (auto-selected).
  await page.getByLabel('Import SVG').setInputFiles('e2e/fixtures/box.svg');
  await page.getByRole('button', { name: 'box.svg' }).click();
  await page.getByRole('button', { name: 'Select' }).click();

  // Move it into the stage interior so its corner handles are clearly draggable.
  const xField = page.getByLabel('x', { exact: true });
  await xField.fill('150');
  await xField.blur();
  const yField = page.getByLabel('y', { exact: true });
  await yField.fill('120');
  await yField.blur();

  const obj = page.locator('[data-savig-object]').first();
  const before = await obj.getAttribute('transform');
  expect(before).toMatch(/scale\(1, 1\)/);

  // Drag the SE corner outward.
  const handle = page.getByTestId('scale-handle-se');
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 60, hb.y + 60);
  await page.mouse.up();

  const after = await obj.getAttribute('transform');
  expect(after).not.toBe(before);
  expect(after).not.toMatch(/scale\(1, 1\)/); // scale changed
});
```

- [ ] **Step 2: Run the e2e**

Run: `pnpm exec playwright test e2e/scale-handles.spec.ts`
Expected: PASS.

> If `before` does not contain `scale(1, 1)`, log the actual transform and match the real
> initial scale token instead; the assertion that matters is `after !== before` and the
> scale token changed. The import→instance→reposition sequence mirrors the working
> `svg-rotate.spec.ts`.

- [ ] **Step 3: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add e2e/scale-handles.spec.ts
git commit -m "test(e2e): scale corner resizes an imported-svg object"
```

---

## Self-Review (plan vs spec)

- **§2 pure `applyScaleHandleDrag` (opposite-corner-fixed, rotation-aware, MIN_SCALE)** → Task 1 + 5 unit tests (SE-doubles-NW-fixed hand-verified, rotated-fixed, clamp). ✅
- **§3 `selectedScalable` (svg + path only; rect/ellipse/audio → null)** → Task 2 Step 4 + the svg/path/rect Stage tests. ✅
- **§4 overlay + `scaleRef` drag (content-space pointer via clientToLocal; preview; one `setProperties` commit; ref nulled first)** → Task 2 Steps 5–7 + the drag-commit test. ✅
- **§5 coexists with rotate handle** → the scale overlay is a separate `<g>`; the svg render test still has the rotate handle (unchanged). ✅
- **§6 editor-only (no engine/render/runtime/export/migration)** → only `scaleHandles.ts` + `Stage.tsx` + tests + one e2e. ✅
- **§7 edges (hidden/locked excluded; autoKey-off no-op; MIN_SCALE clamp; degenerate bbox guard `c===o`)** → memo guard unchanged; `onScaleHandlePointerDown` autoKey gate; clamp + `dcx===0`/`dcy===0` guards in the helper. ✅
- **§10 testing (pure ×5, Stage ×4, e2e)** → Tasks 1–3. ✅
- **Type/name consistency:** `applyScaleHandleDrag(ScaleInput)→ScaleResult`, `scaleHandleLocalPositions`, `oppositeCorner`, `SCALE_HANDLE_IDS`, `ScaleHandleId` identical across Task 1 def, Task 2 import/use, and the tests. The memo return `{obj,state,bbox,anchorX,anchorY,transform}` matches `selectedRotatable`'s shape (consumers reuse the pattern). testids `scale-handles`/`scale-handle-<id>`. ✅
- **Placeholder scan:** every step carries concrete code; the e2e + Stage drag mirror the proven S22 rotate specs. ✅
