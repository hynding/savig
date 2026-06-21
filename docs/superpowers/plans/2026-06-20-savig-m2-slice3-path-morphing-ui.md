# M2 Slice 3 — Path Morphing: UI Implementation Plan (Plan B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make path-shape morphing *authorable* — node edits route to per-playhead shape keyframes once a path is being morphed, with explicit add/remove shape-keyframe controls, a timeline shape lane, and a Playwright morph-parity e2e.

**Architecture:** Plan A added the engine (`shapeTrack`, `samplePath`, runtime `pathD`). Plan B wires the editor: a `selectEditablePath` selector returns the shape being edited at the playhead (sampled when a `shapeTrack` exists, else the base `asset.path`); `setPathData` routes commits to a keyframe **iff a `shapeTrack` already exists** (else writes the base — Slice 2 unchanged); `addShapeKeyframe` is the explicit opt-in that creates the track. A separate `selectedShapeKeyframe` field drives timeline selection + context-aware Delete.

**Tech Stack:** React 18 + TS (strict), Zustand, Vitest + RTL, Playwright. CSS Modules.

**Spec:** `docs/superpowers/specs/2026-06-20-savig-m2-slice3-path-morphing-design.md` (§5)

**Depends on:** Plan A (merged into this branch): `samplePath`, `upsertShapeKeyframe`, `removeShapeKeyframeAt`, `SceneObject.shapeTrack`, `RenderState.path`, runtime `pathD`.

## Global Constraints

- TypeScript strict; no `any`; `noUnusedLocals`/`noUnusedParameters` are on — don't leave unused imports/vars.
- Node-edit commits run OUTSIDE React setState updaters (via refs) — side effects inside updaters re-run under StrictMode and spawn duplicates. [Slice 2 gotcha; already handled in `usePathTools`.]
- Pure path math stays in `pathEdit.ts`/`pathHitTest.ts`; the store owns commits; the Stage owns ephemeral interaction.
- **Routing rule (spec §5.1):** node-edit commits go to a shape keyframe at `snapToFrame(time, fps)` **iff `obj.shapeTrack?.length`**, else to `asset.path`. Do NOT gate on `autoKey`.
- New shape keyframes default to `easing: 'linear'` (no easing editor this slice).
- TDD: failing test → watch fail → minimal impl → watch pass → commit. `pnpm test` + `pnpm typecheck` before each commit; `pnpm lint` + `pnpm build` + `pnpm e2e` at the end.

---

### Task 1: `selectEditablePath` selector

**Files:**
- Modify: `src/ui/store/selectors.ts`
- Test: `src/ui/store/store.test.ts` (exercise via the live store)

**Interfaces:**
- Consumes: `samplePath`, `snapToFrame` (engine), `EditorState` (store, type-only), `PathData`.
- Produces: `selectEditablePath(s: EditorState): PathData | null` — the path being edited at the snapped playhead: the sampled shape when `obj.shapeTrack?.length`, else `asset.path`, else `null`.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/store/store.test.ts` (it already imports `useEditor`):

```ts
import { selectEditablePath } from './selectors';

describe('selectEditablePath', () => {
  it('returns the asset base when there is no shape track', () => {
    useEditor.getState().newProject();
    useEditor.getState().addVectorPath({
      nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }],
      closed: false,
    });
    const path = selectEditablePath(useEditor.getState());
    expect(path?.nodes).toHaveLength(2);
    expect(path?.nodes[1].anchor.x).toBe(10);
  });

  it('returns the sampled shape when a shape track exists', () => {
    useEditor.getState().newProject();
    useEditor.getState().addVectorPath({
      nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }],
      closed: false,
    });
    const objId = useEditor.getState().selectedObjectId!;
    const project = useEditor.getState().history.present;
    const obj = project.objects.find((o) => o.id === objId)!;
    // hand-build a 2-keyframe morph: node 1 x goes 10 -> 30 over [0,2]
    const k0 = { time: 0, easing: 'linear' as const, path: { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }] } };
    const k2 = { time: 2, easing: 'linear' as const, path: { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 30, y: 0 } }] } };
    useEditor.getState().commit({ ...project, objects: project.objects.map((o) => (o.id === obj.id ? { ...obj, shapeTrack: [k0, k2] } : o)) });
    useEditor.getState().seek(1);
    expect(selectEditablePath(useEditor.getState())?.nodes[1].anchor.x).toBe(20);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test src/ui/store/store.test.ts`
Expected: FAIL — `selectEditablePath` not exported.

- [ ] **Step 3: Implement**

In `src/ui/store/selectors.ts`:

```ts
import { computeProjectDuration, samplePath, snapToFrame } from '../../engine';
import type { PathData, Project, SceneObject } from '../../engine';
import type { EditorState } from './store';

