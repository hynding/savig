# Compound-Ring Node Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Node tool edit a boolean result's compound rings (holes / disjoint pieces) with full parity to the primary path — move, handles, insert, delete, smooth, join.

**Architecture:** Extend node addressing from a flat `selectedNodeIndex` into the primary path to a `(selectedNodeRing, selectedNodeIndex)` pair across `path` + `compoundRings` (ring 0 = primary, ring k = `compoundRings[k-1]`). Reuse the ring-agnostic `pathEdit` helpers unchanged; add a ring-aware write path (`setRingPathData`) and a ring-aware drag preview (`working: { ring, path }`). The Stage overlay renders all rings; morph-only surfaces gate to ring 0.

**Tech Stack:** TypeScript (strict), React 18, Zustand, Vitest + RTL, Playwright. Client-only.

## Global Constraints

- Ring 0 = primary `path`; ring k ≥ 1 = `asset.compoundRings[k-1]`.
- Ring-0 behavior must be **byte-identical to today** (existing node-edit tests stay green).
- Reuse `pathEdit.ts` helpers (`deleteNodeAt`, `insertNodeAt`, `toggleSmooth`, `joinHandle`, `moveAnchor`, `moveHandle`) and `pathHitTest.ts` (`hitTestAnchor`, `hitTestHandle`, `hitTestSegment`) **unchanged** — they already operate on any `PathData`.
- Compound rings are **static**: never routed through `setPathData`'s shapeTrack branch; written directly to `asset.compoundRings`. No morph easings/correspondence for ring ≥1.
- `selectedNodeRing` is only set when a **non-null** `selectedNodeIndex` is set (in `selectNode` and `insertNode`); a stale ring under a null index is harmless, so the ~15 null-reset sites need NO ring reset.
- Morph-only surfaces gate to ring 0: Stage easing markers + correspondence overlay, Inspector `nodeEasingCtx`, `setSelectedNodeEasing`.
- `selectNode(index, ring = 0)` — default keeps all existing callers byte-unchanged.
- e2e: scope stage queries to `section[aria-label="Stage"]` (project lesson `293ccf5`).

---

### Task 1: Selection ring state + ring selectors

**Files:**
- Modify: `src/ui/store/store.ts` (state field, `selectNode`)
- Modify: `src/ui/store/selectors.ts` (`selectEditableRings`, `selectActiveRingPath`)
- Test: `src/ui/store/selectors.test.ts`, `src/ui/store/store.test.ts`

**Interfaces:**
- Consumes: existing `selectEditablePath(s)`, `selectActiveObjects(s)`, `EditorState`.
- Produces:
  - state `selectedNodeRing: number` (default `0`)
  - `selectNode(index: number | null, ring?: number): void` (ring default `0`)
  - `selectEditableRings(s: EditorState): PathData[]` — `[primaryOrNull?, ...compoundRings]`; `[]` when no editable primary; primary present → `[primary, ...compoundRings]`.
  - `selectActiveRingPath(s: EditorState): PathData | null` — the ring at `s.selectedNodeRing` from `selectEditableRings`, or null.

- [ ] **Step 1: Write the failing selectors test**

