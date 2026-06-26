# Symbol Edit Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Double-click a symbol instance to descend into (edit-in-place) its internal scene — the whole editor (Stage, Timeline, Layers, Inspector) scopes to the symbol's `objects`, select-tool transforms/animation of its parts route to the symbol asset (every instance updates live), a breadcrumb + Esc exit.

**Architecture:** A symbol is a GLOBAL asset, so "the scene being edited" is one flat array — root `project.objects` or one `SymbolAsset.objects`. A transient `editPath: string[]` (symbol-asset ids entered) drives a "focused scene": read helpers (`selectActiveObjects`/`selectEditProject`) point every read surface at the active scene, and `commitActiveScene` writes the active scene back (root or the asset). History snapshots the whole `Project` (incl. assets), so undo/redo/persistence are free. No engine/runtime/export render code changes → preview==export parity untouched.

**Tech Stack:** TypeScript (strict), React, Zustand, Vitest (unit + jsdom component), Playwright (e2e). No new dependencies.

## Global Constraints

- **Preview == export parity is sacred.** Do NOT change `engine/`, `runtime/frame.ts`, or `services/export/`. Edit mode is editor-only view state, never serialized; export always renders the ROOT project.
- **No new dependencies.**
- **`editPath` is transient view state** (like `selectedObjectIds`/`zoom`) — NOT in history; reset by `newProject`.
- **v1 routes ONLY the transform actions** (`setProperties`, `setObjectsTransforms`, `nudgeSelected`) to the active scene. Non-routed selection-dependent actions safely no-op in edit mode (the internal id is absent from root `project.objects`); the create tools are gated by forcing the `select` tool in edit mode. Delete/draw/node/group/boolean/clipboard/Layers-mutators inside a symbol are a deferred follow-up.
- **Reference-stability:** `selectActiveObjects` returns an existing array (root `objects` or the asset's `objects`) — never a fresh array — so Zustand subscriptions don't re-render spuriously. `selectEditProject` returns the *same* `present` object when at root.
- **Missing-asset fallback:** if `editPath`'s last id resolves to no symbol asset (e.g. after an undo deleted it), the active scene falls back to root.
- **Commit cadence:** one commit per task (TDD). At plan end: `npm test`, `npm run typecheck`, `npx eslint src e2e`, `npm run e2e` all green; engine/parity suites unchanged.

---

### Task 1: Edit-path state, scene selectors, enter/exit/commit actions (store + selectors)

The data core: `editPath` state, the three read selectors, and the `enterSymbol`/`exitSymbol`/`exitToDepth`/`commitActiveScene` actions. No UI and no action-routing yet.

**Files:**
- Modify: `src/ui/store/selectors.ts` (add `selectActiveAssetId`, `selectActiveObjects`, `selectEditProject`)
- Modify: `src/ui/store/store.ts` (add `editPath` state + reset; add `enterSymbol`/`exitSymbol`/`exitToDepth`/`commitActiveScene` to the interface + impl)
- Test: `src/ui/store/store.test.ts`, `src/ui/store/selectors.test.ts`

**Interfaces:**
- Produces:
  - `selectActiveAssetId(s: EditorState): string | null`
  - `selectActiveObjects(s: EditorState): SceneObject[]`
  - `selectEditProject(s: EditorState): Project`
  - store state `editPath: string[]`
  - store actions `enterSymbol(assetId: string): void`, `exitSymbol(): void`, `exitToDepth(depth: number): void`, `commitActiveScene(nextObjects: SceneObject[]): void`

- [ ] **Step 1: Write the failing selector tests**

Add to `src/ui/store/selectors.test.ts` (create the file if it doesn't exist; if it exists, append and extend the import). Use the engine factories.

```ts
import { describe, it, expect } from 'vitest';
import { selectActiveAssetId, selectActiveObjects, selectEditProject } from './selectors';
import { createProject, createSceneObject, createSymbolAsset, createVectorAsset } from '../../engine';
import type { EditorState } from './store';

function stateWith(editPath: string[]): EditorState {
  const innerAsset = createVectorAsset('rect', { id: 'inner-asset', shapeType: 'rect' });
  const innerObj = createSceneObject('inner-asset', { id: 'inner', zOrder: 0 });
  const sym = createSymbolAsset({ id: 'sym', objects: [innerObj], width: 10, height: 10 });
  const instance = createSceneObject('sym', { id: 'inst', zOrder: 0 });
  const project = createProject();
  project.assets = [innerAsset, sym];
  project.objects = [instance];
  return { history: { past: [], present: project, future: [] }, editPath } as unknown as EditorState;
}

describe('active-scene selectors (symbol edit mode)', () => {
  it('returns the root scene and null asset id when editPath is empty', () => {
    const s = stateWith([]);
    expect(selectActiveAssetId(s)).toBeNull();
    expect(selectActiveObjects(s).map((o) => o.id)).toEqual(['inst']);
    expect(selectEditProject(s)).toBe(s.history.present); // same ref at root
  });
  it('returns the symbol scene and its asset id when editPath points at a symbol', () => {
    const s = stateWith(['sym']);
    expect(selectActiveAssetId(s)).toBe('sym');
    expect(selectActiveObjects(s).map((o) => o.id)).toEqual(['inner']);
    expect(selectEditProject(s).objects.map((o) => o.id)).toEqual(['inner']);
  });
  it('falls back to root when the active asset is missing', () => {
    const s = stateWith(['gone']);
    expect(selectActiveObjects(s).map((o) => o.id)).toEqual(['inst']);
  });
  it('returns a stable objects reference (no fresh array)', () => {
    const s = stateWith(['sym']);
    expect(selectActiveObjects(s)).toBe((s.history.present.assets.find((a) => a.id === 'sym') as { objects: unknown }).objects);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/store/selectors.test.ts`
Expected: FAIL — `selectActiveAssetId`/`selectActiveObjects`/`selectEditProject` not exported.

- [ ] **Step 3: Implement the selectors**

Append to `src/ui/store/selectors.ts`:

```ts
// --- Symbol edit mode (the "active scene") ---------------------------------------------------
// A symbol is a GLOBAL asset, so the scene being edited is one flat array: the root
// project.objects, or one SymbolAsset.objects. editPath's LAST entry is the write target; earlier
// entries are breadcrumb context. A missing active asset (e.g. after an undo) falls back to root.

export function selectActiveAssetId(s: EditorState): string | null {
  return s.editPath.at(-1) ?? null;
}

export function selectActiveObjects(s: EditorState): SceneObject[] {
  const id = selectActiveAssetId(s);
  if (!id) return s.history.present.objects;
  const a = s.history.present.assets.find((x) => x.id === id);
  return a && a.kind === 'symbol' ? a.objects : s.history.present.objects; // missing-asset fallback
}

// A "focused project" = the real project with objects[] swapped to the active scene (assets/meta
// stay global). Returns the SAME present object at root so subscribers don't re-render spuriously.
export function selectEditProject(s: EditorState): Project {
  const objs = selectActiveObjects(s);
  return objs === s.history.present.objects ? s.history.present : { ...s.history.present, objects: objs };
}
```

- [ ] **Step 4: Run to verify the selector tests pass**

Run: `npx vitest run src/ui/store/selectors.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing store-action tests**

Add to `src/ui/store/store.test.ts` (it already imports `useEditor`; follow its existing setup style — `useEditor.getState().newProject()` etc.). Build a symbol via `createSymbol` or by committing a crafted project.

```ts
import { selectActiveObjects } from './selectors';

it('enterSymbol sets editPath, forces select tool, clears selection (edit mode)', () => {
  const s = useEditor.getState();
  s.newProject();
  const inner = createVectorAsset('rect', { id: 'inner-asset', shapeType: 'rect' });
  const innerObj = createSceneObject('inner-asset', { id: 'inner', zOrder: 0 });
  const sym = createSymbolAsset({ id: 'sym', objects: [innerObj], width: 10, height: 10 });
  const instA = createSceneObject('sym', { id: 'a', zOrder: 0 });
  const instB = createSceneObject('sym', { id: 'b', zOrder: 1 });
  const p = createProject();
  p.assets = [inner, sym];
  p.objects = [instA, instB];
  s.commit(p);
  s.selectObject('a');
  s.setActiveTool('rect');
  s.enterSymbol('sym');
  expect(useEditor.getState().editPath).toEqual(['sym']);
  expect(useEditor.getState().activeTool).toBe('select');
  expect(useEditor.getState().selectedObjectIds).toEqual([]);
  expect(selectActiveObjects(useEditor.getState()).map((o) => o.id)).toEqual(['inner']);
});

it('enterSymbol ignores a non-symbol asset id', () => {
  const s = useEditor.getState();
  s.newProject();
  s.enterSymbol('nope');
  expect(useEditor.getState().editPath).toEqual([]);
});

it('exitSymbol pops one level and clears selection; exitToDepth truncates', () => {
  const s = useEditor.getState();
  s.newProject();
  const inner = createVectorAsset('rect', { id: 'inner-asset', shapeType: 'rect' });
  const sym = createSymbolAsset({ id: 'sym', objects: [createSceneObject('inner-asset', { id: 'inner' })], width: 10, height: 10 });
  const p = createProject();
  p.assets = [inner, sym];
  p.objects = [createSceneObject('sym', { id: 'a' })];
  s.commit(p);
  s.enterSymbol('sym');
  s.exitSymbol();
  expect(useEditor.getState().editPath).toEqual([]);
  s.enterSymbol('sym');
  s.exitToDepth(0);
  expect(useEditor.getState().editPath).toEqual([]);
});

it('commitActiveScene writes back into the symbol asset (and root when not in edit mode)', () => {
  const s = useEditor.getState();
  s.newProject();
  const inner = createVectorAsset('rect', { id: 'inner-asset', shapeType: 'rect' });
  const innerObj = createSceneObject('inner-asset', { id: 'inner', zOrder: 0 });
  const sym = createSymbolAsset({ id: 'sym', objects: [innerObj], width: 10, height: 10 });
  const p = createProject();
  p.assets = [inner, sym];
  p.objects = [createSceneObject('sym', { id: 'a' })];
  s.commit(p);
  s.enterSymbol('sym');
  const renamed = { ...innerObj, name: 'edited' };
  s.commitActiveScene([renamed]);
  const symAfter = useEditor.getState().history.present.assets.find((x) => x.id === 'sym') as { objects: { name: string }[] };
  expect(symAfter.objects[0].name).toBe('edited');
  // root objects untouched
  expect(useEditor.getState().history.present.objects.map((o) => o.id)).toEqual(['a']);
});
```

- [ ] **Step 6: Run to verify failure**

Run: `npx vitest run src/ui/store/store.test.ts -t "edit mode|enterSymbol|exitSymbol|commitActiveScene"`
Expected: FAIL — actions/`editPath` not defined.

- [ ] **Step 7: Implement the store state + actions**

In `src/ui/store/store.ts`:

(a) Import the selector helpers at the top (the file already imports from local modules):
```ts
import { selectActiveAssetId, selectActiveObjects } from './selectors';
```
> If this creates an import cycle warning at build (selectors imports the `EditorState` type from store), it is type-only on the selectors side and safe; Vite/TS resolve it. Verify `npm run typecheck` stays clean in Step 9.

(b) Add to the `EditorState` interface, near `selectedObjectIds`:
```ts
  /** Symbol edit mode (slice 47 edit-mode): the symbol-asset ids entered, outermost-first.
   *  [] = editing the root scene. Transient view state (never in history). */
  editPath: string[];
```
And to the actions section (near `selectObject`):
```ts
  /** Descend into a symbol instance's scene to edit its internals (edit-in-place). */
  enterSymbol(assetId: string): void;
  /** Pop one edit-path level (exit the current symbol). */
  exitSymbol(): void;
  /** Truncate the edit path to `depth` (0 = root); breadcrumb navigation. */
  exitToDepth(depth: number): void;
  /** Commit `nextObjects` to the ACTIVE scene (root project.objects, or the edited symbol asset). */
  commitActiveScene(nextObjects: SceneObject[]): void;
```

(c) Add to the initial-state object (near `selectedObjectIds: []`):
```ts
  editPath: [] as string[],
```
And in `newProject` (find where it resets selection/time) add `editPath: []` to the reset.

(d) Implement the actions (place near `selectObject`):
```ts
  enterSymbol(assetId) {
    const a = get().history.present.assets.find((x) => x.id === assetId);
    if (!a || a.kind !== 'symbol') return; // only symbols are editable scenes
    set({ editPath: [...get().editPath, assetId], activeTool: 'select' });
    get().selectObject(null); // selection ids are scene-local
  },
  exitSymbol() {
    if (get().editPath.length === 0) return;
    set({ editPath: get().editPath.slice(0, -1) });
    get().selectObject(null);
  },
  exitToDepth(depth) {
    if (depth >= get().editPath.length || depth < 0) return;
    set({ editPath: get().editPath.slice(0, depth) });
    get().selectObject(null);
  },
  commitActiveScene(nextObjects) {
    const s = get();
    const id = selectActiveAssetId(s);
    const project = s.history.present;
    if (!id) { get().commit({ ...project, objects: nextObjects }); return; }
    const assets = project.assets.map((a) =>
      a.id === id && a.kind === 'symbol' ? { ...a, objects: nextObjects } : a,
    );
    get().commit({ ...project, assets });
  },
```

- [ ] **Step 8: Run to verify the store tests pass**

Run: `npx vitest run src/ui/store/store.test.ts src/ui/store/selectors.test.ts`
Expected: PASS.

- [ ] **Step 9: Typecheck + commit**

```bash
npm run typecheck
git add src/ui/store/store.ts src/ui/store/selectors.ts src/ui/store/store.test.ts src/ui/store/selectors.test.ts
git commit -m "feat(edit-mode): editPath state + active-scene selectors + enter/exit/commitActiveScene"
```

---

### Task 2: Route the transform actions to the active scene (store)

Make `setProperties`, `nudgeSelected`, and `setObjectsTransforms` write the active scene so that transforming/animating a symbol's internal object mutates the symbol asset — and every instance reflects it (edit-propagation). Root behaviour is unchanged (active scene == root when `editPath` is empty).

**Files:**
- Modify: `src/ui/store/store.ts` (`setProperties`, `nudgeSelected`, `setObjectsTransforms`)
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Consumes: `selectActiveObjects` (Task 1), `commitActiveScene` (Task 1), existing `applyObjectTransform`, `sampleObject`.

- [ ] **Step 1: Write the failing edit-propagation test**

Add to `src/ui/store/store.test.ts`:

```ts
import { sampleObject } from '../../engine';

it('transforming a symbol internal in edit mode mutates the asset and all instances reflect it (edit-propagation)', () => {
  const s = useEditor.getState();
  s.newProject();
  const inner = createVectorAsset('rect', { id: 'inner-asset', shapeType: 'rect' });
  const innerObj = createSceneObject('inner-asset', { id: 'inner', zOrder: 0, base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
  const sym = createSymbolAsset({ id: 'sym', objects: [innerObj], width: 10, height: 10 });
  const p = createProject();
  p.assets = [inner, sym];
  p.objects = [createSceneObject('sym', { id: 'a', zOrder: 0 }), createSceneObject('sym', { id: 'b', zOrder: 1 })];
  s.commit(p);
  s.enterSymbol('sym');
  s.selectObject('inner');
  s.setProperties({ x: 25 }); // autoKey defaults true -> keyframes the internal at the playhead
  const symAfter = useEditor.getState().history.present.assets.find((x) => x.id === 'sym') as { objects: import('../../engine').SceneObject[] };
  expect(sampleObject(symAfter.objects[0], 0).x).toBe(25); // the symbol's internal moved
  // root objects (the two instances) are untouched; both render the moved internal via the shared asset
  expect(useEditor.getState().history.present.objects.map((o) => o.id)).toEqual(['a', 'b']);
});

it('nudgeSelected and setObjectsTransforms in edit mode write the symbol asset', () => {
  const s = useEditor.getState();
  s.newProject();
  const inner = createVectorAsset('rect', { id: 'inner-asset', shapeType: 'rect' });
  const innerObj = createSceneObject('inner-asset', { id: 'inner', zOrder: 0, base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
  const sym = createSymbolAsset({ id: 'sym', objects: [innerObj], width: 10, height: 10 });
  const p = createProject();
  p.assets = [inner, sym];
  p.objects = [createSceneObject('sym', { id: 'a' })];
  s.commit(p);
  s.enterSymbol('sym');
  s.selectObject('inner');
  s.nudgeSelected(5, 0);
  let symA = useEditor.getState().history.present.assets.find((x) => x.id === 'sym') as { objects: import('../../engine').SceneObject[] };
  expect(sampleObject(symA.objects[0], 0).x).toBe(5);
  s.setObjectsTransforms([{ id: 'inner', x: 9 }]);
  symA = useEditor.getState().history.present.assets.find((x) => x.id === 'sym') as { objects: import('../../engine').SceneObject[] };
  expect(sampleObject(symA.objects[0], 0).x).toBe(9);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/store/store.test.ts -t "edit-propagation|edit mode write"`
Expected: FAIL — `setProperties` reads root `project.objects`, doesn't find `inner` (it's in the asset), so the asset is unchanged.

- [ ] **Step 3: Route `setProperties`**

Replace the `setProperties` impl body:
```ts
  setProperties(updates) {
    const s = get();
    const objects = selectActiveObjects(s);
    const obj = objects.find((o) => o.id === s.selectedObjectId);
    if (!obj || obj.locked) return;
    if (!obj.isGroup && !s.autoKey) return; // normal objects edit through keyframes (auto-key); group: base when off (45d)
    const time = snapToFrame(s.time, s.history.present.meta.fps);
    get().commitActiveScene(objects.map((o) => (o.id === obj.id ? applyObjectTransform(obj, updates, time, s.autoKey) : o)));
  },
```

- [ ] **Step 4: Route `nudgeSelected`**

Replace `let objects = project.objects;` with the active scene and the final commit with `commitActiveScene`:
```ts
  nudgeSelected(dx, dy) {
    if (!dx && !dy) return;
    const s = get();
    const time = snapToFrame(s.time, s.history.present.meta.fps);
    let objects = selectActiveObjects(s);
    let changed = false;
    for (const id of s.selectedObjectIds) {
      const obj = objects.find((o) => o.id === id);
      if (!obj || obj.locked) continue;
      if (!obj.isGroup && !s.autoKey) continue;
      const state = sampleObject(obj, time);
      const partial: Partial<Record<AnimatableProperty, number>> = {};
      if (dx) partial.x = state.x + dx;
      if (dy) partial.y = state.y + dy;
      objects = objects.map((o) => (o.id === id ? applyObjectTransform(obj, partial, time, s.autoKey) : o));
      changed = true;
    }
    if (changed) get().commitActiveScene(objects);
  },
```

- [ ] **Step 5: Route `setObjectsTransforms`**

```ts
  setObjectsTransforms(updates) {
    const s = get();
    if (updates.length === 0) return;
    const time = snapToFrame(s.time, s.history.present.meta.fps);
    let objects = selectActiveObjects(s);
    let changed = false;
    for (const u of updates) {
      const obj = objects.find((o) => o.id === u.id);
      if (!obj || obj.locked) continue;
      if (!obj.isGroup && !s.autoKey) continue;
      const partial: Partial<Record<AnimatableProperty, number>> = {};
      if (u.x !== undefined) partial.x = u.x;
      if (u.y !== undefined) partial.y = u.y;
      if (u.scaleX !== undefined) partial.scaleX = u.scaleX;
      if (u.scaleY !== undefined) partial.scaleY = u.scaleY;
      if (u.rotation !== undefined) partial.rotation = u.rotation;
      objects = objects.map((o) => (o.id === u.id ? applyObjectTransform(obj, partial, time, s.autoKey) : o));
      changed = true;
    }
    if (changed) get().commitActiveScene(objects);
  },
```

- [ ] **Step 6: Run the routed-action tests + the whole store suite**

Run: `npx vitest run src/ui/store/store.test.ts`
Expected: PASS (new edit-mode tests green; all existing transform/group tests still green — at root `selectActiveObjects` === `project.objects` and `commitActiveScene` === the old commit).

- [ ] **Step 7: Commit**

```bash
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(edit-mode): route transform actions (setProperties/nudge/setObjectsTransforms) to the active scene"
```

---

### Task 3: Scope the read surfaces to the active scene (selectors + Stage + Timeline + Layers + Inspector)

Point the whole editor at the active scene so entering a symbol shows ONLY its internals everywhere. Root behaviour is unchanged (active == root).

**Files:**
- Modify: `src/ui/store/selectors.ts` (`selectSelectedObject`, `selectEditablePath`, `selectEditedShapeKeyframe`)
- Modify: `src/ui/components/Stage/Stage.tsx`, `src/ui/components/Timeline/Timeline.tsx`, `src/ui/components/LayersPanel/LayersPanel.tsx`, `src/ui/components/Inspector/Inspector.tsx`
- Test: `src/ui/store/selectors.test.ts`, `src/ui/components/Timeline/Timeline.test.tsx`, `src/ui/components/LayersPanel/LayersPanel.test.tsx`

**Interfaces:**
- Consumes: `selectActiveObjects`, `selectEditProject` (Task 1).

- [ ] **Step 1: Write a failing component-scope test (Timeline + Layers)**

Add to `src/ui/components/Timeline/Timeline.test.tsx` (match its existing render/setup style):

```ts
it('shows the active symbol scene tracks in edit mode (slice 47 edit-mode)', () => {
  const s = useEditor.getState();
  s.newProject();
  const inner = createVectorAsset('rect', { id: 'inner-asset', shapeType: 'rect' });
  const innerObj = createSceneObject('inner-asset', { id: 'inner', name: 'inner-row', zOrder: 0 });
  const sym = createSymbolAsset({ id: 'sym', objects: [innerObj], width: 10, height: 10 });
  const p = createProject();
  p.assets = [inner, sym];
  p.objects = [createSceneObject('sym', { id: 'a', name: 'inst-row' })];
  act(() => { s.commit(p); s.enterSymbol('sym'); });
  render(<Timeline />);
  expect(screen.getByText('inner-row')).toBeInTheDocument(); // the symbol's internal track
  expect(screen.queryByText('inst-row')).not.toBeInTheDocument(); // not the root instance
});
```

Add the equivalent to `src/ui/components/LayersPanel/LayersPanel.test.tsx`:

```ts
it('shows the active symbol scene rows in edit mode (slice 47 edit-mode)', () => {
  const s = useEditor.getState();
  s.newProject();
  const inner = createVectorAsset('rect', { id: 'inner-asset', shapeType: 'rect' });
  const innerObj = createSceneObject('inner-asset', { id: 'inner', name: 'inner-layer', zOrder: 0 });
  const sym = createSymbolAsset({ id: 'sym', objects: [innerObj], width: 10, height: 10 });
  const p = createProject();
  p.assets = [inner, sym];
  p.objects = [createSceneObject('sym', { id: 'a', name: 'inst-layer' })];
  act(() => { s.commit(p); s.enterSymbol('sym'); });
  render(<LayersPanel />);
  expect(screen.getByText('inner-layer')).toBeInTheDocument();
  expect(screen.queryByText('inst-layer')).not.toBeInTheDocument();
});
```

> Match each test file's existing imports (`createSymbolAsset`/`createVectorAsset`/`createProject`/`createSceneObject` from `../../../engine`, `act`/`render`/`screen` from the testing libs). Extend the import lines if a factory isn't already imported.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/components/Timeline/Timeline.test.tsx src/ui/components/LayersPanel/LayersPanel.test.tsx -t "edit-mode"`
Expected: FAIL — both still read `s.history.present.objects` (root), so they show the instance row, not the symbol's internal row.

- [ ] **Step 3: Scope the selectors**

In `src/ui/store/selectors.ts`, change the object source of the existing selectors from `s.history.present.objects` to `selectActiveObjects(s)`:

- `selectSelectedObject`:
```ts
export const selectSelectedObject = (s: EditorState): SceneObject | null =>
  selectActiveObjects(s).find((o) => o.id === s.selectedObjectId) ?? null;
```
- `selectEditedShapeKeyframe`: change `const obj = s.history.present.objects.find(...)` to `const obj = selectActiveObjects(s).find((o) => o.id === s.selectedObjectId);`.
- `selectEditablePath`: change `const project = s.history.present;` usage so the object lookup uses the active scene: replace `const obj = project.objects.find((o) => o.id === s.selectedObjectId);` with `const obj = selectActiveObjects(s).find((o) => o.id === s.selectedObjectId);` (keep `const project = s.history.present;` for `project.assets` — assets are global).

(`selectProject` stays as-is; components that must scope use `selectEditProject`.)

- [ ] **Step 4: Scope Timeline, Layers, Inspector**

- `Timeline.tsx` line `const objects = useEditor((s) => s.history.present.objects);` → `const objects = useEditor((s) => selectActiveObjects(s));` (import `selectActiveObjects` from `'../../store/selectors'`).
- `LayersPanel.tsx` line `const objects = useEditor((s) => s.history.present.objects);` → `const objects = useEditor((s) => selectActiveObjects(s));` (add the import).
- `Inspector.tsx` line `const objects = useEditor((s) => s.history.present.objects);` → `const objects = useEditor((s) => selectActiveObjects(s));` (add the import). Leave `assets` reading `s.history.present.assets` (global).

- [ ] **Step 5: Scope the Stage render + handlers**

In `src/ui/components/Stage/Stage.tsx`:

(a) Import the selectors: add `selectActiveObjects, selectEditProject` to the existing `'../../store/selectors'` import.

(b) Replace the reactive project subscription (`const project = useEditor((s) => s.history.present);`) with a focused, reference-stable project:
```ts
  const present = useEditor((s) => s.history.present);
  const activeObjects = useEditor((s) => selectActiveObjects(s));
  const project = useMemo(
    () => (activeObjects === present.objects ? present : { ...present, objects: activeObjects }),
    [present, activeObjects],
  );
```

(c) In the imperative event handlers, replace every `useEditor.getState().history.present` (the reads that look up scene objects/assets for selection/drag/hit-test) with `selectEditProject(useEditor.getState())`. These are scene reads; `selectEditProject` returns the active `objects` and the same global `assets`/`meta`, so the replacement is uniform and correct.

> Use a search to find them all: `grep -n "useEditor.getState().history.present" src/ui/components/Stage/Stage.tsx`. Replace each occurrence with `selectEditProject(useEditor.getState())`. (Do NOT change `useEditor.getState().<otherField>` reads like `.autoKey`/`.time`/`.selectedObjectIds`.)

- [ ] **Step 6: Add selector-scope assertions**

Append to `src/ui/store/selectors.test.ts`:
```ts
import { selectSelectedObject } from './selectors';
it('selectSelectedObject resolves against the active scene in edit mode', () => {
  const s = stateWith(['sym']);
  (s as { selectedObjectId: string }).selectedObjectId = 'inner';
  (s as { selectedObjectIds: string[] }).selectedObjectIds = ['inner'];
  expect(selectSelectedObject(s)?.id).toBe('inner');
});
```

- [ ] **Step 7: Run the scoped tests + full unit suite**

Run: `npx vitest run src/ui/store/selectors.test.ts src/ui/components/Timeline/Timeline.test.tsx src/ui/components/LayersPanel/LayersPanel.test.tsx src/ui/components/Inspector/Inspector.test.tsx src/ui/components/Stage/Stage.test.tsx`
Expected: PASS (edit-mode scope tests green; existing root tests still green since active == root by default).

- [ ] **Step 8: Typecheck + commit**

```bash
npm run typecheck
git add src/ui/store/selectors.ts src/ui/components/Stage/Stage.tsx src/ui/components/Timeline/Timeline.tsx src/ui/components/LayersPanel/LayersPanel.tsx src/ui/components/Inspector/Inspector.tsx src/ui/store/selectors.test.ts src/ui/components/Timeline/Timeline.test.tsx src/ui/components/LayersPanel/LayersPanel.test.tsx
git commit -m "feat(edit-mode): scope Stage/Timeline/Layers/Inspector + selectors to the active scene"
```

---

### Task 4: Enter / exit UX — double-click, Esc, breadcrumb, tool gating

Wire the human-facing entry/exit: double-click an instance leaf to enter, Esc/breadcrumb to exit, and the create-tool gate that keeps edit mode coherent.

**Files:**
- Create: `src/ui/components/Stage/EditBreadcrumb.tsx`, `src/ui/components/Stage/EditBreadcrumb.module.css`, `src/ui/components/Stage/EditBreadcrumb.test.tsx`
- Modify: `src/ui/components/Stage/Stage.tsx` (double-click handler + leaf wiring), `src/ui/hooks/useKeyboard.ts` (Esc exits), `src/ui/store/store.ts` (`setActiveTool` gate), `src/ui/App.tsx` (mount the breadcrumb)
- Test: `src/ui/components/Stage/Stage.test.tsx`, `src/ui/hooks/useKeyboard.test.ts`, `src/ui/store/store.test.ts`, `src/ui/components/Stage/EditBreadcrumb.test.tsx`

**Interfaces:**
- Consumes: `enterSymbol`/`exitSymbol`/`exitToDepth` (Task 1), `isSymbolInstance` (slice 47b, in `Stage/snapping.ts`), `selectEditProject` (Task 1).

- [ ] **Step 1: Write the failing tests**

Store — `setActiveTool` gate (add to `store.test.ts`):
```ts
it('setActiveTool refuses non-select tools in edit mode', () => {
  const s = useEditor.getState();
  s.newProject();
  const inner = createVectorAsset('rect', { id: 'inner-asset', shapeType: 'rect' });
  const sym = createSymbolAsset({ id: 'sym', objects: [createSceneObject('inner-asset', { id: 'inner' })], width: 10, height: 10 });
  const p = createProject(); p.assets = [inner, sym]; p.objects = [createSceneObject('sym', { id: 'a' })];
  s.commit(p); s.enterSymbol('sym');
  s.setActiveTool('rect');
  expect(useEditor.getState().activeTool).toBe('select'); // gated
});
```

Keyboard — Esc exits a level (add to `useKeyboard.test.ts`, matching its setup):
```ts
it('Escape exits one symbol level when in edit mode', () => {
  const s = useEditor.getState();
  s.newProject();
  const inner = createVectorAsset('rect', { id: 'inner-asset', shapeType: 'rect' });
  const sym = createSymbolAsset({ id: 'sym', objects: [createSceneObject('inner-asset', { id: 'inner' })], width: 10, height: 10 });
  const p = createProject(); p.assets = [inner, sym]; p.objects = [createSceneObject('sym', { id: 'a' })];
  s.commit(p); s.enterSymbol('sym');
  renderHookForKeyboard(); // however this test file mounts the hook (match existing tests)
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(useEditor.getState().editPath).toEqual([]);
});
```
> Match the existing `useKeyboard.test.ts` harness (it mounts the hook via a test component / `renderHook`). Use whatever pattern the other Escape test uses.

Breadcrumb component (`EditBreadcrumb.test.tsx`):
```ts
import { render, screen, fireEvent, act } from '@testing-library/react';
import { EditBreadcrumb } from './EditBreadcrumb';
import { useEditor } from '../../store/store';
import { createProject, createSceneObject, createSymbolAsset, createVectorAsset } from '../../../engine';

it('renders nothing at root and the path with exit buttons in edit mode', () => {
  const s = useEditor.getState();
  s.newProject();
  const inner = createVectorAsset('rect', { id: 'inner-asset', shapeType: 'rect' });
  const sym = createSymbolAsset({ id: 'sym', name: 'Star', objects: [createSceneObject('inner-asset', { id: 'inner' })], width: 10, height: 10 });
  const p = createProject(); p.assets = [inner, sym]; p.objects = [createSceneObject('sym', { id: 'a' })];
  act(() => { s.commit(p); });
  const { rerender } = render(<EditBreadcrumb />);
  expect(screen.queryByTestId('edit-breadcrumb')).not.toBeInTheDocument();
  act(() => { s.enterSymbol('sym'); });
  rerender(<EditBreadcrumb />);
  expect(screen.getByTestId('edit-breadcrumb')).toBeInTheDocument();
  expect(screen.getByText('Star')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Root' }));
  expect(useEditor.getState().editPath).toEqual([]);
});
```

Stage double-click (add to `Stage.test.tsx`, reuse the 47a/47b symbol setup):
```ts
it('double-clicking an instance leaf enters its symbol (slice 47 edit-mode)', () => {
  const inner = createVectorAsset('rect', { id: 'asset-inner', shapeType: 'rect' });
  const innerObj = createSceneObject('asset-inner', { id: 'inner', name: 'inner', zOrder: 0 });
  innerObj.shapeBase = { width: 20, height: 20 };
  const sym = createSymbolAsset({ id: 'sym-1', objects: [innerObj], width: 20, height: 20 });
  const instance = createSceneObject('sym-1', { id: 'inst', name: 'inst', zOrder: 0 });
  const project = createProject();
  project.assets = [inner, sym];
  project.objects = [instance];
  act(() => { useEditor.getState().commit(project); });
  const nodes = new Map<string, SVGGraphicsElement>();
  const { container } = render(<Stage nodes={nodes} />);
  const leaf = container.querySelector('[data-savig-object="inst/inner"]')!;
  act(() => { fireEvent.doubleClick(leaf); });
  expect(useEditor.getState().editPath).toEqual(['sym-1']);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/store/store.test.ts src/ui/hooks/useKeyboard.test.ts src/ui/components/Stage/Stage.test.tsx src/ui/components/Stage/EditBreadcrumb.test.tsx -t "edit mode|Escape exits|double-clicking|breadcrumb"`
Expected: FAIL — gate/handlers/component not present.

- [ ] **Step 3: Gate `setActiveTool`**

In `store.ts`:
```ts
  setActiveTool(tool) {
    if (get().editPath.length > 0 && tool !== 'select') return; // edit mode is select-tool only (v1)
    set(tool === 'node' ? { activeTool: tool } : { activeTool: tool, correspondenceEditing: false });
  },
```

- [ ] **Step 4: Esc exits a symbol level**

In `src/ui/hooks/useKeyboard.ts`, change the `Escape` case so it exits a symbol level when in edit mode (and not pen-drafting):
```ts
        case 'Escape':
          if (s.editPath.length > 0 && !s.penDrafting) { s.exitSymbol(); break; }
          s.requestCancelPen();
          s.setActiveTool('select');
          break;
```

- [ ] **Step 5: Create the breadcrumb component**

`src/ui/components/Stage/EditBreadcrumb.tsx`:
```tsx
import { useEditor } from '../../store/store';
import styles from './EditBreadcrumb.module.css';

// The "you are inside a symbol" path: Root › SymA › SymB. Each prior segment exits to that depth;
// the last segment is the current scene. Renders nothing at the root (slice 47 edit-mode).
export function EditBreadcrumb() {
  const editPath = useEditor((s) => s.editPath);
  const assets = useEditor((s) => s.history.present.assets);
  const exitToDepth = useEditor((s) => s.exitToDepth);
  if (editPath.length === 0) return null;
  const names = editPath.map((id) => {
    const a = assets.find((x) => x.id === id);
    return a && a.kind === 'symbol' ? a.name : 'Symbol';
  });
  return (
    <nav className={styles.breadcrumb} aria-label="Edit path" data-testid="edit-breadcrumb">
      <button type="button" onClick={() => exitToDepth(0)}>Root</button>
      {names.map((name, i) => (
        <span key={`${editPath[i]}-${i}`}>
          <span className={styles.sep} aria-hidden="true"> › </span>
          {i < names.length - 1 ? (
            <button type="button" onClick={() => exitToDepth(i + 1)}>{name}</button>
          ) : (
            <span aria-current="step">{name}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
```

`src/ui/components/Stage/EditBreadcrumb.module.css`:
```css
.breadcrumb {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 8px;
  font-size: 12px;
  background: var(--color-panel, #1e1e1e);
  border-bottom: 1px solid var(--color-border, #333);
}
.breadcrumb button {
  background: none;
  border: none;
  color: var(--color-accent, #4a9eff);
  cursor: pointer;
  padding: 2px 4px;
  font-size: 12px;
}
.breadcrumb button:hover { text-decoration: underline; }
.sep { color: var(--color-text-muted, #888); }
```

- [ ] **Step 6: Mount the breadcrumb + wire Stage double-click**

In `src/ui/App.tsx`, import and render `EditBreadcrumb` inside the Stage section, above `<Stage>`:
```tsx
import { EditBreadcrumb } from './components/Stage/EditBreadcrumb';
// ...
      <section className={styles.stage} aria-label="Stage">
        <EditBreadcrumb />
        <Stage nodes={nodesRef.current} />
      </section>
```

In `src/ui/components/Stage/Stage.tsx`, add a double-click handler near `onObjectPointerDown`:
```ts
  // Double-click an instance's leaf to ENTER its symbol scene (edit-in-place, slice 47 edit-mode).
  const onObjectDoubleClick = (id: string) => {
    const proj = selectEditProject(useEditor.getState());
    const obj = proj.objects.find((o) => o.id === id);
    if (obj && isSymbolInstance(obj, proj.assets)) useEditor.getState().enterSymbol(obj.assetId);
  };
```
Ensure `isSymbolInstance` is imported from `'./snapping'` (slice 47b already added it; confirm it's in the import). Then add `onDoubleClick={() => onObjectDoubleClick(topId)}` to each leaf `<g>` element that already has `onPointerDown={(e) => onObjectPointerDown(topId, e)}` (there are three render branches: path, svg, rect/ellipse — add it to each, alongside the existing `onPointerDown`).

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/ui/store/store.test.ts src/ui/hooks/useKeyboard.test.ts src/ui/components/Stage/Stage.test.tsx src/ui/components/Stage/EditBreadcrumb.test.tsx`
Expected: PASS.

- [ ] **Step 8: Typecheck + commit**

```bash
npm run typecheck
git add src/ui/components/Stage/EditBreadcrumb.tsx src/ui/components/Stage/EditBreadcrumb.module.css src/ui/components/Stage/EditBreadcrumb.test.tsx src/ui/components/Stage/Stage.tsx src/ui/hooks/useKeyboard.ts src/ui/store/store.ts src/ui/App.tsx src/ui/store/store.test.ts src/ui/hooks/useKeyboard.test.ts
git commit -m "feat(edit-mode): double-click to enter, Esc/breadcrumb to exit, select-tool gate"
```

---

### Task 5: e2e + full-suite verification

Prove the whole loop in a real browser and confirm parity/lint/typecheck/all-unit are green.

**Files:**
- Modify: `e2e/symbols.spec.ts`

- [ ] **Step 1: Write the e2e test**

Append to `e2e/symbols.spec.ts`:

```ts
test('edit a symbol in place: enter, move an internal part, both instances update, exit', async ({
  page,
}) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    delete (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });
  await page.goto('/');

  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  const tools = page.getByRole('group', { name: 'Tools' });
  const drawRect = async (x0: number, y0: number, x1: number, y1: number) => {
    await tools.getByRole('button', { name: 'Rectangle', exact: true }).click();
    await page.mouse.move(box.x + x0, box.y + y0);
    await page.mouse.down();
    await page.mouse.move(box.x + x1, box.y + y1);
    await page.mouse.up();
  };

  // One shape -> Create Symbol -> one instance; duplicate it -> two instances.
  await drawRect(120, 100, 180, 160);
  await page.locator('[data-savig-object]').first().click();
  await page.getByRole('button', { name: 'Create Symbol', exact: true }).click();
  await page.keyboard.press('Control+d'); // duplicate the instance (shares the symbol asset)
  const composites = page.locator('[data-savig-object*="/"]');
  await expect(composites).toHaveCount(2); // two instances, each one internal leaf

  // Enter the symbol by double-clicking an instance leaf; breadcrumb appears.
  await composites.first().dblclick();
  await expect(page.getByTestId('edit-breadcrumb')).toBeVisible();

  // Now ONE internal leaf is shown (the symbol scene). Move it; on exit BOTH instances reflect it.
  const internal = page.locator('[data-savig-object="inner"], [data-savig-object]').first();
  const beforeBox = (await internal.boundingBox())!;
  await internal.click();
  for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowRight'); // nudge the internal part right

  // Exit with Esc; both instances now render the moved internal.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('edit-breadcrumb')).toHaveCount(0);
  await expect(composites).toHaveCount(2);
  const movedBox = (await composites.first().boundingBox())!;
  expect(movedBox.x).toBeGreaterThan(beforeBox.x); // edit-propagation: the instance moved with the symbol edit
});
```
> The internal-leaf locator and the Create-Symbol/duplicate gestures must match the real DOM — before finalizing, verify the duplicate shortcut (grep `useKeyboard` for the duplicate key; it may be `Control+d` or a button) and that in edit mode the single internal leaf is selectable. Adjust selectors to the actual DOM; the assertions (breadcrumb visible on enter, gone on exit, instance moves after editing the internal) are the contract.

- [ ] **Step 2: Run the e2e**

Run: `npm run e2e -- symbols.spec.ts`
Expected: PASS (the 47a/47b symbol tests plus the new edit-mode test).

- [ ] **Step 3: Full-suite verification**

```bash
npm test
npm run typecheck
npx eslint src e2e
npm run e2e
```
Expected: all green. Engine/parity suites (`engine/symbol.test.ts`, `runtime/frame.test.ts`, `services/export/renderDocument.test.ts`) UNCHANGED and green.

- [ ] **Step 4: Commit**

```bash
git add e2e/symbols.spec.ts
git commit -m "test(edit-mode): e2e enter symbol, edit internal, propagation, exit"
```

---

## Self-Review

**1. Spec coverage** (spec §3–§7):
- §3.1 `editPath` state → Task 1. §3.2 `selectActiveObjects`/`selectEditProject` → Task 1. §3.3 `commitActiveScene` → Task 1. §3.4 enter/exit/Esc → Tasks 1 (actions) + 4 (double-click/Esc). §3.5 breadcrumb → Task 4. ✅
- §4 transform-only routing + create-tool gate + no-op-safety → Task 2 (routing) + Task 4 (gate). ✅
- §5 read-scope Stage/Timeline/Layers/Inspector + selectors → Task 3. ✅
- §6 edit-propagation (Task 2 test), parity (no engine change — Global Constraints), undo (free; missing-asset fallback in Task 1). ✅
- §7 deferred items (delete/draw/node/group/clipboard/Layers-mutators) — explicitly NOT implemented; safe by no-op + tool gate. ✅
- §9 testing — store/selectors (T1–T3), components (T3), keyboard/breadcrumb/double-click (T4), e2e (T5). ✅

**2. Placeholder scan:** No TBD/TODO; every code step has full code/tests. Three harness-calibration notes (useKeyboard test mount, duplicate shortcut, internal-leaf locator) state the invariant + "verify against real DOM" — calibration, not placeholders. ✅

**3. Type consistency:** `selectActiveAssetId`/`selectActiveObjects(s): SceneObject[]`/`selectEditProject(s): Project`; `enterSymbol(assetId: string)`/`exitSymbol()`/`exitToDepth(depth: number)`/`commitActiveScene(nextObjects: SceneObject[])` used identically across tasks. `editPath: string[]`. Routed actions keep their existing public signatures (only internals change). ✅

**4. Parity:** no file under `engine/`/`runtime/`/`services/export/` is touched; the Stage feeds `flattenInstances`/`computeFrame` a focused project (same functions, different `objects[]`). ✅