export const selectProject = (s: EditorState): Project => s.history.present;

export const selectDuration = (s: EditorState): number =>
  computeProjectDuration(s.history.present);

export const selectSelectedObject = (s: EditorState): SceneObject | null =>
  s.history.present.objects.find((o) => o.id === s.selectedObjectId) ?? null;

// The path currently being edited at the playhead: the sampled morph shape when
// the object has a shapeTrack, else the static base (asset.path). Used by the
// store's node-edit actions and the Stage node overlay.
export function selectEditablePath(s: EditorState): PathData | null {
  const project = s.history.present;
  const obj = project.objects.find((o) => o.id === s.selectedObjectId);
  if (!obj) return null;
  const asset = project.assets.find((a) => a.id === obj.assetId);
  if (!asset || asset.kind !== 'vector' || asset.shapeType !== 'path') return null;
  if (obj.shapeTrack && obj.shapeTrack.length > 0) {
    return samplePath(obj.shapeTrack, snapToFrame(s.time, project.meta.fps));
  }
  return asset.path ?? null;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test src/ui/store/store.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/store/selectors.ts src/ui/store/store.test.ts
git commit -m "feat(store): selectEditablePath — sampled shape at playhead or base

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Store morph actions + `setPathData` routing + shape-keyframe selection

**Files:**
- Modify: `src/ui/store/store.ts`
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Consumes: `samplePath`, `upsertShapeKeyframe`, `removeShapeKeyframeAt`, `snapToFrame` (engine), `selectEditablePath` is NOT used here (this task only routes `setPathData`; node-edit actions move to Task 3).
- Produces (store):
  - `selectedShapeKeyframe: ShapeKeyframeRef | null` where `interface ShapeKeyframeRef { objectId: string; time: number }`
  - `selectShapeKeyframe(ref: ShapeKeyframeRef | null): void`
  - `addShapeKeyframe(): void`, `removeShapeKeyframe(): void`
  - `setPathData(path)` now routes to a keyframe iff `obj.shapeTrack?.length`, else base
  - `selectKeyframe` / `selectObject` clear `selectedShapeKeyframe`; `selectShapeKeyframe` clears `selectedKeyframe`

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/store/store.test.ts`:

```ts
function newPath2() {
  useEditor.getState().newProject();
  useEditor.getState().addVectorPath({
    nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }],
    closed: false,
  });
}
function selectedObj() {
  const s = useEditor.getState();
  return s.history.present.objects.find((o) => o.id === s.selectedObjectId)!;
}