```ts
// append to src/ui/store/selectors.test.ts (match the file's existing import/setup style)
import { selectEditableRings, selectActiveRingPath } from './selectors';

describe('compound-ring selectors', () => {
  it('selectEditableRings returns primary + compound rings for a boolean result', () => {
    // Build a state with a selected path object whose asset has compoundRings.
    // Reuse the file's existing state/project builders; assetWithRings is illustrative.
    const s = makeStateWithSelectedPathAsset({
      path: { closed: true, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 10, y: 10 } }] },
      compoundRings: [
        { closed: true, nodes: [{ anchor: { x: 2, y: 2 } }, { anchor: { x: 4, y: 2 } }, { anchor: { x: 4, y: 4 } }] },
      ],
    });
    const rings = selectEditableRings(s);
    expect(rings).toHaveLength(2);
    expect(rings[0].nodes[0].anchor).toEqual({ x: 0, y: 0 }); // primary
    expect(rings[1].nodes[0].anchor).toEqual({ x: 2, y: 2 }); // compound
  });

  it('selectActiveRingPath honors selectedNodeRing', () => {
    const base = makeStateWithSelectedPathAsset({
      path: { closed: true, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 10, y: 10 } }] },
      compoundRings: [{ closed: true, nodes: [{ anchor: { x: 2, y: 2 } }, { anchor: { x: 4, y: 2 } }, { anchor: { x: 4, y: 4 } }] }],
    });
    expect(selectActiveRingPath({ ...base, selectedNodeRing: 0 })!.nodes[0].anchor).toEqual({ x: 0, y: 0 });
    expect(selectActiveRingPath({ ...base, selectedNodeRing: 1 })!.nodes[0].anchor).toEqual({ x: 2, y: 2 });
  });

  it('selectEditableRings is [primary] for a non-boolean path (no compoundRings)', () => {
    const s = makeStateWithSelectedPathAsset({
      path: { closed: true, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 10, y: 10 } }] },
    });
    expect(selectEditableRings(s)).toHaveLength(1);
  });
});
```

> Implementer: replace `makeStateWithSelectedPathAsset` with the file's existing state-construction helpers (it already builds projects/objects/assets for `selectEditablePath` tests). If no such helper exists, build the state inline mirroring an existing `selectEditablePath` test in the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/store/selectors.test.ts -t "compound-ring selectors"`
Expected: FAIL — `selectEditableRings`/`selectActiveRingPath` not exported.

- [ ] **Step 3: Implement the selectors**

```ts
// src/ui/store/selectors.ts — add after selectEditablePath
export function selectEditableRings(s: EditorState): PathData[] {
  const primary = selectEditablePath(s);
  if (!primary) return [];
  const obj = selectActiveObjects(s).find((o) => o.id === s.selectedObjectId);
  const asset = s.history.present.assets.find((a) => a.id === obj?.assetId);
  const rings = asset && asset.kind === 'vector' ? asset.compoundRings ?? [] : [];
  return [primary, ...rings];
}

export function selectActiveRingPath(s: EditorState): PathData | null {
  const rings = selectEditableRings(s);
  return rings[s.selectedNodeRing] ?? null;
}
```

- [ ] **Step 4: Add the state field + ring-aware `selectNode`**

```ts
// src/ui/store/store.ts
// 1) in the EditorState interface, next to `selectedNodeIndex: number | null;`
selectedNodeRing: number;
// 2) in the create()(...) initial state, next to `selectedNodeIndex: null as number | null,`
selectedNodeRing: 0,
// 3) replace the existing selectNode:
selectNode(index, ring = 0) {
  set({ selectedNodeIndex: index, selectedNodeRing: ring });
},
```

Also update the `selectNode` signature in the interface:

```ts
selectNode(index: number | null, ring?: number): void;
```

- [ ] **Step 5: Write the failing store test for ring tracking**

```ts
// append to src/ui/store/store.test.ts in a new describe
describe('compound-ring node selection', () => {
  it('selectNode records the ring; default ring is 0', () => {
    useEditor.getState().newProject();
    useEditor.getState().selectNode(3, 2);
    expect(useEditor.getState().selectedNodeIndex).toBe(3);
    expect(useEditor.getState().selectedNodeRing).toBe(2);
    useEditor.getState().selectNode(1);
    expect(useEditor.getState().selectedNodeRing).toBe(0);
  });
});
```

- [ ] **Step 6: Run tests**

Run: `pnpm vitest run src/ui/store/selectors.test.ts src/ui/store/store.test.ts -t "compound-ring"` then `pnpm typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/ui/store/store.ts src/ui/store/selectors.ts src/ui/store/selectors.test.ts src/ui/store/store.test.ts
git commit -m "feat(node-edit): (ring,node) selection state + ring selectors"
```

---

### Task 2: Ring-aware write path + node actions

