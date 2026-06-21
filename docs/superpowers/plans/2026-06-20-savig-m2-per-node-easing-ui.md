# Per-Node Easing — Plan B (UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Author per-node easing — select a node on a shape keyframe, edit its easing via the Feature 1 curve editor — with the easing surviving node edits and a Stage marker for discoverability.

**Architecture:** A pre-existing bug fix (path edits must preserve a keyframe's `easing`/`morph`/`correspondence`/`nodeEasings`) underpins the feature; node count changes splice `nodeEasings` via a pure helper. A `selectEditedShapeKeyframe` selector resolves the snapped-playhead keyframe; `setSelectedNodeEasing` writes `nodeEasings[selectedNodeIndex]`; the Inspector shows a Node-easing section and the Stage marks custom-easing nodes.

**Tech Stack:** React 18 + TS (strict), Zustand, Vitest + RTL + `@testing-library/user-event`, Playwright.

**Prerequisite:** Plan A (engine) merged — `nodeEasings?` field, `reconcile` `aIndex`, per-pair `samplePath`.

## Global Constraints

- **One undo step per gesture** — each action routes through a single `get().commit(...)`.
- **Per-node easing targets the snapped-playhead keyframe** (`selectEditedShapeKeyframe`), guarded `selectedNodeIndex < kf.path.nodes.length`. NOT `selectedShapeKeyframe`.
- **Corresponded-mode only** — the Node-easing section is hidden under `resampled`.
- **`undefined` clears** a node's easing back to the keyframe default (hole); an all-empty `nodeEasings` collapses to `undefined` (no stored field).
- **Path edits preserve keyframe fields** (the §5.0 fix) — never reset `easing` to `'linear'` or drop `morph`/`correspondence`/`nodeEasings` on an existing keyframe.
- Tests: `pnpm vitest run <path>`; typecheck `pnpm typecheck`; lint `pnpm lint`; e2e `pnpm exec playwright test <spec>`.

---

## File Structure

- `src/ui/components/Stage/pathEdit.ts` — `spliceNodeEasings` pure helper (MODIFY).
- `src/ui/components/Stage/pathEdit.test.ts` — helper test (MODIFY).
- `src/ui/store/store.ts` — `setPathData` field-preservation + structural splice; `insertNode`; `deleteSelectedNode` wiring; `setSelectedNodeEasing` (MODIFY).
- `src/ui/store/selectors.ts` — `selectEditedShapeKeyframe` (MODIFY).
- `src/ui/store/store.test.ts` — store tests (MODIFY).
- `src/ui/components/Stage/Stage.tsx` — node-insert via `insertNode`; custom-easing marker (MODIFY).
- `src/ui/components/Stage/Stage.test.tsx` — marker test (MODIFY).
- `src/ui/components/Inspector/Inspector.tsx` — Node-easing section (MODIFY).
- `src/ui/components/Inspector/Inspector.test.tsx` — RTL (MODIFY).
- `e2e/per-node-easing.spec.ts` — e2e (CREATE).

---

## Task B1: `spliceNodeEasings` pure helper

**Files:**
- Modify: `src/ui/components/Stage/pathEdit.ts`
- Test: `src/ui/components/Stage/pathEdit.test.ts`

**Interfaces:**
- Produces: `spliceNodeEasings(easings: Easing[] | undefined, index: number, op: 'insert' | 'delete'): Easing[] | undefined`

- [ ] **Step 1: Write the failing test**

Add to `src/ui/components/Stage/pathEdit.test.ts`:

```ts
import { spliceNodeEasings } from './pathEdit';

describe('spliceNodeEasings', () => {
  it('insert adds a hole at index, shifting later entries', () => {
    expect(spliceNodeEasings(['easeIn', 'linear'], 1, 'insert')).toEqual(['easeIn', undefined, 'linear']);
  });
  it('delete removes the entry at index', () => {
    expect(spliceNodeEasings(['easeIn', 'linear', 'easeOut'], 1, 'delete')).toEqual(['easeIn', 'easeOut']);
  });
  it('collapses to undefined when no real entries remain', () => {
    expect(spliceNodeEasings(['easeIn'], 0, 'delete')).toBeUndefined();
  });
  it('returns undefined unchanged (nothing to maintain)', () => {
    expect(spliceNodeEasings(undefined, 0, 'insert')).toBeUndefined();
  });
  it('does not mutate the input', () => {
    const src = ['easeIn', 'linear'];
    spliceNodeEasings(src, 0, 'delete');
    expect(src).toEqual(['easeIn', 'linear']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/components/Stage/pathEdit.test.ts`
Expected: FAIL — `spliceNodeEasings` not exported.

- [ ] **Step 3: Implement**

In `src/ui/components/Stage/pathEdit.ts`, add an `Easing` import to the existing type import and append:

```ts
// Keep a sparse per-node-easing array aligned with path.nodes across a node insert/delete.
// Insert: a hole at `index`. Delete: drop `index`. Collapses to undefined when empty.
export function spliceNodeEasings(
  easings: Easing[] | undefined,
  index: number,
  op: 'insert' | 'delete',
): Easing[] | undefined {
  if (!easings) return easings;
  const next = easings.slice();
  if (op === 'insert') next.splice(index, 0, undefined as unknown as Easing);
  else next.splice(index, 1);
  return next.some((e) => e != null) ? next : undefined;
}
```

(If `pathEdit.ts` does not yet import `Easing`, add it: `import type { Easing, PathData } from '../../../engine';` — keep whatever it already imports.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/ui/components/Stage/pathEdit.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/Stage/pathEdit.ts src/ui/components/Stage/pathEdit.test.ts
git commit -m "feat(path): spliceNodeEasings helper (keep per-node easings aligned across node edits)"
```

---

## Task B2: Path edits preserve keyframe fields + splice `nodeEasings` on count change

Fix the pre-existing wipe and wire the structural splice. `setPathData` gains an optional structural hint; `deleteSelectedNode` passes it; node-insert becomes the `insertNode` action.

**Files:**
- Modify: `src/ui/store/store.ts` (`setPathData`, `deleteSelectedNode`, new `insertNode`)
- Modify: `src/ui/components/Stage/Stage.tsx` (insert call site ~line 282)
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Consumes: `spliceNodeEasings` (Task B1).
- Produces: `setPathData(path: PathData, structural?: { index: number; op: 'insert' | 'delete' }): void`
- Produces: `insertNode(segmentIndex: number, t: number): void`

- [ ] **Step 1: Write the failing tests**

Add to `src/ui/store/store.test.ts` (helpers `addVectorPath`/`addShapeKeyframe`/`selectShapeKeyframe` already exist in this file):

```ts
describe('node edits preserve keyframe fields + align nodeEasings', () => {
  function seedKf() {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorPath({ nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 5, y: 9 } }], closed: true });
    s.addShapeKeyframe(); // kf@0
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().selectShapeKeyframe({ objectId: id, time: 0 });
  }

  it('a path edit preserves the keyframe easing and morph (no wipe)', () => {
    seedKf();
    useEditor.getState().setSelectedKeyframeEasing('easeIn');
    useEditor.getState().setSelectedShapeKeyframeMorph('resampled');
    // a node move (same count) at the same playhead
    useEditor.getState().setPathData({ nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 20, y: 0 } }, { anchor: { x: 5, y: 9 } }], closed: true });
    const kf = useEditor.getState().history.present.objects[0].shapeTrack![0];
    expect(kf.easing).toBe('easeIn');
    expect(kf.morph).toBe('resampled');
  });

  it('delete-node splices out the node easing at that index', () => {
    seedKf();
    // hand-set nodeEasings on the keyframe via the store path used by setSelectedNodeEasing's data shape
    const proj = useEditor.getState().history.present;
    const obj = proj.objects[0];
    useEditor.getState().commit({ ...proj, objects: [{ ...obj, shapeTrack: [{ ...obj.shapeTrack![0], nodeEasings: ['easeIn', 'linear', 'easeOut'] }] }] });
    useEditor.getState().selectNode(1);
    useEditor.getState().deleteSelectedNode();
    expect(useEditor.getState().history.present.objects[0].shapeTrack![0].nodeEasings).toEqual(['easeIn', 'easeOut']);
  });

  it('insertNode inserts a hole at the new index and selects it', () => {
    seedKf();
    const proj = useEditor.getState().history.present;
    const obj = proj.objects[0];
    useEditor.getState().commit({ ...proj, objects: [{ ...obj, shapeTrack: [{ ...obj.shapeTrack![0], nodeEasings: ['easeIn', 'linear', 'easeOut'] }] }] });
    useEditor.getState().insertNode(0, 0.5); // insert on segment 0 -> new node at index 1
    const kf = useEditor.getState().history.present.objects[0].shapeTrack![0];
    expect(kf.nodeEasings).toEqual(['easeIn', undefined, 'linear', 'easeOut']);
    expect(useEditor.getState().selectedNodeIndex).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/ui/store/store.test.ts`
Expected: FAIL — `setPathData` resets fields; `insertNode` does not exist.

- [ ] **Step 3: Field-preserving `setPathData` with the structural hint**

In `src/ui/store/store.ts`, add the import (next to the existing `pathEdit` import — `deleteNodeAt`/`insertNodeAt` already come from there):

```ts
import { deleteNodeAt, insertNodeAt, spliceNodeEasings } from '../components/Stage/pathEdit';
```

(Keep whatever `pathEdit` symbols are already imported; just add `spliceNodeEasings`, and `insertNodeAt` if not present.)

Replace `setPathData`:

```ts
  setPathData(path, structural) {
    const s = get();
    const project = s.history.present;
    const ctx = selectedPathCtx(get);
    if (!ctx) return;
    const { obj, asset } = ctx;
    if (obj.shapeTrack && obj.shapeTrack.length > 0) {
      const time = snapToFrame(s.time, project.meta.fps);
      const existing = obj.shapeTrack.find((k) => Math.abs(k.time - time) < KF_EPS);
      // Preserve the existing keyframe's fields; only replace the path (and realign
      // nodeEasings on a structural count change). New keyframes default to linear.
      const nodeEasings = structural
        ? spliceNodeEasings(existing?.nodeEasings, structural.index, structural.op)
        : existing?.nodeEasings;
      const merged: ShapeKeyframe = existing
        ? { ...existing, path, nodeEasings }
        : { time, path, easing: 'linear' };
      const shapeTrack = upsertShapeKeyframe(obj.shapeTrack, merged);
      get().commit(replaceObject(project, { ...obj, shapeTrack }));
    } else {
      const next = { ...asset, path };
      get().commit({ ...project, assets: project.assets.map((a) => (a.id === asset.id ? next : a)) });
    }
  },
```

Update the interface line for `setPathData`:

```ts
  setPathData(path: PathData, structural?: { index: number; op: 'insert' | 'delete' }): void;
```

(If `ShapeKeyframe` is not yet imported in `store.ts`, add it to the `from '../../engine'` type import.)

- [ ] **Step 4: Wire `deleteSelectedNode` and add `insertNode`**

Replace `deleteSelectedNode` and add `insertNode` after it:

```ts
  deleteSelectedNode() {
    const s = get();
    const idx = s.selectedNodeIndex;
    if (idx == null) return;
    const path = selectEditablePath(s);
    if (!path) return;
    s.setPathData(deleteNodeAt(path, idx), { index: idx, op: 'delete' });
    set({ selectedNodeIndex: null });
  },
  insertNode(segmentIndex, t) {
    const s = get();
    const path = selectEditablePath(s);
    if (!path) return;
    s.setPathData(insertNodeAt(path, segmentIndex, t), { index: segmentIndex + 1, op: 'insert' });
    set({ selectedNodeIndex: segmentIndex + 1 });
  },
```

Add the interface line near `deleteSelectedNode(): void;`:

```ts
  insertNode(segmentIndex: number, t: number): void;
```

- [ ] **Step 5: Route the Stage insert through `insertNode`**

In `src/ui/components/Stage/Stage.tsx` (~line 282), replace:

```tsx
          useEditor.getState().setPathData(insertNodeAt(path, seg.segmentIndex, seg.t));
          useEditor.getState().selectNode(seg.segmentIndex + 1);
```

with:

```tsx
          useEditor.getState().insertNode(seg.segmentIndex, seg.t);
```

Remove the now-unused `insertNodeAt` import from `Stage.tsx` if nothing else uses it (check with `grep -n insertNodeAt src/ui/components/Stage/Stage.tsx`).

- [ ] **Step 6: Run tests + full suite (regression: the field-preservation change touches every node edit)**

Run: `pnpm vitest run src/ui/store/store.test.ts && pnpm vitest run && pnpm typecheck && pnpm lint`
Expected: PASS — new tests green; **all existing tests still green** (the only behavior change is preserving fields on an existing keyframe instead of wiping them).

- [ ] **Step 7: Commit**

```bash
git add src/ui/store/store.ts src/ui/components/Stage/Stage.tsx src/ui/store/store.test.ts
git commit -m "fix(store): node edits preserve keyframe fields; insertNode/deleteSelectedNode align nodeEasings"
```

---

## Task B3: `selectEditedShapeKeyframe` selector + `setSelectedNodeEasing`

**Files:**
- Modify: `src/ui/store/selectors.ts`
- Modify: `src/ui/store/store.ts`
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Produces: `selectEditedShapeKeyframe(s: EditorState): { kf: ShapeKeyframe; index: number } | null`
- Produces: `setSelectedNodeEasing(easing: Easing | undefined): void`

- [ ] **Step 1: Write the failing test**

Add to `src/ui/store/store.test.ts`:

```ts
describe('setSelectedNodeEasing', () => {
  function seedNode() {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorPath({ nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }], closed: false });
    s.addShapeKeyframe();
    s.seek(0);
    useEditor.getState().selectNode(1);
  }

  it('writes nodeEasings[selectedNodeIndex] on the playhead keyframe, one undo step', () => {
    seedNode();
    const before = useEditor.getState().history.past.length;
    useEditor.getState().setSelectedNodeEasing('easeIn');
    const kf = () => useEditor.getState().history.present.objects[0].shapeTrack![0];
    expect(kf().nodeEasings).toEqual([undefined, 'easeIn']);
    expect(useEditor.getState().history.past.length).toBe(before + 1);
  });

  it('undefined clears the entry and collapses an empty array', () => {
    seedNode();
    useEditor.getState().setSelectedNodeEasing('easeIn');
    useEditor.getState().setSelectedNodeEasing(undefined);
    expect(useEditor.getState().history.present.objects[0].shapeTrack![0].nodeEasings).toBeUndefined();
  });

  it('is a no-op off a keyframe (no shape keyframe at the playhead)', () => {
    seedNode();
    useEditor.getState().seek(0.5); // between/after the only keyframe (t=0) -> not on it
    const before = useEditor.getState().history.past.length;
    useEditor.getState().setSelectedNodeEasing('easeIn');
    expect(useEditor.getState().history.past.length).toBe(before);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/store/store.test.ts`
Expected: FAIL — `setSelectedNodeEasing` not a function.

- [ ] **Step 3: Add the selector**

In `src/ui/store/selectors.ts`, extend the imports and append the selector:

```ts
import { computeProjectDuration, samplePath, snapToFrame } from '../../engine';
import type { PathData, Project, SceneObject, ShapeKeyframe } from '../../engine';
```

```ts
const EDITED_KF_EPS = 1e-6;

// The shape keyframe whose time matches the snapped playhead (the one node edits target),
// with its index in the track — or null when the playhead is not on a keyframe.
export function selectEditedShapeKeyframe(s: EditorState): { kf: ShapeKeyframe; index: number } | null {
  const obj = s.history.present.objects.find((o) => o.id === s.selectedObjectId);
  if (!obj?.shapeTrack || obj.shapeTrack.length === 0) return null;
  const t = snapToFrame(s.time, s.history.present.meta.fps);
  const index = obj.shapeTrack.findIndex((k) => Math.abs(k.time - t) < EDITED_KF_EPS);
  return index >= 0 ? { kf: obj.shapeTrack[index], index } : null;
}
```

- [ ] **Step 4: Add the store action**

In `src/ui/store/store.ts`, add `selectEditedShapeKeyframe` to the `from './selectors'` import (next to `selectEditablePath`), add the interface line near `setSelectedShapeKeyframeCorrespondence`:

```ts
  setSelectedNodeEasing(easing: Easing | undefined): void;
```

and the implementation (near the other `setSelected*` actions):

```ts
  setSelectedNodeEasing(easing) {
    const s = get();
    const idx = s.selectedNodeIndex;
    if (idx == null) return;
    const edited = selectEditedShapeKeyframe(s);
    if (!edited || idx >= edited.kf.path.nodes.length) return;
    const project = s.history.present;
    const obj = project.objects.find((o) => o.id === s.selectedObjectId);
    if (!obj?.shapeTrack) return;
    const arr = (edited.kf.nodeEasings ?? []).slice();
    arr[idx] = easing as Easing;
    const nodeEasings = arr.some((e) => e != null) ? arr : undefined;
    const shapeTrack = obj.shapeTrack.map((k, i) => (i === edited.index ? { ...k, nodeEasings } : k));
    get().commit(replaceObject(project, { ...obj, shapeTrack }));
  },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/ui/store/store.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ui/store/selectors.ts src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(store): selectEditedShapeKeyframe + setSelectedNodeEasing (per-node easing on the playhead keyframe)"
```

---

## Task B4: Inspector "Node easing" section

**Files:**
- Modify: `src/ui/components/Inspector/Inspector.tsx`
- Test: `src/ui/components/Inspector/Inspector.test.tsx`

**Interfaces:**
- Consumes: `selectEditedShapeKeyframe`, `setSelectedNodeEasing`, `EasingEditor`.

- [ ] **Step 1: Write the failing tests**

Add to `src/ui/components/Inspector/Inspector.test.tsx`:

```ts
describe('Inspector node easing', () => {
  function seedNodeOnKf(morph?: 'resampled') {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorPath({ nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }], closed: false });
    s.addShapeKeyframe();
    s.seek(1);
    s.addShapeKeyframe();
    const id = useEditor.getState().selectedObjectId!;
    useEditor.getState().seek(0);
    if (morph) {
      useEditor.getState().selectShapeKeyframe({ objectId: id, time: 0 });
      useEditor.getState().setSelectedShapeKeyframeMorph('resampled');
    }
    useEditor.getState().selectNode(1);
  }

  it('shows the Node easing editor for a node on a corresponded keyframe and writes nodeEasings', async () => {
    seedNodeOnKf();
    render(<Inspector />);
    expect(screen.getByText(/node 1 — overrides keyframe easing/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'easeIn' }));
    expect(useEditor.getState().history.present.objects[0].shapeTrack![0].nodeEasings).toEqual([undefined, 'easeIn']);
  });

  it('reset clears the node easing back to the keyframe default', async () => {
    seedNodeOnKf();
    useEditor.getState().setSelectedNodeEasing('easeIn');
    render(<Inspector />);
    await userEvent.click(screen.getByRole('button', { name: 'reset to keyframe default' }));
    expect(useEditor.getState().history.present.objects[0].shapeTrack![0].nodeEasings).toBeUndefined();
  });

  it('hides the Node easing section under resampled mode', () => {
    seedNodeOnKf('resampled');
    render(<Inspector />);
    expect(screen.queryByText(/overrides keyframe easing/)).toBeNull();
  });
});
```

(The `easeIn` preset button comes from the reused `EasingEditor`; if its preset is labeled differently, use the label the Feature 1 tests use for the easeIn preset.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/ui/components/Inspector/Inspector.test.tsx`
Expected: FAIL — no Node easing section.

- [ ] **Step 3: Compute the node-easing context**

In `src/ui/components/Inspector/Inspector.tsx`:

(a) Add to the selectors import:

```ts
import { selectSelectedObject, selectEditablePath, selectEditedShapeKeyframe } from '../../store/selectors';
```

(b) Destructure the action (next to `setSelectedShapeKeyframeCorrespondence`):

```ts
    setSelectedNodeEasing,
  } = useEditor.getState();
```

(c) After `obj` is resolved (and near the other `kf*` lets), compute the context. `selectedNodeIndex` and `time` are already subscribed in this component:

```ts
  let nodeEasingCtx: { index: number; value: Easing; inert: boolean } | null = null;
  {
    const edited = selectEditedShapeKeyframe(useEditor.getState());
    if (
      selectedNodeIndex != null &&
      edited &&
      selectedNodeIndex < edited.kf.path.nodes.length &&
      (edited.kf.morph ?? 'corresponded') === 'corresponded'
    ) {
      const isLast = !!obj.shapeTrack && edited.index === obj.shapeTrack.length - 1;
      nodeEasingCtx = {
        index: selectedNodeIndex,
        value: edited.kf.nodeEasings?.[selectedNodeIndex] ?? edited.kf.easing,
        inert: isLast,
      };
    }
  }
```

The `useEditor.getState()` read is reactive here because the component already subscribes to
`time`, `selectedNodeIndex`, and `history.present` (via `selectSelectedObject`) — this
selector's only inputs.

- [ ] **Step 4: Render the section**

In the Keyframe area of the JSX, after the `{kfEasing !== null && ( … )}` block (the Feature 1 keyframe section), add:

```tsx
      {nodeEasingCtx && (
        <>
          <div className={styles.group}>Node easing</div>
          <div className={styles.row}>node {nodeEasingCtx.index} — overrides keyframe easing</div>
          <EasingEditor value={nodeEasingCtx.value} onChange={setSelectedNodeEasing} inert={nodeEasingCtx.inert} />
          <div className={styles.row}>
            <button type="button" onClick={() => setSelectedNodeEasing(undefined)}>
              reset to keyframe default
            </button>
          </div>
        </>
      )}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/ui/components/Inspector/Inspector.test.tsx && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ui/components/Inspector/Inspector.tsx src/ui/components/Inspector/Inspector.test.tsx
git commit -m "feat(inspector): Node easing section (per-node override, reset, corresponded-only)"
```

---

## Task B5: Stage custom-easing marker + e2e

**Files:**
- Modify: `src/ui/components/Stage/Stage.tsx`
- Test: `src/ui/components/Stage/Stage.test.tsx`
- Create: `e2e/per-node-easing.spec.ts`

**Interfaces:**
- Consumes: `selectEditedShapeKeyframe`.

- [ ] **Step 1: Write the failing marker test**

Add to `src/ui/components/Stage/Stage.test.tsx`:

```ts
it('marks nodes that carry a custom easing in the node overlay', () => {
  const s = useEditor.getState();
  s.newProject();
  s.addVectorPath({ nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }], closed: false });
  s.addShapeKeyframe();
  s.seek(0);
  useEditor.getState().selectNode(1);
  useEditor.getState().setSelectedNodeEasing('easeIn'); // node 1 customized
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  expect(screen.getByTestId('node-easing-marker-1')).toBeInTheDocument();
  expect(screen.queryByTestId('node-easing-marker-0')).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx`
Expected: FAIL — no marker.

- [ ] **Step 3: Render the marker**

In `src/ui/components/Stage/Stage.tsx`, add the selector import (next to the others):

```ts
import { selectEditablePath, selectEditedShapeKeyframe } from '../../store/selectors';
```

Compute the edited keyframe's node easings near the `selectedPath` block:

```ts
  const editedNodeEasings = selectEditedShapeKeyframe(useEditor.getState())?.kf.nodeEasings;
```

In the `node-overlay` group, inside the per-node `<g key={i}>` (alongside the existing node `<rect>`), add the marker:

```tsx
                  {editedNodeEasings?.[i] != null && (
                    <circle
                      data-testid={`node-easing-marker-${i}`}
                      cx={n.anchor.x}
                      cy={n.anchor.y}
                      r={7 / zoom}
                      fill="none"
                      stroke="var(--color-accent)"
                      strokeWidth={1 / zoom}
                      pointerEvents="none"
                    />
                  )}
```

(`i` and `n` are the existing map variables in the node-overlay render.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Write the e2e**

Create `e2e/per-node-easing.spec.ts`, modeled on `e2e/morph-resampled.spec.ts` (copy its app-boot, pen-draw, two-shape-keyframe, and export-bundle helpers verbatim; only the per-node steps below are new):

```ts
import { test, expect } from '@playwright/test';
import { unzipSync } from 'fflate';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

test('per-node easing: one node eases differently and the exported morph reflects it', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Author a path and two shape keyframes (same flow as the morph e2e).
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.click(box.x + 80, box.y + 80);
  await page.mouse.click(box.x + 180, box.y + 120);
  await page.mouse.dblclick(box.x + 240, box.y + 80);
  await expect(page.locator('section[aria-label="Stage"] [data-savig-object]')).toHaveCount(1);
  await page.getByRole('button', { name: /add shape keyframe/i }).click();
  await page.getByTestId('timeline-ruler').click({ position: { x: 120, y: 10 } });
  const node = page.getByTestId('node-1');
  const nb = (await node.boundingBox())!;
  await page.mouse.move(nb.x + nb.width / 2, nb.y + nb.height / 2);
  await page.mouse.down();
  await page.mouse.move(nb.x + 60, nb.y + 60);
  await page.mouse.up();
  await expect(page.getByText(/morph: 2 keyframe/i)).toBeVisible();

  // Go to the first keyframe, select node 0, set its easing to easeIn.
  await page.getByTestId('timeline-ruler').click({ position: { x: 0, y: 10 } });
  await page.getByTestId('node-0').click();
  await expect(page.getByText(/node 0 — overrides keyframe easing/)).toBeVisible();
  await page.getByRole('button', { name: 'easeIn' }).click();
  await expect(page.getByTestId('node-easing-marker-0')).toBeVisible();

  // Export and confirm the exported morph animates (the per-node-eased transition).
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream as NodeJS.ReadableStream) chunks.push(c as Buffer);
  const dir = mkdtempSync(join(tmpdir(), 'savig-e2e-'));
  const files = unzipSync(new Uint8Array(Buffer.concat(chunks)));
  for (const [p, data] of Object.entries(files)) {
    const full = join(dir, p);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, data);
  }
  const exported = await page.context().newPage();
  await exported.goto(pathToFileURL(join(dir, 'index.html')).href);
  const pathLoc = exported.locator('[data-savig-object] path').first();
  await expect(pathLoc).toHaveCount(1);
  const d0 = await pathLoc.getAttribute('d');
  let changed = false;
  for (let i = 0; i < 6; i++) {
    await exported.waitForTimeout(120);
    if ((await pathLoc.getAttribute('d')) !== d0) changed = true;
  }
  expect(changed).toBe(true);
});
```

(If the pen-finish double-click yields a different node count, adjust which `node-N` is selected; the assertion that matters is the Node-easing section appears, the marker shows, and the export animates. Reuse the morph spec's exact selectors.)

- [ ] **Step 6: Run the e2e**

Run: `pnpm exec playwright test e2e/per-node-easing.spec.ts`
Expected: PASS (real chromium).

- [ ] **Step 7: Final full gate**

Run: `pnpm vitest run && pnpm typecheck && pnpm lint && pnpm build && pnpm exec playwright test`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add src/ui/components/Stage/Stage.tsx src/ui/components/Stage/Stage.test.tsx e2e/per-node-easing.spec.ts
git commit -m "feat(stage): custom-easing node marker; e2e per-node easing authored + exported"
```

---

## Plan B — Self-review checklist

- One undo step per gesture? ✓ `setSelectedNodeEasing`, `insertNode`, `deleteSelectedNode` each = one `commit`; tests assert `past.length + 1` where relevant.
- Path edits preserve keyframe fields (no wipe)? ✓ B2 asserts easing/morph survive a move; full suite re-run.
- `nodeEasings` aligned across insert/delete? ✓ B2 splice tests.
- Targets the playhead keyframe, not `selectedShapeKeyframe`? ✓ `selectEditedShapeKeyframe`; B3 off-keyframe no-op test.
- Corresponded-only + reset? ✓ B4 hidden-under-resampled + reset tests.
- Discoverability marker? ✓ B5 marker test + e2e.
- Engine untouched in Plan B? ✓ all changes under `src/ui/` and `e2e/`.