describe('shape keyframe store actions', () => {
  it('setPathData writes the base when there is no shape track', () => {
    newPath2();
    useEditor.getState().setPathData({ closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 99, y: 0 } }] });
    const obj = selectedObj();
    const asset = useEditor.getState().history.present.assets.find((a) => a.id === obj.assetId)!;
    expect(obj.shapeTrack).toBeFalsy();
    expect(asset.kind === 'vector' && asset.path!.nodes[1].anchor.x).toBe(99);
  });

  it('addShapeKeyframe creates a track seeded from the base, then setPathData keys at the playhead', () => {
    newPath2();
    useEditor.getState().addShapeKeyframe();         // t=0, from base
    expect(selectedObj().shapeTrack).toHaveLength(1);
    useEditor.getState().seek(1);
    useEditor.getState().setPathData({ closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 50, y: 0 } }] });
    const obj = selectedObj();
    expect(obj.shapeTrack).toHaveLength(2);
    expect(obj.shapeTrack!.map((k) => k.time)).toEqual([0, 1]);
    // base untouched
    const asset = useEditor.getState().history.present.assets.find((a) => a.id === obj.assetId)!;
    expect(asset.kind === 'vector' && asset.path!.nodes[1].anchor.x).toBe(10);
  });

  it('removeShapeKeyframe of the last keyframe writes it back to the base and drops the track', () => {
    newPath2();
    useEditor.getState().addShapeKeyframe();
    // mutate the single keyframe so it differs from the base
    useEditor.getState().setPathData({ closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 77, y: 0 } }] });
    useEditor.getState().removeShapeKeyframe();      // removes at t=0 (the only kf)
    const obj = selectedObj();
    expect(obj.shapeTrack).toBeFalsy();
    const asset = useEditor.getState().history.present.assets.find((a) => a.id === obj.assetId)!;
    expect(asset.kind === 'vector' && asset.path!.nodes[1].anchor.x).toBe(77);
  });

  it('selectShapeKeyframe and selectKeyframe clear each other', () => {
    newPath2();
    useEditor.getState().selectShapeKeyframe({ objectId: selectedObj().id, time: 0 });
    expect(useEditor.getState().selectedShapeKeyframe).not.toBeNull();
    useEditor.getState().selectKeyframe({ objectId: selectedObj().id, property: 'x', time: 0 });
    expect(useEditor.getState().selectedShapeKeyframe).toBeNull();
    useEditor.getState().selectShapeKeyframe({ objectId: selectedObj().id, time: 0 });
    expect(useEditor.getState().selectedKeyframe).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test src/ui/store/store.test.ts`
Expected: FAIL — `addShapeKeyframe`/`removeShapeKeyframe`/`selectShapeKeyframe`/`selectedShapeKeyframe` undefined.

- [ ] **Step 3: Implement**

In `src/ui/store/store.ts`:

Add engine imports (extend the existing import list):
```ts
import {
  // ...existing...
  samplePath,
  upsertShapeKeyframe,
  removeShapeKeyframeAt,
} from '../../engine';
```

Add the ref type near `KeyframeRef`:
```ts
export interface ShapeKeyframeRef {
  objectId: string;
  time: number;
}
```

Add to `EditorState`:
```ts
  selectedShapeKeyframe: ShapeKeyframeRef | null;
```
and to the action list:
```ts
  selectShapeKeyframe(ref: ShapeKeyframeRef | null): void;
  addShapeKeyframe(): void;
  removeShapeKeyframe(): void;
```

Add to `TRANSIENT_DEFAULTS`:
```ts
  selectedShapeKeyframe: null as ShapeKeyframeRef | null,
```

Add a context helper next to `currentPathAsset`:
```ts
function selectedPathCtx(get: () => EditorState): { obj: SceneObject; asset: VectorAsset } | null {
  const s = get();
  const project = s.history.present;
  const obj = project.objects.find((o) => o.id === s.selectedObjectId);
  if (!obj) return null;
  const asset = project.assets.find((a) => a.id === obj.assetId);
  if (!asset || asset.kind !== 'vector' || asset.shapeType !== 'path') return null;
  return { obj, asset };
}
```

Replace `setPathData` with the routing version:
```ts
  setPathData(path) {
    const s = get();
    const project = s.history.present;
    const ctx = selectedPathCtx(get);
    if (!ctx) return;
    const { obj, asset } = ctx;
    if (obj.shapeTrack && obj.shapeTrack.length > 0) {
      const time = snapToFrame(s.time, project.meta.fps);
      const shapeTrack = upsertShapeKeyframe(obj.shapeTrack, { time, path, easing: 'linear' });
      get().commit(replaceObject(project, { ...obj, shapeTrack }));
    } else {
      const next = { ...asset, path };
      get().commit({ ...project, assets: project.assets.map((a) => (a.id === asset.id ? next : a)) });
    }
  },
```

Add the new actions (place near the node-edit actions):
```ts
  addShapeKeyframe() {
    const s = get();
    const project = s.history.present;
    const ctx = selectedPathCtx(get);
    if (!ctx) return;
    const { obj, asset } = ctx;
    const time = snapToFrame(s.time, project.meta.fps);
    const current =
      obj.shapeTrack && obj.shapeTrack.length > 0
        ? samplePath(obj.shapeTrack, time)
        : asset.path ?? { nodes: [], closed: false };
    const shapeTrack = upsertShapeKeyframe(obj.shapeTrack ?? [], { time, path: current, easing: 'linear' });
    get().commit(replaceObject(project, { ...obj, shapeTrack }));
  },
  removeShapeKeyframe() {
    const s = get();
    const project = s.history.present;
    const ctx = selectedPathCtx(get);
    if (!ctx || !ctx.obj.shapeTrack || ctx.obj.shapeTrack.length === 0) return;
    const { obj, asset } = ctx;
    const time =
      s.selectedShapeKeyframe && s.selectedShapeKeyframe.objectId === obj.id
        ? s.selectedShapeKeyframe.time
        : snapToFrame(s.time, project.meta.fps);
    const remaining = removeShapeKeyframeAt(obj.shapeTrack, time);
    if (remaining.length === obj.shapeTrack.length) return; // nothing at that time
    if (remaining.length === 0) {
      // Write the currently-shown shape back into the base so it does not jump.
      const snapshot = samplePath(obj.shapeTrack, time);
      const nextAsset = { ...asset, path: snapshot };
      get().commit({
        ...project,
        assets: project.assets.map((a) => (a.id === asset.id ? nextAsset : a)),
        objects: project.objects.map((o) => (o.id === obj.id ? { ...obj, shapeTrack: undefined } : o)),
      });
    } else {
      get().commit(replaceObject(project, { ...obj, shapeTrack: remaining }));
    }
    set({ selectedShapeKeyframe: null });
  },
  selectShapeKeyframe(ref) {
    set({ selectedShapeKeyframe: ref, selectedKeyframe: null });
  },
```

Update `selectKeyframe` and `selectObject` to clear the shape selection:
```ts
  selectKeyframe(ref) {
    set({ selectedKeyframe: ref, selectedShapeKeyframe: null });
  },
```
```ts
  selectObject(id) {
    set({ selectedObjectId: id, selectedKeyframe: null, selectedShapeKeyframe: null, selectedNodeIndex: null });
  },
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test src/ui/store/store.test.ts && pnpm typecheck`
Expected: PASS. Existing node-edit tests still pass (no `shapeTrack` ⇒ base path, unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(store): shape-keyframe actions + track-existence setPathData routing

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Node-edit actions edit the sampled shape while morphing

**Files:**
- Modify: `src/ui/store/store.ts`
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Consumes: `selectEditablePath` (Task 1), the pure `deleteNodeAt`/`toggleSmooth`/`joinHandle` already imported.
- Produces: `deleteSelectedNode` / `toggleSelectedNodeSmooth` / `joinSelectedNode` read the **editable** path (sampled when morphing) and commit via the routed `setPathData`.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/store/store.test.ts`:

```ts
describe('node edits while morphing key the playhead, not the base', () => {
  it('deleteSelectedNode upserts a shape keyframe and leaves the base intact', () => {
    useEditor.getState().newProject();
    useEditor.getState().addVectorPath({
      nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 20, y: 0 } }],
      closed: false,
    });
    useEditor.getState().addShapeKeyframe();   // opt into morphing (track at t=0)
    useEditor.getState().seek(1);
    useEditor.getState().selectNode(1);
    useEditor.getState().deleteSelectedNode();
    const s = useEditor.getState();
    const obj = s.history.present.objects.find((o) => o.id === s.selectedObjectId)!;
    const asset = s.history.present.assets.find((a) => a.id === obj.assetId)!;
    // keyframe at t=1 has 2 nodes; the base still has 3
    const kf = obj.shapeTrack!.find((k) => k.time === 1)!;
    expect(kf.path.nodes).toHaveLength(2);
    expect(asset.kind === 'vector' && asset.path!.nodes).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test src/ui/store/store.test.ts`
Expected: FAIL — `deleteSelectedNode` reads `asset.path` (3 nodes) so it keys 2 nodes at t=1 only if it read the sampled path; currently it deletes from the base shape via `currentPathAsset`, producing the wrong keyframe contents / mutating differently. (The base-length assertion or kf-length assertion fails.)

- [ ] **Step 3: Implement**

In `src/ui/store/store.ts`, import the selector:
```ts
import { selectEditablePath } from './selectors';
```

Rewrite the three node-edit actions to read the editable path:
```ts
  deleteSelectedNode() {
    const s = get();
    if (s.selectedNodeIndex == null) return;
    const path = selectEditablePath(s);
    if (!path) return;
    s.setPathData(deleteNodeAt(path, s.selectedNodeIndex));
    set({ selectedNodeIndex: null });
  },
  toggleSelectedNodeSmooth() {
    const s = get();
    if (s.selectedNodeIndex == null) return;
    const path = selectEditablePath(s);
    if (!path) return;
    s.setPathData(toggleSmooth(path, s.selectedNodeIndex));
  },
  joinSelectedNode() {
    const s = get();
    if (s.selectedNodeIndex == null) return;
    const path = selectEditablePath(s);
    if (!path) return;
    s.setPathData(joinHandle(path, s.selectedNodeIndex));
  },
```

Remove the now-unused `currentPathAsset` helper (its only callers were these three actions). Verify with a grep that nothing else references it.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test src/ui/store/store.test.ts && pnpm typecheck`
Expected: PASS (incl. the existing Slice 2 `deleteSelectedNode` test, which has no `shapeTrack` so still edits the base 3→2).

- [ ] **Step 5: Commit**

```bash
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(store): node-edit actions edit the sampled shape while morphing

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Timeline shape-keyframe lane

**Files:**
- Modify: `src/ui/components/Timeline/Timeline.tsx`
- Modify: `src/ui/components/Timeline/Timeline.module.css` (add a `.shapeDiamond` accent)
- Test: `src/ui/components/Timeline/Timeline.test.tsx`

**Interfaces:**
- Consumes: `obj.shapeTrack`, `selectedShapeKeyframe`, `selectShapeKeyframe` (Task 2).
- Produces: a per-object `shape-keyframe-{objId}-{time}` diamond, selectable into `selectedShapeKeyframe`.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/components/Timeline/Timeline.test.tsx` (reuse its render + store-seeding helpers; build a path object with a 2-keyframe `shapeTrack`):

```ts
it('renders shape-keyframe diamonds and selects them', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorPath({
    nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }],
    closed: false,
  });
  useEditor.getState().addShapeKeyframe();
  useEditor.getState().seek(1);
  useEditor.getState().setPathData({ closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 40, y: 0 } }] });
  const id = useEditor.getState().selectedObjectId!;
  render(<Timeline />);
  const diamond = screen.getByTestId(`shape-keyframe-${id}-1`);
  expect(diamond).toBeInTheDocument();
  fireEvent.pointerDown(diamond);
  expect(useEditor.getState().selectedShapeKeyframe).toEqual({ objectId: id, time: 1 });
});
```

(If `Timeline.test.tsx` doesn't already import `render`, `screen`, `fireEvent`, add them from `@testing-library/react`.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test src/ui/components/Timeline/Timeline.test.tsx`
Expected: FAIL — no `shape-keyframe-…` testid.