**Files:**
- Modify: `src/ui/store/store.ts` (`setRingPathData`, `deleteSelectedNode`, `insertNode`, `toggleSelectedNodeSmooth`, `joinSelectedNode`, `setSelectedNodeEasing`)
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Consumes: `selectActiveRingPath` (Task 1), `selectedPathCtx(get)` (existing → `{ obj, asset }`), `setPathData(path, structural?)` (existing), `pathEdit` helpers, `replaceObjectInScene`, `selectActiveAssetId`.
- Produces:
  - `setRingPathData(ring: number, path: PathData, structural?: { index: number; op: 'insert' | 'delete' }): void`
  - `insertNode(ring: number, segmentIndex: number, t: number): void` (signature gains `ring`)

- [ ] **Step 1: Write the failing test**

```ts
// append to src/ui/store/store.test.ts inside the booleanOp describe area, reusing addVectorShape
describe('compound-ring node editing (store)', () => {
  function makeRectWithEllipseHole() {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorShape('rect', { x: 0, y: 0, width: 40, height: 40 });
    const big = useEditor.getState().selectedObjectId!;
    s.addVectorShape('ellipse', { x: 12, y: 12, width: 16, height: 16 });
    const small = useEditor.getState().selectedObjectId!;
    useEditor.getState().selectObjects([big, small]);
    useEditor.getState().booleanOp('subtract');
    const proj = useEditor.getState().history.present;
    const result = proj.objects.find((o) => o.id === useEditor.getState().selectedObjectId)!;
    const asset = proj.assets.find((a) => a.id === result.assetId) as VectorAsset;
    return { asset };
  }

  it('setRingPathData(0) edits the primary path (today’s behavior)', () => {
    const { asset } = makeRectWithEllipseHole();
    const before = asset.compoundRings![0];
    const newPrimary = { ...asset.path!, nodes: asset.path!.nodes.map((n, i) => (i === 0 ? { anchor: { x: -5, y: -5 } } : n)) };
    useEditor.getState().setRingPathData(0, newPrimary);
    const after = useEditor.getState().history.present.assets.find((a) => a.id === asset.id) as VectorAsset;
    expect(after.path!.nodes[0].anchor).toEqual({ x: -5, y: -5 });
    expect(after.compoundRings![0]).toEqual(before); // hole untouched
  });

  it('setRingPathData(1) edits the compound ring, leaving the primary untouched', () => {
    const { asset } = makeRectWithEllipseHole();
    const beforePrimary = asset.path!;
    const ring = asset.compoundRings![0];
    const movedRing = { ...ring, nodes: ring.nodes.map((n, i) => (i === 0 ? { anchor: { x: n.anchor.x + 1, y: n.anchor.y + 1 } } : n)) };
    useEditor.getState().setRingPathData(1, movedRing);
    const after = useEditor.getState().history.present.assets.find((a) => a.id === asset.id) as VectorAsset;
    expect(after.compoundRings![0].nodes[0].anchor).toEqual(movedRing.nodes[0].anchor);
    expect(after.path).toEqual(beforePrimary); // primary untouched
  });

  it('deleteSelectedNode on a compound ring removes from compoundRings only', () => {
    const { asset } = makeRectWithEllipseHole();
    const holeCount = asset.compoundRings![0].nodes.length;
    useEditor.getState().selectNode(0, 1);
    useEditor.getState().deleteSelectedNode();
    const after = useEditor.getState().history.present.assets.find((a) => a.id === asset.id) as VectorAsset;
    expect(after.compoundRings![0].nodes.length).toBe(holeCount - 1);
    expect(after.path!.nodes.length).toBe(asset.path!.nodes.length); // primary untouched
  });

  it('insertNode(1, …) inserts on the compound ring', () => {
    const { asset } = makeRectWithEllipseHole();
    const holeCount = asset.compoundRings![0].nodes.length;
    useEditor.getState().insertNode(1, 0, 0.5);
    const after = useEditor.getState().history.present.assets.find((a) => a.id === asset.id) as VectorAsset;
    expect(after.compoundRings![0].nodes.length).toBe(holeCount + 1);
  });

  it('setSelectedNodeEasing is a no-op on a compound ring', () => {
    const { asset } = makeRectWithEllipseHole();
    useEditor.getState().selectNode(0, 1);
    expect(() => useEditor.getState().setSelectedNodeEasing('easeIn')).not.toThrow();
    // no shapeTrack created on the (non-morphed) result object
    const proj = useEditor.getState().history.present;
    const result = proj.objects.find((o) => o.id === useEditor.getState().selectedObjectId)!;
    expect(result.shapeTrack).toBeFalsy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/store/store.test.ts -t "compound-ring node editing"`
