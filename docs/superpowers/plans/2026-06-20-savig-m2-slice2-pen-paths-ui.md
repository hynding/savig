# M2 Slice 2 — Pen/Bezier Paths: UI (Plan B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the pen tool (bezier authoring) and a dedicated node tool (full editing toolkit) to the editor, with cap/join style controls, wired so a drawn path previews == exports.

**Architecture:** All path-editing logic lives in **pure, DOM-free modules** — `pathEdit.ts` (insert/delete/convert/break/join/move node ops) and `pathHitTest.ts` (anchor/handle/segment/near-first-anchor) — unit-tested like Slice 1's `applyHandleResize`. Store actions mutate the path on the `VectorAsset` (atomic, undoable), mirroring `setVectorStyle`. The Stage gains a `<path>` render case and delegates pen authoring + node editing to focused hooks so it stays a thin coordinator.

**Tech Stack:** React 18 + TS (strict), Zustand, Vitest + React Testing Library, Playwright. CSS Modules + design tokens.

## Global Constraints

- **Depends on Plan A** (engine `path` type, `pathToD`, `pathBounds`, `renderShapeToSvg` path branch, `resolveAnchor(obj,state,shapeType,pathBox?)`, v3 migration). Plan A must be merged first.
- Active tool is ephemeral UI state — never in `Project`, never persisted/undone.
- Editing helpers (`pathEdit.ts`, `pathHitTest.ts`) MUST be pure (no React/DOM) and unit-tested without a DOM.
- A whole pointer-drag is **one** undo step (imperative preview during drag; single commit on pointer-up), reusing Slice 1's coalescing pattern.
- All pointer math goes through the existing `clientToLocal` (screen → stage-local, zoom/pan-aware) and, for selected objects, the rotation-aware inverse transform.
- Path default style: `fill:'none', stroke:'#000000', strokeWidth:2` (an unstroked open path is invisible).
- Run: `pnpm test` (Vitest), `pnpm typecheck`, `pnpm lint`, `pnpm build`; e2e `pnpm test:e2e` (or the project's Playwright command).
- jsdom lacks `PointerEvent` (polyfilled in `src/test-setup.ts`) — reuse the existing pointer test helpers.

---

### Task 1: Extend tool modes + palette + shortcuts

**Files:**
- Modify: `src/ui/store/store.ts:31` (`ToolMode`)
- Modify: `src/ui/components/Toolbar/ToolPalette.tsx:5-9` (TOOLS list)
- Modify: `src/ui/hooks/useKeyboard.ts:36-39` (P/N shortcuts)
- Modify: `src/ui/components/Toolbar/ToolPalette.test.tsx`
- Modify: `src/ui/hooks/useKeyboard.test.ts`

**Interfaces:**
- Produces: `type ToolMode = 'select' | 'pen' | 'node' | 'rect' | 'ellipse'`; palette renders Pen + Node buttons; `P`→pen, `N`→node.

- [ ] **Step 1: Write the failing tests**

In `src/ui/components/Toolbar/ToolPalette.test.tsx`, add:

```ts
it('renders pen and node tools and activates them on click', () => {
  render(<ToolPalette />);
  fireEvent.click(screen.getByRole('button', { name: 'Pen' }));
  expect(useEditor.getState().activeTool).toBe('pen');
  fireEvent.click(screen.getByRole('button', { name: 'Node' }));
  expect(useEditor.getState().activeTool).toBe('node');
});
```

In `src/ui/hooks/useKeyboard.test.ts`, add (following the file's existing key-dispatch helper):

```ts
it('P selects pen and N selects node', () => {
  renderHookWithKeyboard();
  fireEvent.keyDown(window, { key: 'p' });
  expect(useEditor.getState().activeTool).toBe('pen');
  fireEvent.keyDown(window, { key: 'n' });
  expect(useEditor.getState().activeTool).toBe('node');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- src/ui/components/Toolbar/ToolPalette.test.tsx src/ui/hooks/useKeyboard.test.ts`
Expected: FAIL — no Pen/Node buttons; P/N not handled.

- [ ] **Step 3: Implement**

In `src/ui/store/store.ts`:

```ts
export type ToolMode = 'select' | 'pen' | 'node' | 'rect' | 'ellipse';
```

In `src/ui/components/Toolbar/ToolPalette.tsx`, extend TOOLS:

```ts
const TOOLS: { id: ToolMode; label: string }[] = [
  { id: 'select', label: 'Select' },
  { id: 'pen', label: 'Pen' },
  { id: 'node', label: 'Node' },
  { id: 'rect', label: 'Rectangle' },
  { id: 'ellipse', label: 'Ellipse' },
];
```

In `src/ui/hooks/useKeyboard.ts`, add cases after the `e/E` case:

```ts
        case 'p': case 'P': s.setActiveTool('pen'); break;
        case 'n': case 'N': s.setActiveTool('node'); break;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- src/ui/components/Toolbar/ToolPalette.test.tsx src/ui/hooks/useKeyboard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/store/store.ts src/ui/components/Toolbar/ToolPalette.tsx src/ui/hooks/useKeyboard.ts src/ui/components/Toolbar/ToolPalette.test.tsx src/ui/hooks/useKeyboard.test.ts
git commit -m "feat(ui): add pen + node tool modes, palette buttons, and P/N shortcuts"
```

---

### Task 2: Pure node-edit helpers — insert / delete

**Files:**
- Create: `src/ui/components/Stage/pathEdit.ts`
- Create: `src/ui/components/Stage/pathEdit.test.ts`

**Interfaces:**
- Consumes: `PathData`, `PathNode`, `PathPoint` from `../../../engine`.
- Produces:
  - `insertNodeAt(path: PathData, segmentIndex: number, t: number): PathData` — inserts a corner node at parameter `t` (0..1) along segment `segmentIndex` (from node `segmentIndex` to `segmentIndex+1`, wrapping for the closing segment). Linear split this slice (handles of neighbors unchanged).
  - `deleteNodeAt(path: PathData, index: number): PathData` — removes node `index`; if fewer than 2 nodes remain, returns the path unchanged (callers guard deletion of the whole shape).

- [ ] **Step 1: Write the failing test**

Create `src/ui/components/Stage/pathEdit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { insertNodeAt, deleteNodeAt } from './pathEdit';
import type { PathData } from '../../../engine';

const line: PathData = {
  nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }],
  closed: false,
};

describe('insertNodeAt', () => {
  it('inserts a node at the midpoint of a segment', () => {
    const out = insertNodeAt(line, 0, 0.5);
    expect(out.nodes).toHaveLength(3);
    expect(out.nodes[1].anchor).toEqual({ x: 5, y: 0 });
  });
});

describe('deleteNodeAt', () => {
  it('removes a node', () => {
    const three: PathData = { nodes: [...line.nodes, { anchor: { x: 10, y: 10 } }], closed: false };
    const out = deleteNodeAt(three, 1);
    expect(out.nodes.map((n) => n.anchor)).toEqual([{ x: 0, y: 0 }, { x: 10, y: 10 }]);
  });

  it('refuses to drop below 2 nodes', () => {
    expect(deleteNodeAt(line, 0)).toEqual(line);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/ui/components/Stage/pathEdit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/ui/components/Stage/pathEdit.ts`:

```ts
import type { PathData, PathNode, PathPoint } from '../../../engine';

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Inserts a corner node at parameter t along segment `segmentIndex`
// (node segmentIndex -> segmentIndex+1, wrapping to node 0 for the closing segment).
export function insertNodeAt(path: PathData, segmentIndex: number, t: number): PathData {
  const n = path.nodes.length;
  const a = path.nodes[segmentIndex];
  const b = path.nodes[(segmentIndex + 1) % n];
  if (!a || !b) return path;
  const anchor: PathPoint = {
    x: lerp(a.anchor.x, b.anchor.x, t),
    y: lerp(a.anchor.y, b.anchor.y, t),
  };
  const node: PathNode = { anchor };
  const nodes = [...path.nodes];
  nodes.splice(segmentIndex + 1, 0, node);
  return { ...path, nodes };
}

// Removes node `index`; keeps at least 2 nodes (a path needs >= 2 to render).
export function deleteNodeAt(path: PathData, index: number): PathData {
  if (path.nodes.length <= 2) return path;
  return { ...path, nodes: path.nodes.filter((_, i) => i !== index) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/ui/components/Stage/pathEdit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/Stage/pathEdit.ts src/ui/components/Stage/pathEdit.test.ts
git commit -m "feat(ui): pure insertNodeAt/deleteNodeAt path helpers"
```

---

### Task 3: Pure node-edit helpers — move anchor / move handle (with mirroring) / convert / break / join

**Files:**
- Modify: `src/ui/components/Stage/pathEdit.ts`
- Modify: `src/ui/components/Stage/pathEdit.test.ts`

**Interfaces:**
- Produces:
  - `moveAnchor(path, index, anchor: PathPoint): PathData` — sets a node's anchor (handles are offsets, so they follow automatically).
  - `moveHandle(path, index, side: 'in' | 'out', offset: PathPoint, mirror: boolean): PathData` — sets one handle offset; when `mirror` is true and the opposite handle exists, sets it to the negation (smooth behavior).
  - `toggleSmooth(path, index): PathData` — corner (no handles) → smooth (adds mirrored handles derived from neighbor direction); smooth/any-with-handles → corner (drops both handles).
  - `breakHandle(path, index): PathData` — no-op marker for "handles independent" (handles already independent in the data; this is the inverse of join — see impl note). Implemented as a no-op that returns the path unchanged structurally but is the hook point the UI uses to stop mirroring on subsequent drags. (Mirroring is a *drag-time* choice via `moveHandle(..., mirror)`, so break/join only flip the UI's mirror flag for that node — see Task 7.)
  - `joinHandle(path, index): PathData` — makes the node's handles mirrored: if both exist, set `in = -out`; if only one exists, mirror it to the other side.

> **Implementation note (break vs join):** because in/out are independent offsets in
> the data model, "broken" is simply the absence of the mirror constraint. We model
> smoothness as data (mirrored offsets) and let the UI decide at drag time whether to
> mirror (`moveHandle(mirror=true)`). `joinHandle` enforces mirrored offsets now;
> `breakHandle` is the UI flag that future drags use independent handles. `breakHandle`
> therefore returns the path unchanged and exists for symmetry/clarity; the behavioral
> switch is the `mirror` arg threaded from Task 7.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/components/Stage/pathEdit.test.ts`:

```ts
import { moveAnchor, moveHandle, toggleSmooth, joinHandle } from './pathEdit';

const smooth: PathData = {
  nodes: [{ anchor: { x: 10, y: 10 }, in: { x: -5, y: 0 }, out: { x: 5, y: 0 } }],
  closed: false,
};

describe('moveAnchor', () => {
  it('sets the anchor (handles are relative offsets, so they ride along)', () => {
    const out = moveAnchor(smooth, 0, { x: 20, y: 20 });
    expect(out.nodes[0].anchor).toEqual({ x: 20, y: 20 });
    expect(out.nodes[0].out).toEqual({ x: 5, y: 0 });
  });
});

describe('moveHandle', () => {
  it('mirrors the opposite handle when mirror=true', () => {
    const out = moveHandle(smooth, 0, 'out', { x: 0, y: 8 }, true);
    expect(out.nodes[0].out).toEqual({ x: 0, y: 8 });
    expect(out.nodes[0].in).toEqual({ x: 0, y: -8 });
  });
  it('leaves the opposite handle alone when mirror=false', () => {
    const out = moveHandle(smooth, 0, 'out', { x: 0, y: 8 }, false);
    expect(out.nodes[0].out).toEqual({ x: 0, y: 8 });
    expect(out.nodes[0].in).toEqual({ x: -5, y: 0 });
  });
});

describe('toggleSmooth', () => {
  it('drops handles when smoothing a node that already has handles (-> corner)', () => {
    const out = toggleSmooth(smooth, 0);
    expect(out.nodes[0].in).toBeUndefined();
    expect(out.nodes[0].out).toBeUndefined();
  });
  it('adds mirrored handles to a corner node (-> smooth)', () => {
    const corner: PathData = {
      nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 20, y: 0 } }],
      closed: false,
    };
    const out = toggleSmooth(corner, 1);
    expect(out.nodes[1].in).toBeDefined();
    expect(out.nodes[1].out).toBeDefined();
    // mirrored: in == -out
    expect(out.nodes[1].in).toEqual({ x: -out.nodes[1].out!.x, y: -out.nodes[1].out!.y });
  });
});