- [ ] **Step 3: Implement**

In `Timeline.tsx`, add store reads (next to the existing ones):
```ts
  const selectedShapeKeyframe = useEditor((s) => s.selectedShapeKeyframe);
```
and pull `selectShapeKeyframe` from the destructured `useEditor.getState()` call:
```ts
  const { seek, selectObject, selectKeyframe, selectShapeKeyframe, toggleAutoKey } = useEditor.getState();
```

Inside the per-object `<div className={styles.lane}>`, after the existing scalar-diamond `flatMap(...)`, add the shape diamonds:
```tsx
                {(obj.shapeTrack ?? []).map((kf) => {
                  const isSel =
                    selectedShapeKeyframe?.objectId === obj.id && selectedShapeKeyframe.time === kf.time;
                  return (
                    <div
                      key={`shape-${kf.time}`}
                      className={`${styles.diamond} ${styles.shapeDiamond} ${isSel ? styles.diamondSelected : ''}`}
                      data-testid={`shape-keyframe-${obj.id}-${kf.time}`}
                      style={{ left: `${timeToX(kf.time)}px` }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        selectShapeKeyframe({ objectId: obj.id, time: kf.time });
                      }}
                    />
                  );
                })}
```

In `Timeline.module.css`, add a distinguishing accent (different hue so shape keyframes read as a separate lane):
```css
.shapeDiamond {
  background: var(--color-accent-2, #c084fc);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test src/ui/components/Timeline/Timeline.test.tsx && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/Timeline/Timeline.tsx src/ui/components/Timeline/Timeline.module.css src/ui/components/Timeline/Timeline.test.tsx
git commit -m "feat(timeline): shape-keyframe diamonds, selectable into selectedShapeKeyframe

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Inspector add/remove shape keyframe + context-aware Delete

**Files:**
- Modify: `src/ui/components/Inspector/Inspector.tsx`
- Modify: `src/ui/hooks/useKeyboard.ts`
- Test: `src/ui/components/Inspector/Inspector.test.tsx`, `src/ui/hooks/useKeyboard.test.ts` (or wherever keyboard is tested — see Step 2)

**Interfaces:**
- Consumes: `addShapeKeyframe`, `removeShapeKeyframe`, `selectedShapeKeyframe` (Task 2).
- Produces: Inspector buttons in the Path group; `Delete` priority node → shape keyframe → scalar keyframe.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/components/Inspector/Inspector.test.tsx` (mirror its existing setup that selects a path object):