Expected: FAIL — `setRingPathData` undefined; `insertNode` arity mismatch.

- [ ] **Step 3: Implement `setRingPathData` + rewire actions**

```ts
// src/ui/store/store.ts — add to the interface
setRingPathData(ring: number, path: PathData, structural?: { index: number; op: 'insert' | 'delete' }): void;
// change insertNode signature in the interface:
insertNode(ring: number, segmentIndex: number, t: number): void;

// implementation: add setRingPathData near setPathData
setRingPathData(ring, path, structural) {
  if (ring === 0) {
    get().setPathData(path, structural);
    return;
  }
  const s = get();
  const ctx = selectedPathCtx(get);
  if (!ctx) return;
  const { asset } = ctx;
  const rings = (asset.compoundRings ?? []).slice();
  const k = ring - 1;
  if (k < 0 || k >= rings.length) return;
  rings[k] = path;
  const next = { ...asset, compoundRings: rings };
  const project = s.history.present;
  get().commit({ ...project, assets: project.assets.map((a) => (a.id === asset.id ? next : a)) });
},
```

Rewire the node actions to be ring-aware (read the active ring, write via `setRingPathData`):

```ts
deleteSelectedNode() {
  const s = get();
  const idx = s.selectedNodeIndex;
  if (idx == null) return;
  const path = selectActiveRingPath(s);
  if (!path) return;
  const next = deleteNodeAt(path, idx);
  if (next === path) return; // 2-node floor: no-op
  get().setRingPathData(s.selectedNodeRing, next, { index: idx, op: 'delete' });
  set({ selectedNodeIndex: null });
},
insertNode(ring, segmentIndex, t) {
  const s = get();
  const rings = selectEditableRings(s);
  const path = rings[ring];
  if (!path) return;
  get().setRingPathData(ring, insertNodeAt(path, segmentIndex, t), { index: segmentIndex + 1, op: 'insert' });
  set({ selectedNodeIndex: segmentIndex + 1, selectedNodeRing: ring });
},
toggleSelectedNodeSmooth() {
  const s = get();
  if (s.selectedNodeIndex == null) return;
  const path = selectActiveRingPath(s);
  if (!path) return;
  get().setRingPathData(s.selectedNodeRing, toggleSmooth(path, s.selectedNodeIndex));
},
joinSelectedNode() {
  const s = get();
  if (s.selectedNodeIndex == null) return;
  const path = selectActiveRingPath(s);
  if (!path) return;
  get().setRingPathData(s.selectedNodeRing, joinHandle(path, s.selectedNodeIndex));
},
```

Gate `setSelectedNodeEasing` to ring 0 (add as the first line of the existing action):

```ts
setSelectedNodeEasing(easing) {
  const s = get();
  if (s.selectedNodeRing !== 0) return; // compound rings have no easings
  const idx = s.selectedNodeIndex;
  // ... rest unchanged ...
```

> Implementer: add `selectEditableRings`, `selectActiveRingPath` to the existing import from `./selectors` (alongside `selectEditablePath`). `setRingPathData` for ring 0 intentionally delegates to `setPathData` so the morph/primitive-detach behavior is reused verbatim.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run src/ui/store/store.test.ts -t "compound-ring node editing"` then `pnpm vitest run src/ui/store/store.test.ts -t "booleanOp"` (parity) then `pnpm typecheck`
Expected: PASS all; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(node-edit): ring-aware write path + node actions (setRingPathData)"
```

