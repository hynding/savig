# Slice 33 — Stage snapping / alignment guides — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Object move-drag snaps its stage-space AABB (edges + centers) to other objects and the artboard within a screen-px threshold, drawing alignment guides; a `snapEnabled` toggle gates it.

**Architecture:** Pure `transformedAABB` + `computeSnap` in a new `src/ui/components/Stage/snapping.ts`. Stage computes the dragged object's base AABB + target AABBs at drag start, snaps the raw pointer position each move, applies the offset to the previewed/committed `x/y`, and renders guide lines. Editor-only — no engine/export/runtime/persistence change.

**Tech Stack:** TS, React + RTL, Playwright; `src/ui/components/Stage/`.

## Global Constraints

- Editor-only: NO engine/export/runtime/persistence/migration change (v4); no bundle regen.
- Snap computed from the RAW (unsnapped) pointer position each move (no accumulation/feedback).
- `snapEnabled` default true; when false, drag is unsnapped and no guides draw.
- Full gate before merge: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`.
- Commit footer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Pure `snapping.ts` (`transformedAABB` + `computeSnap`)

**Files:**
- Create: `src/ui/components/Stage/snapping.ts`
- Test: `src/ui/components/Stage/snapping.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface AABB { minX: number; minY: number; maxX: number; maxY: number }
  export interface XformParams { anchorX: number; anchorY: number; scaleX: number; scaleY: number; rotationDeg: number; baseX: number; baseY: number }
  export interface SnapResult { dx: number; dy: number; guideX: number | null; guideY: number | null }
  export const SNAP_PX = 6;
  export function transformedAABB(rect: { x: number; y: number; width: number; height: number }, t: XformParams): AABB;
  export function computeSnap(moving: AABB, targets: AABB[], threshold: number): SnapResult;
  ```

- [ ] **Step 1: Write the failing tests** — `snapping.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { transformedAABB, computeSnap, type AABB } from './snapping';

describe('transformedAABB', () => {
  it('translates an unrotated unit-scaled rect by base', () => {
    const b = transformedAABB({ x: 0, y: 0, width: 100, height: 50 }, { anchorX: 0, anchorY: 0, scaleX: 1, scaleY: 1, rotationDeg: 0, baseX: 10, baseY: 20 });
    expect(b).toEqual({ minX: 10, minY: 20, maxX: 110, maxY: 70 });
  });
  it('swaps extents for a 90-degree rotation about the centre', () => {
    const b = transformedAABB({ x: 0, y: 0, width: 100, height: 50 }, { anchorX: 50, anchorY: 25, scaleX: 1, scaleY: 1, rotationDeg: 90, baseX: 0, baseY: 0 });
    expect(b.minX).toBeCloseTo(25);
    expect(b.maxX).toBeCloseTo(75);
    expect(b.minY).toBeCloseTo(-25);
    expect(b.maxY).toBeCloseTo(75);
  });
  it('scales about the origin anchor', () => {
    const b = transformedAABB({ x: 0, y: 0, width: 100, height: 50 }, { anchorX: 0, anchorY: 0, scaleX: 2, scaleY: 2, rotationDeg: 0, baseX: 0, baseY: 0 });
    expect(b).toEqual({ minX: 0, minY: 0, maxX: 200, maxY: 100 });
  });
});