```ts
it('adds and removes a shape keyframe from the Path group', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorPath({
    nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }],
    closed: false,
  });
  render(<Inspector />);
  fireEvent.click(screen.getByRole('button', { name: /add shape keyframe/i }));
  const objId = useEditor.getState().selectedObjectId!;
  expect(useEditor.getState().history.present.objects.find((o) => o.id === objId)!.shapeTrack).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: /remove shape keyframe/i }));
  expect(useEditor.getState().history.present.objects.find((o) => o.id === objId)!.shapeTrack).toBeFalsy();
});
```

For the keyboard priority, append to the keyboard test file (find it: `ls src/ui/hooks` — the hook is `useKeyboard.ts`; its test, if present, is `useKeyboard.test.ts`/`.tsx`. If none exists, create `src/ui/hooks/useKeyboard.test.tsx` that renders a component calling `useKeyboard()` and dispatches a `keydown`):

```ts
it('Delete removes the selected shape keyframe before a scalar keyframe', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorPath({
    nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }],
    closed: false,
  });
  useEditor.getState().addShapeKeyframe();
  const id = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectShapeKeyframe({ objectId: id, time: 0 });
  renderHook(() => useKeyboard());     // or render a host component that calls it
  fireEvent.keyDown(window, { key: 'Delete' });
  expect(useEditor.getState().history.present.objects.find((o) => o.id === id)!.shapeTrack).toBeFalsy();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test src/ui/components/Inspector/Inspector.test.tsx`