---

### Task 3: Ring-aware drag preview (usePathTools)

**Files:**
- Create: `src/ui/components/Stage/pickRingTarget.ts` (pure hit-test picker)
- Test: `src/ui/components/Stage/pickRingTarget.test.ts`
- Modify: `src/ui/components/Stage/usePathTools.ts`

**Interfaces:**
- Consumes: `hitTestAnchor`, `hitTestHandle` (`pathHitTest.ts`), `moveAnchor`, `moveHandle` (`pathEdit.ts`), `setRingPathData`, `selectEditableRings`, `selectNode`.
- Produces:
  - `interface RingTarget { ring: number; kind: 'anchor' | 'handle'; index: number; side?: 'in' | 'out' }`
  - `function pickRingTarget(rings: PathData[], local: PathPoint, tol: number): RingTarget | null` — handle hit beats anchor hit; lower ring index wins ties; null if nothing within `tol`.
  - `usePathTools().working` becomes `{ ring: number; path: PathData } | null`.

- [ ] **Step 1: Write the failing test**

```ts
// src/ui/components/Stage/pickRingTarget.test.ts
import { describe, it, expect } from 'vitest';
import { pickRingTarget } from './pickRingTarget';
import type { PathData } from '../../../engine';

const tri = (off: number): PathData => ({
  closed: true,
  nodes: [{ anchor: { x: off, y: off } }, { anchor: { x: off + 10, y: off } }, { anchor: { x: off + 10, y: off + 10 } }],
});

describe('pickRingTarget', () => {
  const rings = [tri(0), tri(100)];

  it('picks an anchor on the primary ring', () => {
    const t = pickRingTarget(rings, { x: 0, y: 0 }, 3);
    expect(t).toEqual({ ring: 0, kind: 'anchor', index: 0 });
  });

  it('picks an anchor on a compound ring', () => {
    const t = pickRingTarget(rings, { x: 110, y: 100 }, 3);
    expect(t).toMatchObject({ ring: 1, kind: 'anchor', index: 1 });
  });

  it('returns null when nothing is within tolerance', () => {
    expect(pickRingTarget(rings, { x: 500, y: 500 }, 3)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/components/Stage/pickRingTarget.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `pickRingTarget`**

```ts
// src/ui/components/Stage/pickRingTarget.ts
import type { PathData, PathPoint } from '../../../engine';
import { hitTestAnchor, hitTestHandle } from './pathHitTest';

export interface RingTarget {
  ring: number;
  kind: 'anchor' | 'handle';
  index: number;
  side?: 'in' | 'out';
}

// Handle hits beat anchor hits (handles sit slightly off the anchor and are the finer
// target); lower ring index wins ties. Returns null when nothing is within `tol`.
export function pickRingTarget(rings: PathData[], local: PathPoint, tol: number): RingTarget | null {
  for (let ring = 0; ring < rings.length; ring++) {
    const h = hitTestHandle(rings[ring], local, tol);
    if (h) return { ring, kind: 'handle', index: h.index, side: h.side };
  }
  for (let ring = 0; ring < rings.length; ring++) {
    const a = hitTestAnchor(rings[ring], local, tol);
    if (a != null) return { ring, kind: 'anchor', index: a };
  }
  return null;
}
```

> Implementer: confirm `hitTestHandle`'s return shape is `{ index: number; side: 'in' | 'out' }` (pathHitTest.ts) and adapt the `side` field name if it differs.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/ui/components/Stage/pickRingTarget.test.ts`
Expected: PASS.

- [ ] **Step 5: Make `usePathTools` ring-aware**

Replace the node-editing block (`onNodePointerDown` / `onNodeDrag` / `onNodePointerUp`) and the `working` state so it tracks a ring. `working` state type becomes `{ ring: number; path: PathData } | null`.