describe('computeSnap', () => {
  const moving: AABB = { minX: 100, minY: 100, maxX: 200, maxY: 150 };
  it('snaps the near left edge and reports a vertical guide; no Y snap', () => {
    const target: AABB = { minX: 103, minY: 300, maxX: 203, maxY: 350 };
    const r = computeSnap(moving, [target], 6);
    expect(r.dx).toBeCloseTo(3); // 100 -> 103
    expect(r.guideX).toBeCloseTo(103);
    expect(r.dy).toBe(0);
    expect(r.guideY).toBeNull();
  });
  it('snaps centre-to-centre', () => {
    const target: AABB = { minX: 2, minY: 124, maxX: 102, maxY: 126 }; // centre (52,125)
    const r = computeSnap({ minX: 0, minY: 100, maxX: 100, maxY: 150 }, [target], 6);
    expect(r.dx).toBeCloseTo(2); // centre 50 -> 52
    expect(r.guideX).toBeCloseTo(52);
  });
  it('picks the nearest candidate', () => {
    const far: AABB = { minX: 103, minY: 999, maxX: 203, maxY: 1099 };
    const near: AABB = { minX: 101, minY: 999, maxX: 201, maxY: 1099 };
    const r = computeSnap(moving, [far, near], 6);
    expect(r.dx).toBeCloseTo(1); // 100 -> 101 (nearest)
    expect(r.guideX).toBeCloseTo(101);
  });
  it('does not snap beyond the threshold', () => {
    const target: AABB = { minX: 120, minY: 100, maxX: 220, maxY: 150 };
    const r = computeSnap(moving, [target], 6);
    expect(r).toEqual({ dx: 0, dy: 0, guideX: null, guideY: null });
  });
  it('snaps both axes independently', () => {
    const target: AABB = { minX: 104, minY: 104, maxX: 204, maxY: 154 };
    const r = computeSnap(moving, [target], 6);
    expect(r.dx).toBeCloseTo(4);
    expect(r.dy).toBeCloseTo(4);
    expect(r.guideX).toBeCloseTo(104);
    expect(r.guideY).toBeCloseTo(104);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/ui/components/Stage/snapping.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement** — `snapping.ts`:

```ts
export interface AABB { minX: number; minY: number; maxX: number; maxY: number }
export interface XformParams {
  anchorX: number; anchorY: number; scaleX: number; scaleY: number; rotationDeg: number; baseX: number; baseY: number;
}
export interface SnapResult { dx: number; dy: number; guideX: number | null; guideY: number | null }

export const SNAP_PX = 6;

// content(p) = anchor + R(rot)·diag(sx,sy)·(p−anchor) + base, then AABB of the 4 corners.
export function transformedAABB(
  rect: { x: number; y: number; width: number; height: number },
  t: XformParams,
): AABB {
  const rad = (t.rotationDeg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of corners) {
    const ex = t.scaleX * (p.x - t.anchorX);
    const ey = t.scaleY * (p.y - t.anchorY);
    const x = t.anchorX + (c * ex - s * ey) + t.baseX;
    const y = t.anchorY + (s * ex + c * ey) + t.baseY;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

function linesX(b: AABB): number[] { return [b.minX, (b.minX + b.maxX) / 2, b.maxX]; }
function linesY(b: AABB): number[] { return [b.minY, (b.minY + b.maxY) / 2, b.maxY]; }

function bestAxis(movingLines: number[], targets: AABB[], pick: (b: AABB) => number[], threshold: number): { delta: number; guide: number | null } {
  let delta = 0;
  let guide: number | null = null;
  let bestAbs = threshold + 1; // strictly within threshold to win
  for (const tb of targets) {
    for (const tl of pick(tb)) {
      for (const ml of movingLines) {
        const d = tl - ml;
        const ad = Math.abs(d);
        if (ad <= threshold && ad < bestAbs) {
          bestAbs = ad;
          delta = d;
          guide = tl;
        }
      }
    }
  }
  return { delta, guide };
}

export function computeSnap(moving: AABB, targets: AABB[], threshold: number): SnapResult {
  const x = bestAxis(linesX(moving), targets, linesX, threshold);
  const y = bestAxis(linesY(moving), targets, linesY, threshold);
  return { dx: x.delta, dy: y.delta, guideX: x.guide, guideY: y.guide };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run src/ui/components/Stage/snapping.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/Stage/snapping.ts src/ui/components/Stage/snapping.test.ts
git commit -m "feat(slice33): pure transformedAABB + computeSnap (edges/centers, nearest within threshold)"
```

---

### Task 2: Store toggle + Stage move-drag snapping + guide overlay

**Files:**
- Modify: `src/ui/store/store.ts` (`snapEnabled` + `toggleSnap`)
- Modify: `src/ui/components/Stage/Stage.tsx`
- Test: `src/ui/components/Stage/Stage.test.tsx`

**Interfaces:**
- Consumes: Task 1.
- Produces: `snapEnabled: boolean`, `toggleSnap(): void`, `setSnapEnabled(b: boolean): void`.

- [ ] **Step 1: Store** — add `snapEnabled: boolean;`, `toggleSnap(): void;`, `setSnapEnabled(b: boolean): void;` to the interface; add `snapEnabled: true` to the INITIAL state OUTSIDE `TRANSIENT_DEFAULTS` (so `newProject` preserves it — like `clipboard`); implement:
```ts
toggleSnap() { set({ snapEnabled: !get().snapEnabled }); },
setSnapEnabled(b) { set({ snapEnabled: b }); },
```

- [ ] **Step 2: Stage helper + drag wiring**

Add an `objectAABB(obj, asset, time): AABB | null` helper (module-scope in Stage.tsx, reusing the rotate-handle bbox/anchor resolution): vector → `shapeLocalBBox` + `resolveAnchor(pathBounds)`, svg → `{0,0,asset.width,asset.height}` + `resolveAnchor(undefined)`, else null; then `transformedAABB(bbox, { anchorX, anchorY, scaleX: state.scaleX, scaleY: state.scaleY, rotationDeg: state.rotation, baseX: state.x, baseY: state.y })`.

Extend `DragState` with `baseAABB: AABB | null; targets: AABB[]`.

In `onObjectPointerDown` (after building `dragRef.current`), compute:
```ts
const proj = useEditor.getState().history.present;
const t = useEditor.getState().time;
const self = objectAABB(obj, assetsById.get(obj.assetId), t);
const targets: AABB[] = [];
for (const o of proj.objects) {
  if (o.id === id) continue;
  const a = objectAABB(o, assetsById.get(o.assetId), t);
  if (a) targets.push(a);
}
targets.push({ minX: 0, minY: 0, maxX: proj.meta.width, maxY: proj.meta.height }); // artboard
dragRef.current.baseAABB = self;
dragRef.current.targets = targets;
```
(Assign these into the object literal or right after.)

In the move-drag `onMove` block, replace the raw assignment with a raw-then-snap:
```ts
const z = useEditor.getState().zoom ?? 1;
const rawX = d.originX + (e.clientX - d.startX) / z;
const rawY = d.originY + (e.clientY - d.startY) / z;
let snapX = rawX, snapY = rawY;
if (useEditor.getState().snapEnabled && d.baseAABB) {
  const moving: AABB = {
    minX: d.baseAABB.minX + (rawX - d.originX), maxX: d.baseAABB.maxX + (rawX - d.originX),
    minY: d.baseAABB.minY + (rawY - d.originY), maxY: d.baseAABB.maxY + (rawY - d.originY),
  };
  const snap = computeSnap(moving, d.targets, SNAP_PX / z);
  snapX = rawX + snap.dx; snapY = rawY + snap.dy;
  setSnapGuides({ x: snap.guideX, y: snap.guideY });
} else {
  setSnapGuides({ x: null, y: null });
}
d.curX = snapX; d.curY = snapY;
d.moved = true;
// ... existing imperative preview using d.curX/d.curY ...
```

Add `const [snapGuides, setSnapGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });`. In `onUp` (move-drag branch) reset `setSnapGuides({ x: null, y: null })` before/after the commit. (Also reset on the early `if (!d) return` paths is unnecessary — only the move branch sets them.)

- [ ] **Step 3: Guide overlay render** — inside the Stage's pan/zoom content `<g>` (where object/handle overlays render), add:
```tsx
{snapGuides.x !== null && (
  <line data-testid="snap-guide-x" x1={snapGuides.x} y1={-100000} x2={snapGuides.x} y2={100000} stroke="var(--color-accent, #f0f)" strokeWidth={1 / (zoom ?? 1)} pointerEvents="none" />
)}
{snapGuides.y !== null && (
  <line data-testid="snap-guide-y" x1={-100000} y1={snapGuides.y} x2={100000} y2={snapGuides.y} stroke="var(--color-accent, #f0f)" strokeWidth={1 / (zoom ?? 1)} pointerEvents="none" />
)}
```
(Place alongside the existing guide/handle overlays so it shares their coordinate transform. Use whatever accent token the repo defines.)

- [ ] **Step 4: Stage integration test** — append to `Stage.test.tsx` (reuse `stubIdentityCTM` and the existing object-drag harness):

```ts
it('snaps a dragged object to another object edge and shows a guide', () => {
  stubIdentityCTM();
  useEditor.getState().newProject();
  useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 100, height: 50 }); // target at (0,0)
  useEditor.getState().addVectorShape('rect', { x: 300, y: 300, width: 100, height: 50 }); // mover
  useEditor.getState().seek(0);
  const moverId = useEditor.getState().selectedObjectId!;
  const nodes = new Map<string, SVGGraphicsElement>();
  for (const o of useEditor.getState().history.present.objects) nodes.set(o.id, document.createElementNS('http://www.w3.org/2000/svg', 'g'));
  render(<Stage nodes={nodes} />);
  // drag the mover so its left edge lands ~3px from the target's left edge (x=0).
  // (pin the exact client coords to the identity-CTM harness so raw x -> ~3, snaps to 0.)
  // fireEvent.pointerDown on the mover, pointerMove to within 6px, pointerUp.
  // assert the committed x snapped to 0 (aligned) and a snap-guide-x line rendered mid-drag.
});
```
(Pin the drag coordinates to the harness; assert the committed `x` is the aligned value and that `screen.queryByTestId('snap-guide-x')` was present during the move. Add a second assertion path with `setSnapEnabled(false)` → no snap.)

- [ ] **Step 5: Run**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx src/ui/store/store.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ui/store/store.ts src/ui/components/Stage/Stage.tsx src/ui/components/Stage/Stage.test.tsx
git commit -m "feat(slice33): move-drag snapping + alignment guide overlay + snapEnabled toggle"
```

---

### Task 3: Toolbar toggle + e2e

**Files:**
- Modify: a toolbar component (e.g. `src/ui/components/Toolbar/FileToolbar.tsx` or the tool area) for the Snap toggle
- Test: that component's test (assert the toggle flips `snapEnabled`)
- Test: `e2e/snapping.spec.ts` (create)

- [ ] **Step 1: Toggle UI** — add a "Snap" checkbox/button bound to `snapEnabled` + `toggleSnap` in a sensible toolbar spot (mirror an existing boolean toggle like onion-skin if present). Keep it labelled so `getByLabelText/getByRole` can target it.

- [ ] **Step 2: Component test** — render the toolbar, toggle Snap, assert `useEditor.getState().snapEnabled` flips. Run it.

- [ ] **Step 3: e2e** — `e2e/snapping.spec.ts`: draw two rects (or import), drag one near the other's edge, assert a `snap-guide-x` (or `-y`) line becomes visible during/after the drag and the dragged object's `transform` reflects the aligned position. Model setup on an existing Stage drag e2e.

- [ ] **Step 4: Run e2e**

Run: `pnpm exec playwright test e2e/snapping.spec.ts`
Expected: PASS.

- [ ] **Step 5: Full gate + commit**

```bash
pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test
git add -A
git commit -m "feat(slice33): Snap toggle in the toolbar + snapping e2e"
```

---

## Self-Review (post-write)

- **Spec coverage:** §3 snap model → Task 1; §5 store/Stage/guides → Task 2; toggle + e2e → Task 3.
- **Type consistency:** `AABB`/`XformParams`/`SnapResult`/`SNAP_PX`/`transformedAABB`/`computeSnap` consistent; `snapEnabled`/`toggleSnap`/`setSnapEnabled` consistent.
- **No placeholders:** Task 1 has full code + hand-verified vectors (90° rot → 50×100 AABB at (25,−25)..(75,75); left-edge 3px → dx 3, guideX 103; nearest 1px; both-axes 4). Task 2/3 Stage/e2e coords are pinned to the existing identity-CTM / drag harness by the executor; assertions specified.
- **Feedback guard:** snap recomputed from RAW pointer each move (no accumulation).
- **Risk:** guide overlay must live in the pan/zoom group to share coords; the executor places it next to existing overlays.