Expected: FAIL — no "Add shape keyframe" button.

- [ ] **Step 3: Implement**

In `Inspector.tsx`, pull the actions:
```ts
  const { setProperty, setAnchor, setVectorStyle, toggleSelectedNodeSmooth, joinSelectedNode, breakSelectedNode, deleteSelectedNode, addShapeKeyframe, removeShapeKeyframe } = useEditor.getState();
```

In the path block (`vector.shapeType === 'path'`), under the node-count row, add:
```tsx
          <div className={styles.row}>
            <button onClick={() => addShapeKeyframe()}>Add shape keyframe</button>
            <button onClick={() => removeShapeKeyframe()} disabled={!(obj.shapeTrack && obj.shapeTrack.length > 0)}>
              Remove shape keyframe
            </button>
          </div>
          {obj.shapeTrack && obj.shapeTrack.length > 0 && (
            <div className={styles.row}>morph: {obj.shapeTrack.length} keyframe(s)</div>
          )}
```

In `useKeyboard.ts`, update the Delete/Backspace case:
```ts
        case 'Delete':
        case 'Backspace':
          if (s.activeTool === 'node' && s.selectedNodeIndex != null) s.deleteSelectedNode();
          else if (s.selectedShapeKeyframe) s.removeShapeKeyframe();
          else s.removeSelectedKeyframe();
          break;
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test src/ui/components/Inspector src/ui/hooks && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/Inspector/Inspector.tsx src/ui/components/Inspector/Inspector.test.tsx src/ui/hooks/useKeyboard.ts src/ui/hooks/useKeyboard.test.tsx
git commit -m "feat(inspector): add/remove shape keyframe + context-aware Delete priority

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

(Adjust the `git add` paths to the actual keyboard test file you created/modified.)

---

### Task 6: Stage node overlay + render use the sampled editable path

**Files:**
- Modify: `src/ui/components/Stage/Stage.tsx`
- Modify: `src/ui/components/Stage/usePathTools.ts`
- Test: `src/ui/components/Stage/Stage.test.tsx`

**Interfaces:**
- Consumes: `selectEditablePath` / `samplePath` / `snapToFrame`.
- Produces: while the node tool is active on a morphed path, the node overlay (and segment hit-testing source) is the **sampled** shape; the inline `<path d>` for a morphed path renders the sampled frame-0 shape (then `applyFrame` animates it).

- [ ] **Step 1: Write the failing test**

Append to `src/ui/components/Stage/Stage.test.tsx` (reuse its render harness; it already mounts `<Stage nodes=… />` with a store). Build a morphed path, activate the node tool, and assert the overlay shows the sampled node position at the playhead:

```ts
it('node overlay reflects the sampled shape while morphing', () => {
  useEditor.getState().newProject();
  useEditor.getState().addVectorPath({
    nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }],
    closed: false,
  });
  useEditor.getState().addShapeKeyframe();           // t=0 from base (node1 x=10)
  useEditor.getState().seek(2);
  useEditor.getState().setPathData({ closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 30, y: 0 } }] }); // t=2 node1 x=30
  useEditor.getState().seek(1);                      // midpoint -> node1 x should sample to 20
  useEditor.getState().setActiveTool('node');
  renderStage();                                     // the file's existing Stage-mount helper
  const node1 = screen.getByTestId('node-1');
  expect(Number(node1.getAttribute('x'))).toBeCloseTo(20 - 4, 1); // rect x = anchorX - 4/zoom (zoom=1)
});
```

(Use the test file's existing mount helper name; if it mounts inline, copy that pattern. `node-1`'s `x` attribute is `anchor.x - 4/zoom`; at zoom 1 and sampled anchor.x=20 that is 16.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test src/ui/components/Stage/Stage.test.tsx`
Expected: FAIL — overlay reads `asset.path` (node1 x=10 ⇒ rect x=6), not the sampled 16.