describe('joinHandle', () => {
  it('enforces mirrored handles', () => {
    const broken: PathData = {
      nodes: [{ anchor: { x: 0, y: 0 }, in: { x: -5, y: 0 }, out: { x: 2, y: 9 } }],
      closed: false,
    };
    const out = joinHandle(broken, 0);
    expect(out.nodes[0].in).toEqual({ x: -out.nodes[0].out!.x, y: -out.nodes[0].out!.y });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/ui/components/Stage/pathEdit.test.ts`
Expected: FAIL — new helpers not exported.

- [ ] **Step 3: Implement**

Append to `src/ui/components/Stage/pathEdit.ts`:

```ts
function neg(p: PathPoint): PathPoint {
  return { x: -p.x, y: -p.y };
}

function setNode(path: PathData, index: number, next: PathNode): PathData {
  return { ...path, nodes: path.nodes.map((n, i) => (i === index ? next : n)) };
}

export function moveAnchor(path: PathData, index: number, anchor: PathPoint): PathData {
  const node = path.nodes[index];
  if (!node) return path;
  return setNode(path, index, { ...node, anchor });
}

export function moveHandle(
  path: PathData,
  index: number,
  side: 'in' | 'out',
  offset: PathPoint,
  mirror: boolean,
): PathData {
  const node = path.nodes[index];
  if (!node) return path;
  const next: PathNode = { ...node, [side]: offset };
  if (mirror) {
    const other = side === 'in' ? 'out' : 'in';
    if (node[other]) next[other] = neg(offset);
  }
  return setNode(path, index, next);
}

// Corner (no handles) -> smooth (mirrored handles along the neighbor chord);
// any node with handles -> corner (handles dropped).
export function toggleSmooth(path: PathData, index: number): PathData {
  const node = path.nodes[index];
  if (!node) return path;
  if (node.in || node.out) {
    return setNode(path, index, { anchor: node.anchor });
  }
  const n = path.nodes.length;
  const prev = path.nodes[(index - 1 + n) % n];
  const nxt = path.nodes[(index + 1) % n];
  // Tangent ~ direction from prev to next; handle length = 1/4 of that chord.
  const dx = (nxt.anchor.x - prev.anchor.x) / 4;
  const dy = (nxt.anchor.y - prev.anchor.y) / 4;
  return setNode(path, index, { anchor: node.anchor, in: { x: -dx, y: -dy }, out: { x: dx, y: dy } });
}

// Enforces mirrored handles (in == -out). If only one exists, mirror it across.
export function joinHandle(path: PathData, index: number): PathData {
  const node = path.nodes[index];
  if (!node) return path;
  if (node.out) return setNode(path, index, { ...node, in: neg(node.out) });
  if (node.in) return setNode(path, index, { ...node, out: neg(node.in) });
  return path;
}

// Symmetry/clarity counterpart to joinHandle; the behavioral switch (independent
// vs mirrored on subsequent drags) is the UI's per-node mirror flag (Task 7).
export function breakHandle(path: PathData, _index: number): PathData {
  return path;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/ui/components/Stage/pathEdit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/Stage/pathEdit.ts src/ui/components/Stage/pathEdit.test.ts
git commit -m "feat(ui): pure move/convert/break/join path node helpers"
```

---

### Task 4: Pure hit-testing helpers

**Files:**
- Create: `src/ui/components/Stage/pathHitTest.ts`
- Create: `src/ui/components/Stage/pathHitTest.test.ts`

**Interfaces:**
- Consumes: `PathData`, `PathPoint` from `../../../engine`.
- Produces (all coordinates are object-LOCAL; `tol` is a local-space tolerance):
  - `hitTestAnchor(path, local: PathPoint, tol: number): number | null` — index of the anchor under the point, else null.
  - `hitTestHandle(path, local: PathPoint, tol: number): { index: number; side: 'in' | 'out' } | null` — absolute handle position = anchor + offset.
  - `hitTestSegment(path, local: PathPoint, tol: number): { segmentIndex: number; t: number } | null` — nearest point on a segment's chord (linear approximation) within tol.
  - `nearFirstAnchor(path, local: PathPoint, tol: number): boolean` — whether the point is within tol of node 0 (close affordance).

- [ ] **Step 1: Write the failing test**

Create `src/ui/components/Stage/pathHitTest.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { hitTestAnchor, hitTestHandle, hitTestSegment, nearFirstAnchor } from './pathHitTest';
import type { PathData } from '../../../engine';

const p: PathData = {
  nodes: [
    { anchor: { x: 0, y: 0 }, out: { x: 4, y: 0 } },
    { anchor: { x: 10, y: 0 }, in: { x: -4, y: 0 } },
  ],
  closed: false,
};

it('hits an anchor within tolerance', () => {
  expect(hitTestAnchor(p, { x: 0.5, y: 0.5 }, 2)).toBe(0);
  expect(hitTestAnchor(p, { x: 5, y: 5 }, 2)).toBeNull();
});

it('hits a handle (anchor + offset) within tolerance', () => {
  expect(hitTestHandle(p, { x: 4, y: 0 }, 2)).toEqual({ index: 0, side: 'out' });
  expect(hitTestHandle(p, { x: 6, y: 0 }, 2)).toEqual({ index: 1, side: 'in' });
});

it('hits a segment near its chord and reports t', () => {
  const hit = hitTestSegment(p, { x: 5, y: 0.2 }, 1)!;
  expect(hit.segmentIndex).toBe(0);
  expect(hit.t).toBeCloseTo(0.5, 2);
});

it('detects nearness to the first anchor', () => {
  expect(nearFirstAnchor(p, { x: 0.5, y: 0 }, 2)).toBe(true);
  expect(nearFirstAnchor(p, { x: 9, y: 0 }, 2)).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/ui/components/Stage/pathHitTest.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/ui/components/Stage/pathHitTest.ts`:

```ts
import type { PathData, PathPoint } from '../../../engine';

function dist2(a: PathPoint, b: PathPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function hitTestAnchor(path: PathData, local: PathPoint, tol: number): number | null {
  const t2 = tol * tol;
  for (let i = 0; i < path.nodes.length; i++) {
    if (dist2(path.nodes[i].anchor, local) <= t2) return i;
  }
  return null;
}

export function hitTestHandle(
  path: PathData,
  local: PathPoint,
  tol: number,
): { index: number; side: 'in' | 'out' } | null {
  const t2 = tol * tol;
  for (let i = 0; i < path.nodes.length; i++) {
    const n = path.nodes[i];
    if (n.in && dist2({ x: n.anchor.x + n.in.x, y: n.anchor.y + n.in.y }, local) <= t2) {
      return { index: i, side: 'in' };
    }
    if (n.out && dist2({ x: n.anchor.x + n.out.x, y: n.anchor.y + n.out.y }, local) <= t2) {
      return { index: i, side: 'out' };
    }
  }
  return null;
}

// Nearest point on each segment's straight chord (linear approximation, adequate
// for click-to-insert this slice). Returns the closest segment within tol and the
// clamped parameter t in [0,1].
export function hitTestSegment(
  path: PathData,
  local: PathPoint,
  tol: number,
): { segmentIndex: number; t: number } | null {
  const n = path.nodes.length;
  const last = path.closed ? n : n - 1;
  let best: { segmentIndex: number; t: number; d2: number } | null = null;
  for (let i = 0; i < last; i++) {
    const a = path.nodes[i].anchor;
    const b = path.nodes[(i + 1) % n].anchor;
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const len2 = vx * vx + vy * vy || 1;
    let t = ((local.x - a.x) * vx + (local.y - a.y) * vy) / len2;
    t = Math.max(0, Math.min(1, t));
    const proj = { x: a.x + vx * t, y: a.y + vy * t };
    const d2 = dist2(proj, local);
    if (!best || d2 < best.d2) best = { segmentIndex: i, t, d2 };
  }
  if (best && best.d2 <= tol * tol) return { segmentIndex: best.segmentIndex, t: best.t };
  return null;
}

export function nearFirstAnchor(path: PathData, local: PathPoint, tol: number): boolean {
  return path.nodes.length > 0 && dist2(path.nodes[0].anchor, local) <= tol * tol;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/ui/components/Stage/pathHitTest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/Stage/pathHitTest.ts src/ui/components/Stage/pathHitTest.test.ts
git commit -m "feat(ui): pure path hit-testing helpers (anchor/handle/segment/close)"
```

---

### Task 5: Store — `addVectorPath`, `setPathData`, node-edit actions, `selectedNodeIndex`

**Files:**
- Modify: `src/ui/store/store.ts`
- Modify: `src/ui/store/store.test.ts`

**Interfaces:**
- Consumes: `createVectorAsset`, `createSceneObject`, `DEFAULT_TRANSFORM` from engine; `pathBounds` from engine; `deleteNodeAt`, `toggleSmooth`, `joinHandle`, `breakHandle` from `../components/Stage/pathEdit`.
- Produces (additions to `EditorState`):
  - `selectedNodeIndex: number | null` (transient default `null`).
  - `selectNode(index: number | null): void`
  - `addVectorPath(path: PathData): void` — creates a path `VectorAsset` (path default style; `path` normalized so the bbox top-left is at local origin) + object (`anchorMode:'fraction'`, anchor 0.5/0.5, `base.x/base.y` = bbox top-left), selects it, switches to the **node** tool. One undo step. No-op if `path.nodes.length < 2`.
  - `setPathData(path: PathData): void` — replaces the selected path asset's `path` (one commit).
  - `deleteSelectedNode(): void`, `toggleSelectedNodeSmooth(): void`, `joinSelectedNode(): void`, `breakSelectedNode(): void` — apply the pure helper to the selected path's selected node, commit, keep selection.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/store/store.test.ts`:

```ts
import type { PathData } from '../../engine';

function rawPath(): PathData {
  return { nodes: [{ anchor: { x: 100, y: 50 } }, { anchor: { x: 140, y: 90 } }], closed: false };
}

describe('addVectorPath', () => {
  it('creates a path asset + object in one undo step, normalized to local origin, node tool active', () => {
    const s = useEditor.getState();
    s.newProject();
    const before = useEditor.getState().history.present.objects.length;
    useEditor.getState().addVectorPath(rawPath());

    const st = useEditor.getState();
    const proj = st.history.present;
    expect(proj.objects).toHaveLength(before + 1);
    const obj = proj.objects[proj.objects.length - 1];
    const asset = proj.assets.find((a) => a.id === obj.assetId)!;
    expect(asset.kind).toBe('vector');
    expect(asset.shapeType).toBe('path');
    // path default style is a visible stroke, no fill
    expect(asset.style).toMatchObject({ fill: 'none', stroke: '#000000', strokeWidth: 2 });
    // normalized: bbox min at origin; base carries the offset
    expect(obj.base.x).toBe(100);
    expect(obj.base.y).toBe(50);
    expect(asset.path!.nodes[0].anchor).toEqual({ x: 0, y: 0 });
    expect(obj.anchorMode).toBe('fraction');
    expect(st.activeTool).toBe('node');
    expect(st.selectedObjectId).toBe(obj.id);

    // one undo step removes the whole shape
    useEditor.getState().undo();
    expect(useEditor.getState().history.present.objects).toHaveLength(before);
  });

  it('ignores a draft with fewer than 2 nodes', () => {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorPath({ nodes: [{ anchor: { x: 0, y: 0 } }], closed: false });
    expect(useEditor.getState().history.present.objects).toHaveLength(0);
  });
});

describe('node edit actions', () => {
  it('deleteSelectedNode removes the selected node of the selected path', () => {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorPath({
      nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 20, y: 0 } }],
      closed: false,
    });
    useEditor.getState().selectNode(1);
    useEditor.getState().deleteSelectedNode();
    const obj = useEditor.getState().history.present.objects.at(-1)!;
    const asset = useEditor.getState().history.present.assets.find((a) => a.id === obj.assetId)!;
    expect(asset.path!.nodes).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/ui/store/store.test.ts`
Expected: FAIL — actions/state not defined.

- [ ] **Step 3: Implement**

In `src/ui/store/store.ts`:

Add imports:

```ts
import { pathBounds } from '../../engine';
import type { PathData } from '../../engine';
import { deleteNodeAt, toggleSmooth, joinHandle } from '../components/Stage/pathEdit';
```

Add to `EditorState` (near `addVectorShape`):

```ts
  selectedNodeIndex: number | null;
  selectNode(index: number | null): void;
  addVectorPath(path: PathData): void;
  setPathData(path: PathData): void;
  deleteSelectedNode(): void;
  toggleSelectedNodeSmooth(): void;
  joinSelectedNode(): void;
```

Add to `TRANSIENT_DEFAULTS`:

```ts
  selectedNodeIndex: null as number | null,
```

Add a path default-style constant near the top of the module:

```ts
const PATH_DEFAULT_STYLE = { fill: 'none', stroke: '#000000', strokeWidth: 2 };
```

Implement the actions (place after `addVectorShape`):

```ts
  selectNode(index) {
    set({ selectedNodeIndex: index });
  },
  addVectorPath(path) {
    if (path.nodes.length < 2) return;
    const project = get().history.present;
    const box = pathBounds(path);
    // Normalize so the bbox top-left sits at local origin; the object transform places it.
    const normalized: PathData = {
      closed: path.closed,
      nodes: path.nodes.map((n) => ({
        anchor: { x: n.anchor.x - box.x, y: n.anchor.y - box.y },
        ...(n.in ? { in: n.in } : {}),
        ...(n.out ? { out: n.out } : {}),
      })),
    };
    const asset = createVectorAsset('path', { path: normalized, style: { ...PATH_DEFAULT_STYLE } });
    const obj = createSceneObject(asset.id, {
      name: `${asset.name} ${project.objects.length + 1}`,
      zOrder: project.objects.length,
      anchorMode: 'fraction',
      anchorX: 0.5,
      anchorY: 0.5,
      base: { ...DEFAULT_TRANSFORM, x: box.x, y: box.y },
    });
    get().commit({
      ...project,
      assets: [...project.assets, asset],
      objects: [...project.objects, obj],
    });
    set({ selectedObjectId: obj.id, selectedKeyframe: null, selectedNodeIndex: null, activeTool: 'node' });
  },
  setPathData(path) {
    const s = get();
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === s.selectedObjectId);
    if (!obj) return;
    const asset = project.assets.find((a) => a.id === obj.assetId);
    if (!asset || asset.kind !== 'vector' || asset.shapeType !== 'path') return;
    const next = { ...asset, path };
    get().commit({ ...project, assets: project.assets.map((a) => (a.id === asset.id ? next : a)) });
  },
  deleteSelectedNode() {
    const s = get();
    if (s.selectedNodeIndex == null) return;
    const asset = currentPathAsset(get);
    if (!asset?.path) return;
    s.setPathData(deleteNodeAt(asset.path, s.selectedNodeIndex));
    set({ selectedNodeIndex: null });
  },
  toggleSelectedNodeSmooth() {
    const s = get();
    if (s.selectedNodeIndex == null) return;
    const asset = currentPathAsset(get);
    if (!asset?.path) return;
    s.setPathData(toggleSmooth(asset.path, s.selectedNodeIndex));
  },
  joinSelectedNode() {
    const s = get();
    if (s.selectedNodeIndex == null) return;
    const asset = currentPathAsset(get);
    if (!asset?.path) return;
    s.setPathData(joinHandle(asset.path, s.selectedNodeIndex));
  },
```

Add a small module-scope helper (near `replaceObject`):

```ts
function currentPathAsset(get: () => EditorState) {
  const s = get();
  const obj = s.history.present.objects.find((o) => o.id === s.selectedObjectId);
  const asset = obj && s.history.present.assets.find((a) => a.id === obj.assetId);
  return asset && asset.kind === 'vector' && asset.shapeType === 'path' ? asset : null;
}
```

Also reset `selectedNodeIndex` in `selectObject`:

```ts
  selectObject(id) {
    set({ selectedObjectId: id, selectedKeyframe: null, selectedNodeIndex: null });
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/ui/store/store.test.ts && pnpm typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(store): addVectorPath + setPathData + node-edit actions + selectedNodeIndex"
```

---

### Task 6: Stage — render path objects + exclude paths from resize overlay

**Files:**
- Modify: `src/ui/components/Stage/Stage.tsx:50-61` (`selectedVector` memo — exclude paths) and `:314-355` (render branch — add path case)
- Modify: `src/ui/components/Stage/Stage.test.tsx`

**Interfaces:**
- Consumes: `pathToD` from engine.
- Produces: a path object renders as `<g …><path d={pathToD(asset.path)} …/></g>`; the resize-handle overlay does NOT appear for path objects.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/components/Stage/Stage.test.tsx` (follow the file's existing project/render setup helpers):

```ts
import { pathToD } from '../../../engine';

it('renders a path object as a <path> with d from pathToD and no resize handles', () => {
  const path = { nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 10 } }], closed: false };
  const asset = createVectorAsset('path', { path, style: { fill: 'none', stroke: '#000000', strokeWidth: 2 } });
  const obj = createSceneObject(asset.id, { anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5 });
  setProjectWithObjects([asset], [obj]); // existing test helper that seeds the store
  useEditor.getState().selectObject(obj.id);

  renderStage();
  const pathEl = document.querySelector(`[data-testid="object-${obj.id}"] path`)!;
  expect(pathEl.getAttribute('d')).toBe(pathToD(path));
  // select tool: paths are move-only, no resize handle overlay
  expect(screen.queryByTestId('resize-handles')).toBeNull();
});
```

(Adapt `setProjectWithObjects`/`renderStage` to the helpers already used in `Stage.test.tsx`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/ui/components/Stage/Stage.test.tsx`
Expected: FAIL — path renders via the ellipse fallback; resize handles render for the path.

- [ ] **Step 3: Implement**

In `src/ui/components/Stage/Stage.tsx`, update imports:

```ts
import { buildTransform, geometryToSvgAttrs, pathToD, resolveAnchor, sampleObject } from '../../../engine';
```

In the `selectedVector` memo, exclude paths (so the resize overlay is rect/ellipse only):

```ts
    if (!obj || !asset || asset.kind !== 'vector' || asset.shapeType === 'path') return null;
```

In the render `.map`, replace the `asset?.kind === 'vector'` block to branch on path:

```ts
            if (asset?.kind === 'vector') {
              if (asset.shapeType === 'path') {
                return (
                  <g
                    key={o.id}
                    ref={register(o.id)}
                    data-testid={`object-${o.id}`}
                    data-savig-object={o.id}
                    data-selected={o.id === selectedId}
                    className={styles.object}
                    onPointerDown={(e) => onObjectPointerDown(o.id, e)}
                  >
                    <path
                      d={asset.path ? pathToD(asset.path) : ''}
                      fill={asset.style.fill}
                      stroke={asset.style.stroke}
                      strokeWidth={asset.style.strokeWidth}
                      strokeLinecap={asset.style.strokeLinecap}
                      strokeLinejoin={asset.style.strokeLinejoin}
                    />
                  </g>
                );
              }
              const geometry = sampleObject(o, time).geometry ?? {};
              const geomAttrs = geometryToSvgAttrs(asset.shapeType, geometry);
              const ShapeTag = asset.shapeType === 'rect' ? 'rect' : 'ellipse';
              return (
                <g
                  key={o.id}
                  ref={register(o.id)}
                  data-testid={`object-${o.id}`}
                  data-savig-object={o.id}
                  data-selected={o.id === selectedId}
                  className={styles.object}
                  onPointerDown={(e) => onObjectPointerDown(o.id, e)}
                >
                  <ShapeTag
                    {...geomAttrs}
                    fill={asset.style.fill}
                    stroke={asset.style.stroke}
                    strokeWidth={asset.style.strokeWidth}
                    strokeLinecap={asset.style.strokeLinecap}
                    strokeLinejoin={asset.style.strokeLinejoin}
                  />
                </g>
              );
            }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/ui/components/Stage/Stage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/Stage/Stage.tsx src/ui/components/Stage/Stage.test.tsx
git commit -m "feat(stage): render path objects; exclude paths from resize overlay"
```

---

### Task 7: Pen authoring + node editing hook (`usePathTools`)

**Files:**
- Create: `src/ui/components/Stage/usePathTools.ts`
- Create: `src/ui/components/Stage/usePathTools.test.tsx`
- Modify: `src/ui/components/Stage/Stage.tsx` (wire pen/node pointer events + render draft preview & node overlay)

**Interfaces:**
- Consumes: store (`activeTool`, `addVectorPath`, `setPathData`, `selectNode`, `selectedNodeIndex`), `clientToLocal`, pure helpers from `pathEdit`/`pathHitTest`, `pathToD`.
- Produces: a hook returning handlers + render data the Stage uses:
  - `onPenPointerDown(localPoint, withDrag)`, `onPenPointerMove(localPoint)`, `finishPen(close: boolean)`, `cancelPen()`
  - `draft: { nodes: PathNode[]; cursor: PathPoint | null } | null` (for the rubber-band preview)
  - node-tool: `onNodePointerDown(localPoint, e)`, plus overlay render data `nodeOverlay: { anchors; handles } | null`.

> **Scope note:** This is the one large interactive task. Keep the hook focused on
> state + delegating to the pure helpers; the Stage only wires DOM events and renders.
> The pen draft lives in the hook's local state (ephemeral, not in the store), mirroring
> Slice 1's drag-preview. Drag of a node/handle uses imperative preview + a single
> `setPathData` commit on pointer-up (Slice-1 coalescing). The per-node `mirror` flag
> defaults true (smooth) and flips to false after `breakSelectedNode`/Alt-drag.

Because the full hook is sizeable, implement it in these sub-steps, each with a test.

- [ ] **Step 1: Test — pen click sequence + finish commits one path**

Create `src/ui/components/Stage/usePathTools.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useEditor } from '../../store/store';
import { usePathTools } from './usePathTools';

beforeEach(() => useEditor.getState().newProject());

it('builds a draft across clicks and commits an open path on finish', () => {
  useEditor.getState().setActiveTool('pen');
  const { result } = renderHook(() => usePathTools());

  act(() => result.current.onPenPointerDown({ x: 0, y: 0 }, false));
  act(() => result.current.onPenPointerDown({ x: 10, y: 0 }, false));
  expect(result.current.draft?.nodes).toHaveLength(2);

  act(() => result.current.finishPen(false));
  const proj = useEditor.getState().history.present;
  expect(proj.objects).toHaveLength(1);
  const asset = proj.assets.find((a) => a.shapeType === 'path')!;
  expect(asset.path!.closed).toBe(false);
  expect(asset.path!.nodes).toHaveLength(2);
  // draft cleared, switched to node tool (addVectorPath behavior)
  expect(result.current.draft).toBeNull();
  expect(useEditor.getState().activeTool).toBe('node');
});

it('closes the path when finishPen(true)', () => {
  useEditor.getState().setActiveTool('pen');
  const { result } = renderHook(() => usePathTools());
  act(() => result.current.onPenPointerDown({ x: 0, y: 0 }, false));
  act(() => result.current.onPenPointerDown({ x: 10, y: 0 }, false));
  act(() => result.current.onPenPointerDown({ x: 10, y: 10 }, false));
  act(() => result.current.finishPen(true));
  const asset = useEditor.getState().history.present.assets.find((a) => a.shapeType === 'path')!;
  expect(asset.path!.closed).toBe(true);
});

it('cancelPen discards the draft without creating anything', () => {
  useEditor.getState().setActiveTool('pen');
  const { result } = renderHook(() => usePathTools());
  act(() => result.current.onPenPointerDown({ x: 0, y: 0 }, false));
  act(() => result.current.cancelPen());
  expect(result.current.draft).toBeNull();
  expect(useEditor.getState().history.present.objects).toHaveLength(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/ui/components/Stage/usePathTools.test.tsx`
Expected: FAIL — hook not found.

- [ ] **Step 3: Implement the pen portion of the hook**

Create `src/ui/components/Stage/usePathTools.ts`:

```ts
import { useState, useCallback } from 'react';
import type { PathNode, PathPoint } from '../../../engine';
import { useEditor } from '../../store/store';

interface Draft {
  nodes: PathNode[];
  cursor: PathPoint | null;
}

export function usePathTools() {
  const [draft, setDraft] = useState<Draft | null>(null);

  const onPenPointerDown = useCallback((local: PathPoint, _withDrag: boolean) => {
    setDraft((d) => {
      const nodes = d ? [...d.nodes, { anchor: local }] : [{ anchor: local }];
      return { nodes, cursor: local };
    });
  }, []);

  const onPenPointerMove = useCallback((local: PathPoint) => {
    setDraft((d) => (d ? { ...d, cursor: local } : d));
  }, []);

  const finishPen = useCallback((close: boolean) => {
    setDraft((d) => {
      if (d && d.nodes.length >= 2) {
        useEditor.getState().addVectorPath({ nodes: d.nodes, closed: close });
      }
      return null;
    });
  }, []);

  const cancelPen = useCallback(() => setDraft(null), []);

  return { draft, onPenPointerDown, onPenPointerMove, finishPen, cancelPen };
}
```

> Smooth-node authoring (click-drag to add mirrored handles) is layered next; the
> `_withDrag` arg and a pointer-move-during-down handler set `in/out` on the just-added
> node. Implement after the click-only path is green (Step 5 sub-iteration below).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/ui/components/Stage/usePathTools.test.tsx`
Expected: PASS.

- [ ] **Step 5: Test + implement smooth-drag authoring**

Add a test:

```tsx
it('click-drag adds mirrored handles to the placed node', () => {
  useEditor.getState().setActiveTool('pen');
  const { result } = renderHook(() => usePathTools());
  act(() => result.current.onPenPointerDown({ x: 0, y: 0 }, true));
  act(() => result.current.onPenDrag({ x: 3, y: 0 })); // drag while down
  act(() => result.current.onPenPointerUp());
  expect(result.current.draft?.nodes[0].out).toEqual({ x: 3, y: 0 });
  expect(result.current.draft?.nodes[0].in).toEqual({ x: -3, y: 0 });
});
```

Run it (fails — `onPenDrag`/`onPenPointerUp` missing), then add to the hook:

```ts
  const [dragging, setDragging] = useState(false);

  const onPenDrag = useCallback((local: PathPoint) => {
    if (!dragging) return;
    setDraft((d) => {
      if (!d || d.nodes.length === 0) return d;
      const last = d.nodes.length - 1;
      const anchor = d.nodes[last].anchor;
      const out = { x: local.x - anchor.x, y: local.y - anchor.y };
      const nodes = d.nodes.map((n, i) =>
        i === last ? { ...n, out, in: { x: -out.x, y: -out.y } } : n,
      );
      return { ...d, nodes };
    });
  }, [dragging]);

  const onPenPointerUp = useCallback(() => setDragging(false), []);
```

Set `setDragging(true)` inside `onPenPointerDown` when `_withDrag` is true, and include `onPenDrag`/`onPenPointerUp` in the returned object. Re-run: PASS.

- [ ] **Step 6: Test + implement node-tool move with commit-coalescing**

Add a test:

```tsx
it('node tool: dragging an anchor commits one undo step on pointer-up', () => {
  // seed a path object via addVectorPath
  useEditor.getState().addVectorPath({
    nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 20, y: 0 } }],
    closed: false,
  });
  const { result } = renderHook(() => usePathTools());
  const histLen = () => (useEditor.getState().history as any).past.length;
  const before = histLen();

  act(() => result.current.onNodePointerDown({ x: 0, y: 0 })); // grab anchor 0
  act(() => result.current.onNodeDrag({ x: 5, y: 5 }));
  act(() => result.current.onNodeDrag({ x: 8, y: 8 }));
  act(() => result.current.onNodePointerUp());

  const asset = useEditor.getState().history.present.assets.find((a) => a.shapeType === 'path')!;
  expect(asset.path!.nodes[0].anchor).toEqual({ x: 8, y: 8 });
  expect(histLen()).toBe(before + 1); // exactly one commit
});
```

(Adjust `histLen` to the real `History` shape used elsewhere in tests.)

Implement node interaction in the hook using `hitTestAnchor`/`hitTestHandle` + `moveAnchor`/`moveHandle` and a single `setPathData` on pointer-up:

```ts
import { hitTestAnchor, hitTestHandle } from './pathHitTest';
import { moveAnchor, moveHandle } from './pathEdit';

// inside usePathTools:
const [grab, setGrab] = useState<
  | { kind: 'anchor'; index: number }
  | { kind: 'handle'; index: number; side: 'in' | 'out' }
  | null
>(null);
const [working, setWorking] = useState<import('../../../engine').PathData | null>(null);

const currentPath = () => {
  const s = useEditor.getState();
  const obj = s.history.present.objects.find((o) => o.id === s.selectedObjectId);
  const asset = obj && s.history.present.assets.find((a) => a.id === obj.assetId);
  return asset && asset.kind === 'vector' && asset.shapeType === 'path' ? asset.path ?? null : null;
};

const onNodePointerDown = useCallback((local: PathPoint, tol = 6) => {
  const path = currentPath();
  if (!path) return;
  const h = hitTestHandle(path, local, tol);
  if (h) { setGrab({ kind: 'handle', index: h.index, side: h.side }); setWorking(path); useEditor.getState().selectNode(h.index); return; }
  const a = hitTestAnchor(path, local, tol);
  if (a != null) { setGrab({ kind: 'anchor', index: a }); setWorking(path); useEditor.getState().selectNode(a); }
}, []);

const onNodeDrag = useCallback((local: PathPoint) => {
  setWorking((w) => {
    if (!w || !grab) return w;
    if (grab.kind === 'anchor') return moveAnchor(w, grab.index, local);
    const anchor = w.nodes[grab.index].anchor;
    return moveHandle(w, grab.index, grab.side, { x: local.x - anchor.x, y: local.y - anchor.y }, true);
  });
}, [grab]);

const onNodePointerUp = useCallback(() => {
  setWorking((w) => { if (w && grab) useEditor.getState().setPathData(w); return null; });
  setGrab(null);
}, [grab]);
```

Return `onNodePointerDown`, `onNodeDrag`, `onNodePointerUp`, and `working` (so the Stage can preview the in-progress edit). Re-run the test: PASS.

- [ ] **Step 7: Wire the hook into Stage + render draft preview and node overlay**

In `src/ui/components/Stage/Stage.tsx`:
- call `const pathTools = usePathTools();`
- in `onBackgroundPointerDown`, branch: when `activeTool === 'pen'`, convert the event via `clientToLocal` and call `pathTools.onPenPointerDown(local, /*withDrag*/ true)` (decide drag vs click on the subsequent move/up); when `activeTool === 'node'`, call `pathTools.onNodePointerDown(local)`.
- in the window `onMove`/`onUp` effect, route to `pathTools.onPenDrag/onPenPointerMove` and `pathTools.onNodeDrag`/`onNodePointerUp` when those interactions are active.
- handle double-click on the SVG to `pathTools.finishPen(false)` when a pen draft exists.
- render the draft as an SVG `<path d={pathToD({nodes: draft.nodes, closed:false})} …/>` plus a live segment to `draft.cursor`, inside `contentRef`'s group; a highlighted circle on node 0 when `nearFirstAnchor(...)`.
- when `activeTool === 'node'` and a path is selected, render the node overlay (anchors as small rects/circles, handles as lines+dots) inside the object's transformed group, using `pathTools.working ?? asset.path` so an in-progress drag previews.

Add a Stage test that a pen draft renders a preview path and double-click finishes it:

```ts
it('pen tool shows a draft preview and double-click finishes it', () => {
  useEditor.getState().setActiveTool('pen');
  renderStage();
  const svg = document.querySelector('svg')!;
  fireEvent.pointerDown(svg, { clientX: 10, clientY: 10 });
  fireEvent.pointerUp(svg);
  fireEvent.pointerDown(svg, { clientX: 40, clientY: 10 });
  fireEvent.pointerUp(svg);
  expect(document.querySelector('[data-testid="pen-draft"]')).not.toBeNull();
  fireEvent.doubleClick(svg);
  expect(useEditor.getState().history.present.objects.length).toBe(1);
});
```

(jsdom's `getScreenCTM` returns null; reuse the Stage test file's existing CTM mock so `clientToLocal` yields usable coordinates — the rect-draw tests already rely on this.)

- [ ] **Step 8: Run the Stage + hook tests**

Run: `pnpm test -- src/ui/components/Stage/usePathTools.test.tsx src/ui/components/Stage/Stage.test.tsx`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/ui/components/Stage/usePathTools.ts src/ui/components/Stage/usePathTools.test.tsx src/ui/components/Stage/Stage.tsx src/ui/components/Stage/Stage.test.tsx
git commit -m "feat(stage): pen authoring + node-editing via usePathTools; draft preview + node overlay"
```

---

### Task 8: Inspector — cap/join controls, path geometry branch, node-edit buttons

**Files:**
- Modify: `src/ui/components/Inspector/Inspector.tsx`
- Modify: `src/ui/components/Inspector/Inspector.test.tsx`

**Interfaces:**
- Consumes: store `setVectorStyle`, `toggleSelectedNodeSmooth`, `joinSelectedNode`, `breakSelectedNode`, `deleteSelectedNode`, `selectedNodeIndex`, `activeTool`.
- Produces: cap/join `<select>`s in the Style group (all vector shapes); path objects show no scalar geometry fields but a read-only node count; node-edit buttons when node tool active + a node selected.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/components/Inspector/Inspector.test.tsx`:

```ts
it('renders cap/join selects and applies them', () => {
  // seed a selected rect vector (existing helper) OR a path
  seedSelectedVector('rect');
  render(<Inspector />);
  fireEvent.change(screen.getByLabelText('strokeLinecap'), { target: { value: 'round' } });
  const asset = currentVectorAsset();
  expect(asset.style.strokeLinecap).toBe('round');
});

it('shows node count and node-edit buttons for a path in node mode', () => {
  seedSelectedPath(); // creates+selects a 3-node path
  useEditor.getState().setActiveTool('node');
  useEditor.getState().selectNode(1);
  render(<Inspector />);
  expect(screen.getByText(/nodes: 3/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /delete node/i }));
  expect(currentVectorAsset().path!.nodes).toHaveLength(2);
});

it('does not show scalar geometry fields for a path', () => {
  seedSelectedPath();
  render(<Inspector />);
  expect(screen.queryByLabelText('width')).toBeNull();
  expect(screen.queryByLabelText('radiusX')).toBeNull();
});
```

(Implement `seedSelectedVector`/`seedSelectedPath`/`currentVectorAsset` with the store, following the file's existing setup helpers.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/ui/components/Inspector/Inspector.test.tsx`
Expected: FAIL — controls/branch absent.

- [ ] **Step 3: Implement**

In `src/ui/components/Inspector/Inspector.tsx`:
- pull the new actions: `const { setProperty, setAnchor, setVectorStyle, toggleSelectedNodeSmooth, joinSelectedNode, breakSelectedNode, deleteSelectedNode } = useEditor.getState();` and read `const activeTool = useEditor((s) => s.activeTool); const selectedNodeIndex = useEditor((s) => s.selectedNodeIndex);`
- branch the geometry block on shapeType:

```tsx
      {vector && vector.shapeType !== 'path' && (
        <>
          <div className={styles.group}>Geometry</div>
          {(vector.shapeType === 'rect' ? RECT_GEOMETRY : ELLIPSE_GEOMETRY).map((prop) => (
            /* ...existing NumberField rows... */
          ))}
        </>
      )}
      {vector && vector.shapeType === 'path' && (
        <>
          <div className={styles.group}>Path</div>
          <div className={styles.row}>nodes: {vector.path?.nodes.length ?? 0}</div>
          {activeTool === 'node' && selectedNodeIndex != null && (
            <div className={styles.row}>
              <button onClick={() => toggleSelectedNodeSmooth()}>Corner/Smooth</button>
              <button onClick={() => joinSelectedNode()}>Join</button>
              <button onClick={() => breakSelectedNode()}>Break</button>
              <button onClick={() => deleteSelectedNode()}>Delete node</button>
            </div>
          )}
        </>
      )}
```

- add cap/join selects in the Style group (shown for all vector shapes), after the strokeWidth row:

```tsx
          <div className={styles.row}>
            <label htmlFor="insp-linecap">strokeLinecap</label>
            <select
              id="insp-linecap"
              aria-label="strokeLinecap"
              value={vector.style.strokeLinecap ?? 'butt'}
              onChange={(e) => setVectorStyle({ strokeLinecap: e.target.value as 'butt' | 'round' | 'square' })}
            >
              <option value="butt">butt</option>
              <option value="round">round</option>
              <option value="square">square</option>
            </select>
          </div>
          <div className={styles.row}>
            <label htmlFor="insp-linejoin">strokeLinejoin</label>
            <select
              id="insp-linejoin"
              aria-label="strokeLinejoin"
              value={vector.style.strokeLinejoin ?? 'miter'}
              onChange={(e) => setVectorStyle({ strokeLinejoin: e.target.value as 'miter' | 'round' | 'bevel' })}
            >
              <option value="miter">miter</option>
              <option value="round">round</option>
              <option value="bevel">bevel</option>
            </select>
          </div>
```

Add `breakSelectedNode` to the store (Task 5 added join/toggle/delete; add the trivial counterpart):

```ts
  breakSelectedNode(): void;
```
```ts
  breakSelectedNode() {
    // handles are independent in the data model; "break" flips the node's future
    // drag behavior to non-mirrored. Recorded via selectedNodeIndex; no path change.
    // (Mirror flag is read by usePathTools; see Task 7.)
  },
```

> Wire the mirror flag: `usePathTools.onNodeDrag` should consult a per-node "broken"
> set. For this slice, a pragmatic implementation is a `brokenNodes: Set<number>` in
> the hook toggled by `breakSelectedNode`/`joinSelectedNode` via a small store field
> `nodeMirror: boolean` OR by checking handle collinearity. Keep it minimal: read
> collinearity of `in`/`out` at drag start to decide `mirror` (mirrored handles →
> mirror; broken → independent). This removes the need for extra state.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/ui/components/Inspector/Inspector.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/Inspector/Inspector.tsx src/ui/components/Inspector/Inspector.test.tsx src/ui/store/store.ts
git commit -m "feat(inspector): cap/join controls, path node count, node-edit buttons"
```

---

### Task 9: Context-aware Delete + Escape-cancels-draft

**Files:**
- Modify: `src/ui/hooks/useKeyboard.ts`
- Modify: `src/ui/hooks/useKeyboard.test.ts`

**Interfaces:**
- Produces: `Delete`/`Backspace` → `deleteSelectedNode()` when `activeTool==='node' && selectedNodeIndex!=null`, else `removeSelectedKeyframe()`. `Escape` cancels a pen draft when one exists (signalled via a store flag), then returns to select.

> **Pen-draft visibility to keyboard:** the pen draft lives in `usePathTools` local
> state, which the keyboard hook can't see. Add a tiny transient store flag
> `penDrafting: boolean` set by `usePathTools` (via a store action `setPenDrafting`)
> on draft start/clear, and a store action `requestCancelPen()` the keyboard calls;
> `usePathTools` subscribes/reacts to cancel. Simpler alternative used here: keep a
> module-level event — but the store flag is cleaner and testable. Implement the
> store flag + `cancelPenRequested` counter that `usePathTools` watches in an effect.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/hooks/useKeyboard.test.ts`:

```ts
it('Delete removes a node in node mode but a keyframe otherwise', () => {
  renderHookWithKeyboard();
  // node mode + selected node -> node delete path
  useEditor.getState().addVectorPath({
    nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 20, y: 0 } }],
    closed: false,
  });
  useEditor.getState().setActiveTool('node');
  useEditor.getState().selectNode(1);
  fireEvent.keyDown(window, { key: 'Delete' });
  const asset = useEditor.getState().history.present.assets.find((a) => a.shapeType === 'path')!;
  expect(asset.path!.nodes).toHaveLength(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/ui/hooks/useKeyboard.test.ts`
Expected: FAIL — Delete always calls `removeSelectedKeyframe`.

- [ ] **Step 3: Implement**

In `src/ui/hooks/useKeyboard.ts`, replace the Delete/Backspace and Escape cases:

```ts
        case 'Delete':
        case 'Backspace':
          if (s.activeTool === 'node' && s.selectedNodeIndex != null) s.deleteSelectedNode();
          else s.removeSelectedKeyframe();
          break;
```

```ts
        case 'Escape':
          s.requestCancelPen();
          s.setActiveTool('select');
          break;
```

Add the store flag/action (transient): `penDrafting: boolean` default false, `cancelPenRequested: number` default 0, `setPenDrafting(v: boolean)`, `requestCancelPen()` (increments the counter). In `usePathTools`, watch `cancelPenRequested` in a `useEffect` and call `cancelPen()` when it changes; call `setPenDrafting(true/false)` when the draft starts/clears. (Add these to `TRANSIENT_DEFAULTS` and the interface.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/ui/hooks/useKeyboard.test.ts && pnpm typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/ui/hooks/useKeyboard.ts src/ui/hooks/useKeyboard.test.ts src/ui/store/store.ts src/ui/components/Stage/usePathTools.ts
git commit -m "feat(ui): context-aware Delete + Escape cancels pen draft"
```

---

### Task 10: Playwright e2e — draw a path, keyframe x, export, assert parity

**Files:**
- Create: `e2e/draw-path.spec.ts` (model on `e2e/draw-vector.spec.ts`)

**Interfaces:**
- Consumes: the running app; the existing export-parity harness used by `e2e/export.spec.ts` / `e2e/draw-vector.spec.ts`.

- [ ] **Step 1: Write the e2e test**

Create `e2e/draw-path.spec.ts`, mirroring `e2e/draw-vector.spec.ts` structure:

```ts
import { test, expect } from '@playwright/test';
// reuse the helpers/imports that draw-vector.spec.ts uses for app boot + export capture

test('draw a path, keyframe x, export -> bundle animates matching preview', async ({ page }) => {
  await page.goto('/');
  // select pen tool
  await page.getByRole('button', { name: 'Pen' }).click();
  const stage = page.locator('svg').first();
  // click three points then finish with double-click
  await stage.click({ position: { x: 100, y: 100 } });
  await stage.click({ position: { x: 200, y: 100 } });
  await stage.click({ position: { x: 200, y: 200 } });
  await stage.dblclick({ position: { x: 200, y: 200 } });

  // move playhead and keyframe x (use the same transport/inspector steps as draw-vector.spec.ts)
  // ...advance time, change Inspector x, asserting a keyframe is added...

  // export and assert the exported <path d> matches the editor's <path d>
  // (follow draw-vector.spec.ts's download + parse pattern; compare the path object's
  //  transform/d across a sampled time to the in-editor computed frame)
  // The key assertion: exported animation reproduces the preview for the path object.
});
```

> Fill the time/keyframe/export steps by copying the corresponding blocks from
> `e2e/draw-vector.spec.ts` (which already does draw → keyframe geometry → export →
> assert-animates) and adapting the selectors to the pen flow and a `path` element.

- [ ] **Step 2: Run the e2e to verify it fails, then passes**

Run: `pnpm test:e2e -- e2e/draw-path.spec.ts` (or the project's Playwright command from `package.json`).
Expected: initially FAIL if any wiring is incomplete; iterate until it PASSES against real Chromium.

- [ ] **Step 3: Commit**

```bash
git add e2e/draw-path.spec.ts
git commit -m "test(e2e): draw path -> keyframe x -> export animates (parity)"
```

---

### Task 11: Final verification gate

- [ ] **Step 1: Full suite + checks**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build`
Expected: all green.

- [ ] **Step 2: Regenerate runtime bundle if needed**

If Plan A Task 9 identified a runtime-generate script and the embedded core changed, run it and verify `src/runtime/runtimeSource.generated.ts` is current. (No path-specific runtime logic was added, so it likely needs no change — confirm.)

- [ ] **Step 3: Manual smoke (optional, via the `run` skill)**

Draw a path with the pen, switch to the node tool, move/insert/delete a node, toggle smooth/corner, set cap/join, export, and open the bundle to confirm the path animates.

---

## Self-Review

**Spec coverage (Plan B / spec §5, §4-preview, §7, §9-UI/e2e):**
- §5.1 palette pen/node + shortcuts → Task 1. §5.2 pen authoring (rubber-band, smooth/corner, close/finish/cancel, snap-to-close) → Task 7 (+ `nearFirstAnchor` from Task 4). §5.3 node tool + full toolkit → Tasks 2, 3, 5, 7, 8; select-tool path move-only / no resize overlay → Task 6. §5.4 Inspector cap/join + node-edit buttons + no scalar geometry for paths → Task 8. §5.5 asset-panel exclusion → inherited from Slice 1 (paths use the same vector exclusion; add a guard test if AssetPanel filters by `kind==='vector'` it already excludes paths — verify in Task 8 review). §5.6 context-aware Delete + Escape cancel → Task 9.
- §4 Stage path render via `pathToD` → Task 6; Stage `d` === export `d` parity → Task 6 test (`pathToD`) + Plan A export test.
- §9 UI/e2e tests → Tasks 1-9 (RTL) + Task 10 (Playwright).

**Placeholder scan:** Task 7 and Task 8/9 contain deliberate "implementation note" prose for the larger interactive wiring, but every step still ships concrete code or concrete copy-from-`draw-vector.spec.ts` instructions. The mirror-flag mechanism is pinned to "decide by handle collinearity at drag start" to avoid an unspecified state field. No "TBD/handle edge cases" remain.

**Type consistency:** `addVectorPath(path: PathData)`, `setPathData(path)`, `selectNode`, `selectedNodeIndex`, `deleteSelectedNode`/`toggleSelectedNodeSmooth`/`joinSelectedNode`/`breakSelectedNode` are consistent across Tasks 5, 7, 8, 9. `usePathTools` returns `onPenPointerDown/onPenDrag/onPenPointerMove/onPenPointerUp/finishPen/cancelPen/onNodePointerDown/onNodeDrag/onNodePointerUp/draft/working` consistently in Tasks 7 and the Stage wiring. Pure helper names (`insertNodeAt/deleteNodeAt/moveAnchor/moveHandle/toggleSmooth/joinHandle/breakHandle`, `hitTestAnchor/hitTestHandle/hitTestSegment/nearFirstAnchor`) match Tasks 2-4 usage in 5/7/8.

**Notable risk to flag at execution:** Task 7 is the heavy task; if it grows unwieldy, split the pen sub-hook and node sub-hook into `usePenTool.ts` / `useNodeEditor.ts`. The `History` internal shape (`past.length`) used in a test assertion must be matched to the real type — confirm against `src/engine/history.ts` before writing that assertion.