```ts
// src/ui/components/Stage/usePathTools.ts
import { selectEditablePath, selectEditableRings } from '../../store/selectors';
import { pickRingTarget } from './pickRingTarget';

// working state (replace existing useState<PathData | null>):
const [working, setWorkingState] = useState<{ ring: number; path: PathData } | null>(null);
// keep the same workingRef mirroring pattern, typed to the new shape.

const currentRings = (): PathData[] => selectEditableRings(useEditor.getState());

const onNodePointerDown = useCallback((local: PathPoint, tol = HANDLE_TOL): boolean => {
  const rings = currentRings();
  const target = pickRingTarget(rings, local, tol);
  if (!target) return false;
  const path = rings[target.ring];
  if (target.kind === 'handle') {
    setGrab({ kind: 'handle', ring: target.ring, index: target.index, side: target.side!, mirror: isMirrored(path.nodes[target.index]) });
  } else {
    setGrab({ kind: 'anchor', ring: target.ring, index: target.index });
  }
  setWorking({ ring: target.ring, path });
  useEditor.getState().selectNode(target.index, target.ring);
  return true;
}, []);

const onNodeDrag = useCallback((local: PathPoint) => {
  setWorking((w) => {
    if (!w || !grab) return w;
    if (grab.kind === 'anchor') return { ring: w.ring, path: moveAnchor(w.path, grab.index, local) };
    const anchor = w.path.nodes[grab.index].anchor;
    return { ring: w.ring, path: moveHandle(w.path, grab.index, grab.side, { x: local.x - anchor.x, y: local.y - anchor.y }, grab.mirror) };
  });
}, [grab]);

const onNodePointerUp = useCallback(() => {
  const w = workingRef.current;
  if (w && grab) useEditor.getState().setRingPathData(w.ring, w.path);
  setWorking(null);
  setGrab(null);
}, [grab]);
```

Update the `grab` state type to carry `ring: number` in both the `anchor` and `handle` variants. The returned `working` (consumed by Stage) is now `{ ring, path } | null`.

> Implementer: `currentPath()` (line 23, used only by node editing) can be removed once `onNodePointerDown` uses `currentRings()`; keep it if other call sites remain. Preserve the existing `workingRef` sync pattern (just retyped).

- [ ] **Step 6: Run tests + typecheck**

Run: `pnpm vitest run src/ui/components/Stage/pickRingTarget.test.ts` then `pnpm typecheck`
Expected: PASS; typecheck surfaces the Stage consumer of `working` (fixed in Task 4) — if typecheck fails only in `Stage.tsx` on `working.path`/`working.ring`, that is expected and resolved in Task 4. Commit this task even with that known Stage typecheck error pending Task 4, OR sequence Task 4 immediately. Prefer: do Step 7 commit, then Task 4.

- [ ] **Step 7: Commit**

```bash
git add src/ui/components/Stage/pickRingTarget.ts src/ui/components/Stage/pickRingTarget.test.ts src/ui/components/Stage/usePathTools.ts
git commit -m "feat(node-edit): ring-aware drag preview + pickRingTarget helper"
```

---

### Task 4: Stage overlay renders all rings + insert across rings + gate overlays + Inspector gate

**Files:**
- Modify: `src/ui/components/Stage/Stage.tsx`
- Modify: `src/ui/components/Inspector/Inspector.tsx`

**Interfaces:**
- Consumes: `selectEditableRings`, `selectedNodeRing`, `pathTools.working: { ring, path } | null`, `insertNode(ring, segmentIndex, t)`, `hitTestSegment`.
- Produces: overlay renders a node handle per `(ring, i)`; `selectedPath.rings: PathData[]`.

- [ ] **Step 1: Extend the `selectedPath` memo with `rings`**

In `Stage.tsx` `selectedPath` memo (~264): keep `path`/`transform` derived from the **primary** path (unchanged), and add a `rings` array that substitutes `pathTools.working.path` into its ring:

```ts
const base = selectEditablePath(useEditor.getState());
if (!base) return null;
const w = pathTools.working; // { ring, path } | null
const primary = w && w.ring === 0 ? w.path : base;
const compound = selectEditableRings(useEditor.getState()).slice(1);
const rings = [primary, ...compound].map((p, i) => (w && w.ring === i ? w.path : p));
const state = sampleObject(obj, time);
const anchor = resolveAnchor(obj, state, 'path', pathBounds(primary)); // transform anchored to PRIMARY
return { obj, path: primary, rings, transform: buildTransform(state, anchor.anchorX, anchor.anchorY) };
```