- [ ] **Step 3: Implement**

In `Stage.tsx`, extend the engine import and read fps:
```ts
import { buildTransform, geometryToSvgAttrs, pathBounds, pathToD, resolveAnchor, sampleObject, samplePath, snapToFrame } from '../../../engine';
```
```ts
  const fps = useEditor((s) => s.history.present.meta.fps);
```

Change the `selectedPath` memo to source the editable (sampled) path:
```ts
  const selectedPath = useMemo(() => {
    if (activeTool !== 'node' || !selectedId) return null;
    const obj = project.objects.find((o) => o.id === selectedId);
    const asset = obj ? assetsById.get(obj.assetId) : undefined;
    if (!obj || !asset || asset.kind !== 'vector' || asset.shapeType !== 'path') return null;
    const base =
      obj.shapeTrack && obj.shapeTrack.length > 0
        ? samplePath(obj.shapeTrack, snapToFrame(time, fps))
        : asset.path;
    if (!base) return null;
    const path = pathTools.working ?? base;
    const state = sampleObject(obj, time);
    const anchor = resolveAnchor(obj, state, 'path', pathBounds(path));
    return { obj, path, transform: buildTransform(state, anchor.anchorX, anchor.anchorY) };
  }, [activeTool, selectedId, project.objects, assetsById, time, fps, pathTools.working]);
```

Change the inline path render (the `asset.shapeType === 'path'` branch) so a morphed path renders its sampled frame:
```tsx
                <path
                  d={
                    o.shapeTrack && o.shapeTrack.length > 0
                      ? pathToD(samplePath(o.shapeTrack, snapToFrame(time, fps)))
                      : asset.path
                        ? pathToD(asset.path)
                        : ''
                  }
                  fill={asset.style.fill}
                  ...
```

In `usePathTools.ts`, change `currentPath()` to read the editable path so the node-grab working copy starts from the sampled shape:
```ts
import { samplePath, snapToFrame } from '../../../engine';
```
```ts
function currentPath(): PathData | null {
  const s = useEditor.getState();
  const obj = s.history.present.objects.find((o) => o.id === s.selectedObjectId);
  const asset = obj && s.history.present.assets.find((a) => a.id === obj.assetId);
  if (!obj || !asset || asset.kind !== 'vector' || asset.shapeType !== 'path') return null;
  if (obj.shapeTrack && obj.shapeTrack.length > 0) {
    return samplePath(obj.shapeTrack, snapToFrame(s.time, s.history.present.meta.fps));
  }
  return asset.path ?? null;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm test src/ui/components/Stage/Stage.test.tsx && pnpm typecheck`
Expected: PASS. (Static-path Stage tests still pass: no `shapeTrack` ⇒ `asset.path`.)

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/Stage/Stage.tsx src/ui/components/Stage/usePathTools.ts src/ui/components/Stage/Stage.test.tsx
git commit -m "feat(stage): node overlay + path render use the sampled editable shape

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: e2e — draw, morph, export, assert the exported path animates

**Files:**
- Create: `e2e/morph-path.spec.ts`

**Interfaces:**
- Consumes: the full app (real Chromium). Models `e2e/draw-path.spec.ts` (pen authoring + export + bundle inspection).

- [ ] **Step 1: Write the e2e test**

Create `e2e/morph-path.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { unzipSync } from 'fflate';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

test('draw path -> key shape at two times -> export -> exported path d animates', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  // Author a path (pen): two clicks + double-click to finish; switches to node tool.
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.mouse.click(box.x + 80, box.y + 80);
  await page.mouse.click(box.x + 180, box.y + 120);
  await page.mouse.dblclick(box.x + 240, box.y + 80);
  await expect(page.locator('section[aria-label="Stage"] [data-savig-object]')).toHaveCount(1);

  // Opt into morphing: snapshot the shape at t=0.
  await page.getByRole('button', { name: /add shape keyframe/i }).click();

  // Move the playhead, then drag a node to create a second shape keyframe.
  await page.getByTestId('timeline-ruler').click({ position: { x: 120, y: 10 } });
  const node = page.getByTestId('node-1');
  const nb = (await node.boundingBox())!;
  await page.mouse.move(nb.x + nb.width / 2, nb.y + nb.height / 2);
  await page.mouse.down();
  await page.mouse.move(nb.x + 60, nb.y + 60);
  await page.mouse.up();
  // Two shape keyframes now exist on the object.
  await expect(page.getByText(/morph: 2 keyframe/i)).toBeVisible();

  // Export and capture the bundle.
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export' }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  expect(stream).not.toBeNull();
  const chunks: Buffer[] = [];
  for await (const c of stream as NodeJS.ReadableStream) chunks.push(c as Buffer);
  const zipBytes = new Uint8Array(Buffer.concat(chunks));

  const dir = mkdtempSync(join(tmpdir(), 'savig-e2e-'));
  const files = unzipSync(zipBytes);
  for (const [path, data] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, data);
  }
  expect(Object.keys(files)).toContain('index.html');

  // Open the bundle; the runtime auto-plays, so the inner <path> `d` must change.
  const exported = await page.context().newPage();
  await exported.goto(pathToFileURL(join(dir, 'index.html')).href);
  const path = exported.locator('[data-savig-object] path').first();
  await expect(path).toHaveCount(1);
  const d0 = await path.getAttribute('d');
  await exported.waitForTimeout(500);
  const d1 = await path.getAttribute('d');
  expect(d1).not.toBe(d0);
});
```

- [ ] **Step 2: Run the e2e**

Run: `pnpm e2e morph-path`
Expected: PASS. If the node drag doesn't register (overlay coordinate mismatch), adjust the drag start to the `node-1` bounding-box center and ensure the node tool is active (it is, post-pen). If "morph: 2 keyframe" isn't visible, confirm the playhead actually moved (ruler click x>0) so the second keyframe lands at a different time than t=0.

- [ ] **Step 3: Commit**

```bash
git add e2e/morph-path.spec.ts
git commit -m "test(e2e): draw path -> key shape twice -> export -> exported d animates

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Final verification

- [ ] **Run the whole suite + checks**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build && pnpm e2e`
Expected: all green (unit + e2e). The regenerated runtime bundle from Plan A is already committed; no runtime change in Plan B.

---

## Self-Review

**Spec coverage (§5):**
- §5.1 routing (track-existence) → Tasks 2–3. ✅
- §5.1 `addShapeKeyframe`/`removeShapeKeyframe` (incl. remove-last write-back) → Task 2. ✅
- §5.2 `selectedShapeKeyframe` + clearing + context-aware Delete → Tasks 2, 5. ✅
- §5.3 Timeline shape lane → Task 4. ✅
- §5.4 Inspector add/remove + morph readout (no easing editor) → Task 5. ✅
- §5.5 keyboard Delete priority → Task 5. ✅
- Stage node overlay/render use sampled editable path → Task 6. ✅
- E2E morph parity → Task 7. ✅
- `selectEditablePath` (consumed by store + Stage) → Task 1. ✅

**Placeholder scan:** none — code is concrete. Two spots say "use the file's existing helper" (Inspector/Stage/Timeline test mount patterns + the keyboard test file location); these are deliberate references to existing harnesses the implementer must read, not missing logic. Resolve them by reading the named test file before writing the new case.

**Type consistency:** `ShapeKeyframeRef { objectId; time }`, `selectedShapeKeyframe`, `selectShapeKeyframe`, `addShapeKeyframe`, `removeShapeKeyframe`, `selectEditablePath`, `selectedPathCtx` are used identically across Tasks 1–7. `setPathData` keeps its `(path: PathData) => void` signature (only its body changes), so `usePathTools`/`Stage` callers are unaffected.

**Risk note (Task 6 test):** the `node-1` rect `x` equals `anchor.x - 4/zoom`. At the default zoom (1) and sampled `anchor.x = 20`, that is `16`. If the Stage test harness uses a non-default zoom, compute the expected value from the harness's zoom rather than hard-coding.