Add `pathTools.working` to the memo dependency array (replacing the old `pathTools.working` path-typed dep).

- [ ] **Step 2: Render a handle per (ring, i)**

Replace the single-ring overlay map (~2113 `selectedPath.path.nodes.map(...)`) with a nested map over `selectedPath.rings`, tagging each node with its ring. The highlight condition becomes ring-aware:

```tsx
{selectedPath.rings.map((ring, r) =>
  ring.nodes.map((n, i) => (
    <circle
      key={`${r}-${i}`}
      // ...existing cx/cy/r/handle-line props computed from n...
      fill={r === selectedNodeRing && i === selectedNodeIndex ? 'var(--color-accent)' : 'var(--color-panel)'}
      onPointerDown={/* existing node-press path; selection happens via pathTools.onNodePointerDown */}
      data-testid={`node-handle-${r}-${i}`}
    />
  )),
)}
```

Read `selectedNodeRing` via `const selectedNodeRing = useEditor((s) => s.selectedNodeRing);` next to the existing `selectedNodeIndex` subscription (~97). Render bezier handle lines per ring node exactly as today, sourced from each ring's nodes.

> Implementer: preserve every existing per-node attribute/handler from the current overlay; the only changes are (a) outer loop over rings, (b) ring-aware key/testid/highlight. Keep the correspondence/easing overlay blocks rendering from `selectedPath.path` (primary) only — see Step 4.

- [ ] **Step 3: Insert across rings**

At the insert hit-test (~670, currently `const path = selectedPath?.path; ... hitTestSegment(path, local, tol) ... insertNode(seg.segmentIndex, seg.t)`), scan all rings and pass the ring:

```ts
const rings = selectedPath?.rings ?? [];
for (let r = 0; r < rings.length; r++) {
  const seg = hitTestSegment(rings[r], local, tol);
  if (seg) {
    useEditor.getState().insertNode(r, seg.segmentIndex, seg.t);
    break;
  }
}
```

- [ ] **Step 4: Gate morph-only overlays + Inspector to ring 0**

The Stage easing markers (`editedNodeEasings`) and the correspondence overlay already key off the primary path; ensure they remain bound to `selectedPath.path`/ring 0 (no change needed if they don't iterate `rings`). In `Inspector.tsx` (~329), gate `nodeEasingCtx`:

```ts
const selectedNodeRing = useEditor((s) => s.selectedNodeRing);
// ...
if (
  selectedNodeRing === 0 &&
  selectedNodeIndex != null &&
  edited &&
  selectedNodeIndex < edited.kf.path.nodes.length &&
  (edited.kf.morph ?? 'corresponded') === 'corresponded'
) { /* build nodeEasingCtx unchanged */ }
```

- [ ] **Step 5: Verify build + parity**

Run: `pnpm typecheck` then `pnpm test`
Expected: typecheck clean; full unit suite green (ring-0 behavior unchanged — existing node-edit tests pass).

- [ ] **Step 6: Commit**

```bash
git add src/ui/components/Stage/Stage.tsx src/ui/components/Inspector/Inspector.tsx
git commit -m "feat(node-edit): Stage overlay renders all rings + insert across rings; gate morph surfaces to ring 0"
```

---

### Task 5: e2e — node-edit a boolean hole

**Files:**
- Modify: `e2e/boolean-ops.spec.ts`

**Interfaces:**
- Consumes: the full feature (overlay handles `data-testid="node-handle-<r>-<i>"`).

- [ ] **Step 1: Write the e2e**

Add a test that builds a rect-minus-interior-ellipse (reuse the helpers added in the curve-preserving slice — draw rect, draw ellipse in empty space, drag interior, select both, Subtract), switches to the Node tool, and drags a compound-ring node, asserting the rendered compound path `d` changes.

```ts
test('node-edit a boolean hole reshapes the compound ring', async ({ page }) => {
  // ...reuse the existing draw/drag/select/Subtract setup from the curve-preserving test...
  // After Subtract leaves one object, switch to the Node tool:
  await page.getByRole('group', { name: 'Tools' }).getByRole('button', { name: 'Node', exact: true }).click();

  const stage = page.locator('section[aria-label="Stage"]');
  const before = await stage.locator('[data-savig-object] path').first().getAttribute('d');

  // A compound-ring handle is ring index 1 (the hole). Drag the first such handle.
  const holeHandle = stage.locator('[data-testid^="node-handle-1-"]').first();
  const hb = (await holeHandle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 24, hb.y + 24);
  await page.mouse.up();

  const after = await stage.locator('[data-savig-object] path').first().getAttribute('d');
  expect(after).not.toBe(before);
});
```

> Implementer: confirm the Node tool button's accessible name (`'Node'`) from the Tools group in `Stage`/toolbar; adjust `exact` name if it differs. Confirm the result object exposes `[data-savig-object] path` (it does — boolean results render via `pathToDRings`). If the hole handle isn't directly hittable because it sits under the outer fill, click an empty Stage area first to ensure the node overlay is the topmost interactive layer (the overlay renders above the shape in the Node tool).

- [ ] **Step 2: Run the e2e**

First kill any stale Vite, then:

Run: `pnpm e2e e2e/boolean-ops.spec.ts`
Expected: PASS (all tests in the file, including the new one).

- [ ] **Step 3: Commit**

```bash
git add e2e/boolean-ops.spec.ts
git commit -m "test(node-edit): e2e node-edit a boolean hole reshapes the compound ring"
```

---

## Self-Review

**Spec coverage:**
- `(selectedNodeRing, selectedNodeIndex)` addressing + default-0 `selectNode` → Task 1. ✓
- `selectEditableRings` / `selectActiveRingPath` (ring ≥1 static) → Task 1. ✓
- `setRingPathData` (ring 0 → setPathData; ring k → compoundRings) → Task 2. ✓
- Ring-aware delete/insert/toggleSmooth/join + 2-node floor → Task 2. ✓
- `setSelectedNodeEasing` ring-0 gate → Task 2. ✓
- Ring-aware drag preview (`working: { ring, path }`, commit via setRingPathData) → Task 3. ✓
- `pickRingTarget` hit-test across rings → Task 3. ✓
- Overlay renders all rings, (ring,i) tags, ring-aware highlight, transform primary-anchored → Task 4. ✓
- Insert hit-test across rings → Task 4. ✓
- Gate Stage easing/correspondence overlays + Inspector `nodeEasingCtx` to ring 0 → Task 4. ✓
- Non-boolean asset unchanged (selectEditableRings = [primary]) → Task 1 test. ✓
- Testing: store + selectors + pure helper + e2e → Tasks 1/2/3/5. ✓

**Placeholder scan:** No TBD/TODO. Fixture/builder names in tests defer to existing file helpers, flagged inline each time with full assertion bodies provided (not generic placeholders).

**Type consistency:** `selectedNodeRing: number`, `selectNode(index, ring?)`, `setRingPathData(ring, path, structural?)`, `insertNode(ring, segmentIndex, t)`, `selectEditableRings`, `selectActiveRingPath`, `working: { ring, path }`, `RingTarget { ring, kind, index, side? }`, `pickRingTarget(rings, local, tol)` are named identically across tasks. The `working` type change (Task 3) is consumed in Task 4 — Task 3 notes the transient cross-task typecheck error so the sequence is explicit.

## Notes / Risks
- Ring-0 fallback bounds regression risk: every primary-path interaction is byte-unchanged, so a bug shows up only on compound rings.
- The `working` type change spans Tasks 3→4; do them back-to-back (a clean `pnpm typecheck` only after Task 4).
- `selectedNodeRing` deliberately not reset at null-index sites (Global Constraints) — only set when a non-null index is set.
