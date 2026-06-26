# Slice 47b — Symbol Instance Transform UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a selected symbol instance a selection-bbox outline, scale + rotate handles, move-snapping, and live drag-preview of its internals — the transform UI deferred from 47a (slice47 spec §6) — by generalizing the existing group-container transform machinery to also fire for instances.

**Architecture:** A symbol instance is structurally a **node-less container, exactly like a group**: 47a made it an ordinary `SceneObject` (`assetId` → `SymbolAsset`) that renders as flattened composite-id leaves with no DOM node of its own. Groups already solve "node-less container with a composed transform" via `groupAABB` (bbox), the shared slice-40/41 bbox handles (`groupBounds` overlay), and `previewGroupChildren` (live drag preview). This slice adds the **instance analogues** — `instanceAABB` (numeric, mirroring `groupAABB`, but its "content" is the symbol's whole flattened scene) and `previewInstanceChildren` (repaints the instance's leaves from the in-progress transform via the existing `applyFrame`/`computeFrame` commit path) — then flips the Stage's `obj.isGroup` container checks to also recognize instances. **No engine render code changes** (`flattenInstances`/`computeFrame`/`renderDocument` untouched), so the preview==export parity invariant is unaffected; all new math lives in the editor-only `snapping.ts` chrome, like `groupAABB`.

**Tech Stack:** TypeScript (strict), React, Zustand store, Vitest (unit + jsdom component), Playwright (e2e). No new dependencies.

## Global Constraints

- **Preview == export parity is sacred.** Do NOT touch `engine/symbol.ts`, `runtime/frame.ts` (`computeFrame`), or `services/export/renderDocument.ts`. All new geometry is editor-only chrome in `src/ui/components/Stage/snapping.ts` (the same file/role as `groupAABB`). The parity test suite must stay green untouched.
- **No new dependencies.**
- **Mirror existing patterns exactly.** `instanceAABB` mirrors `groupAABB`'s corner-mapping `map()`; `previewInstanceChildren` mirrors `previewGroupChildren`'s role; container gating mirrors `isSingleGroupSelected`. Match surrounding code's comment density and naming.
- **Cycle safety.** A symbol may not (transitively) contain itself. Every recursive AABB helper carries a visited-**asset** `Set` and bails on re-entry (mirrors `flattenInstances` guard #1 and `groupAABB`'s object-id `seen`).
- **Commit cadence:** one commit per task (TDD: failing test → implementation → green → commit).
- **Definition of done per task:** `npm test` (vitest) green for the touched files; at plan end `npm test`, `npm run typecheck`, `npm run lint`, and `npm run e2e` all green. Engine/parity suites must remain green at every step.
- **No keyboard shortcuts, no Inspector changes, no edit-mode** (double-click-to-enter is the *next* slice, 47b-edit). This slice is Stage transform UI only.

---

### Task 1: Instance AABB geometry (`snapping.ts`)

Pure stage-space bounding-box math: an instance's box, a whole symbol scene's content box, a dispatcher, and an `isSymbolInstance` predicate. Also teach `groupAABB` that a group child may itself be an instance (an instance nested inside a group must contribute its box). All editor-only; no engine/runtime/export changes.

**Files:**
- Modify: `src/ui/components/Stage/snapping.ts` (add `isSymbolInstance`, `instanceAABB`, `sceneContentAABB`, `entityAABB`; extend `groupAABB`'s child branch)
- Test: `src/ui/components/Stage/snapping.test.ts`

**Interfaces:**
- Consumes: existing `objectAABB(obj, asset, time)`, `groupAABB(group, objects, assets, time, seen?)`, `groupBBox(boxes)`, `AABB`, `sampleObject` (already imported in `snapping.ts`); `Asset`, `SceneObject` types (already imported).
- Produces:
  - `isSymbolInstance(obj: SceneObject, assets: Asset[]): boolean`
  - `instanceAABB(instance: SceneObject, assets: Asset[], time: number, seenAssets?: Set<string>): AABB | null`
  - `sceneContentAABB(objects: SceneObject[], assets: Asset[], time: number, seenAssets?: Set<string>): AABB | null`
  - `entityAABB(obj: SceneObject, objects: SceneObject[], assets: Asset[], time: number): AABB | null`

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/components/Stage/snapping.test.ts`. (The file already imports from `./snapping` and `../../../engine` — extend the existing import lines to add `instanceAABB`, `sceneContentAABB`, `entityAABB`, `isSymbolInstance` and `createSymbolAsset`.)

```ts
import { instanceAABB, sceneContentAABB, entityAABB, isSymbolInstance } from './snapping';
import { createSymbolAsset } from '../../../engine';

describe('instanceAABB (slice 47b)', () => {
  // A symbol containing one 10x10 rect at the origin; instanced identity at the top level.
  const innerAsset = createVectorAsset('rect', { id: 'inner', shapeType: 'rect' });
  const makeInner = () => {
    const o = createSceneObject('inner', { id: 'r', zOrder: 0 });
    o.shapeBase = { width: 10, height: 10 };
    return o;
  };

  it('returns the symbol content box mapped through an identity instance', () => {
    const sym = createSymbolAsset({ id: 'sym', objects: [makeInner()], width: 10, height: 10 });
    const inst = createSceneObject('sym', { id: 'i', base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
    const box = instanceAABB(inst, [innerAsset, sym], 0)!;
    expect(box.minX).toBeCloseTo(0, 4);
    expect(box.minY).toBeCloseTo(0, 4);
    expect(box.maxX).toBeCloseTo(10, 4);
    expect(box.maxY).toBeCloseTo(10, 4);
  });

  it('shifts the box by the instance translation', () => {
    const sym = createSymbolAsset({ id: 'sym', objects: [makeInner()], width: 10, height: 10 });
    const inst = createSceneObject('sym', { id: 'i', base: { x: 100, y: 50, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
    const box = instanceAABB(inst, [innerAsset, sym], 0)!;
    expect(box.minX).toBeCloseTo(100, 4);
    expect(box.minY).toBeCloseTo(50, 4);
    expect(box.maxX).toBeCloseTo(110, 4);
    expect(box.maxY).toBeCloseTo(60, 4);
  });

  it('doubles the box for a 2x instance scale about an anchor at the box centre', () => {
    const sym = createSymbolAsset({ id: 'sym', objects: [makeInner()], width: 10, height: 10 });
    const inst = createSceneObject('sym', {
      id: 'i', anchorX: 5, anchorY: 5,
      base: { x: 0, y: 0, scaleX: 2, scaleY: 2, rotation: 0, opacity: 1 },
    });
    const box = instanceAABB(inst, [innerAsset, sym], 0)!;
    expect(box.maxX - box.minX).toBeCloseTo(20, 4);
    expect(box.maxY - box.minY).toBeCloseTo(20, 4);
    // anchor (5,5) is fixed; content 0..10 -> -5..15 about 5
    expect(box.minX).toBeCloseTo(-5, 4);
    expect(box.maxX).toBeCloseTo(15, 4);
  });

  it('returns null for a missing symbol and is cycle-guarded against self-containment', () => {
    const inst = createSceneObject('missing', { id: 'i' });
    expect(instanceAABB(inst, [], 0)).toBeNull();
    // A self-referential symbol (contains an instance of itself) must terminate and be finite.
    const selfInst = createSceneObject('cyc', { id: 'self' });
    const sym = createSymbolAsset({ id: 'cyc', objects: [selfInst, makeInner()], width: 10, height: 10 });
    const outer = createSceneObject('cyc', { id: 'o', base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
    const box = instanceAABB(outer, [innerAsset, sym], 0)!; // the recursive self-branch is skipped; the rect still counts
    expect(box.maxX - box.minX).toBeCloseTo(10, 4);
  });
});

describe('entityAABB + sceneContentAABB (slice 47b)', () => {
  const innerAsset = createVectorAsset('rect', { id: 'inner', shapeType: 'rect' });

  it('dispatches a plain object to its objectAABB', () => {
    const svg: SvgAsset = { id: 'a', kind: 'svg', name: 'box', normalizedContent: '<svg/>', viewBox: '0 0 40 20', width: 40, height: 20 };
    const obj = createSceneObject('a', { id: 'o', base: { x: 5, y: 7, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
    expect(entityAABB(obj, [obj], [svg], 0)).toEqual({ minX: 5, minY: 7, maxX: 45, maxY: 27 });
  });

  it('dispatches an instance to its instanceAABB', () => {
    const r = createSceneObject('inner', { id: 'r', zOrder: 0 });
    r.shapeBase = { width: 10, height: 10 };
    const sym = createSymbolAsset({ id: 'sym', objects: [r], width: 10, height: 10 });
    const inst = createSceneObject('sym', { id: 'i', base: { x: 20, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
    const box = entityAABB(inst, [inst], [innerAsset, sym], 0)!;
    expect(box.minX).toBeCloseTo(20, 4);
    expect(box.maxX).toBeCloseTo(30, 4);
  });

  it('unions two top-level objects into a scene content box', () => {
    const r1 = createSceneObject('inner', { id: 'r1', zOrder: 0, base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
    r1.shapeBase = { width: 10, height: 10 };
    const r2 = createSceneObject('inner', { id: 'r2', zOrder: 1, base: { x: 40, y: 30, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
    r2.shapeBase = { width: 10, height: 10 };
    const box = sceneContentAABB([r1, r2], [innerAsset], 0)!;
    expect(box).toEqual({ minX: 0, minY: 0, maxX: 50, maxY: 40 });
  });
});

describe('isSymbolInstance (slice 47b)', () => {
  it('is true only when the object asset is a symbol', () => {
    const sym = createSymbolAsset({ id: 'sym', objects: [], width: 0, height: 0 });
    const svg: SvgAsset = { id: 'a', kind: 'svg', name: 'b', normalizedContent: '<svg/>', viewBox: '0 0 1 1', width: 1, height: 1 };
    expect(isSymbolInstance(createSceneObject('sym', { id: 'i' }), [sym, svg])).toBe(true);
    expect(isSymbolInstance(createSceneObject('a', { id: 'o' }), [sym, svg])).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/ui/components/Stage/snapping.test.ts`
Expected: FAIL — `instanceAABB`/`sceneContentAABB`/`entityAABB`/`isSymbolInstance` are not exported.

- [ ] **Step 3: Implement the helpers in `snapping.ts`**

Add the following to `src/ui/components/Stage/snapping.ts` (after `groupAABB`). Function declarations are hoisted, so the mutual recursion (`groupAABB` ↔ `instanceAABB` ↔ `sceneContentAABB`) resolves regardless of textual order.

```ts
// True when an object is a symbol INSTANCE: its asset resolves to a SymbolAsset (slice 47b).
export function isSymbolInstance(obj: SceneObject, assets: Asset[]): boolean {
  return assets.find((a) => a.id === obj.assetId)?.kind === 'symbol';
}

// The stage AABB of a single symbol INSTANCE (slice 47b): the symbol scene's content box mapped
// through the instance's transform M(p) = (x,y) + anchor + R(rot)·S(sx,sy)·(p − anchor) — the
// SAME M as groupAABB. Null when the symbol is missing/empty. Cycle-guarded by a visited-ASSET
// set: a symbol may not (transitively) contain itself (mirrors flattenInstances guard #1).
export function instanceAABB(
  instance: SceneObject,
  assets: Asset[],
  time: number,
  seenAssets: Set<string> = new Set(),
): AABB | null {
  const symbol = assets.find((a) => a.id === instance.assetId);
  if (!symbol || symbol.kind !== 'symbol') return null;
  if (seenAssets.has(symbol.id)) return null; // cycle guard
  const next = new Set(seenAssets);
  next.add(symbol.id);
  const content = sceneContentAABB(symbol.objects, assets, time, next);
  if (!content) return null;
  const is = sampleObject(instance, time);
  const rad = (is.rotation * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const map = (px: number, py: number) => {
    const ex = is.scaleX * (px - instance.anchorX);
    const ey = is.scaleY * (py - instance.anchorY);
    return { x: is.x + instance.anchorX + (c * ex - s * ey), y: is.y + instance.anchorY + (s * ex + c * ey) };
  };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [px, py] of [[content.minX, content.minY], [content.maxX, content.minY], [content.maxX, content.maxY], [content.minX, content.maxY]] as const) {
    const m = map(px, py);
    if (m.x < minX) minX = m.x;
    if (m.y < minY) minY = m.y;
    if (m.x > maxX) maxX = m.x;
    if (m.y > maxY) maxY = m.y;
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

// The content AABB of a whole scene (a symbol's own objects[], or the top-level objects):
// the union of every TOP-LEVEL object's box — group → groupAABB, instance → instanceAABB, else
// → objectAABB. Children are reached through their group/instance, so parentId'd objects are
// skipped here (they would double-count). seenAssets threads the instance cycle guard down.
export function sceneContentAABB(
  objects: SceneObject[],
  assets: Asset[],
  time: number,
  seenAssets: Set<string> = new Set(),
): AABB | null {
  const boxes: AABB[] = [];
  for (const o of objects) {
    if (o.parentId) continue; // reached via its parent group
    let box: AABB | null;
    if (o.isGroup) box = groupAABB(o, objects, assets, time);
    else if (isSymbolInstance(o, assets)) box = instanceAABB(o, assets, time, seenAssets);
    else box = objectAABB(o, assets.find((a) => a.id === o.assetId), time);
    if (box) boxes.push(box);
  }
  return groupBBox(boxes);
}

// Dispatch: the stage AABB of ANY entity — group container, symbol instance, or plain object.
// The single entry point Stage uses for selection bbox / snapping so all three kinds compose.
export function entityAABB(obj: SceneObject, objects: SceneObject[], assets: Asset[], time: number): AABB | null {
  if (obj.isGroup) return groupAABB(obj, objects, assets, time);
  if (isSymbolInstance(obj, assets)) return instanceAABB(obj, assets, time);
  return objectAABB(obj, assets.find((a) => a.id === obj.assetId), time);
}
```

Then extend `groupAABB`'s per-child box selection (currently `child.isGroup ? groupAABB(...) : objectAABB(...)`) so an **instance child** contributes its `instanceAABB` (an instance nested inside a group). Replace the `const cb = ...` line inside `groupAABB`'s `for (const child of children)` loop with:

```ts
    const cb = child.isGroup
      ? groupAABB(child, objects, assets, time, seen)
      : isSymbolInstance(child, assets)
        ? instanceAABB(child, assets, time)
        : objectAABB(child, assets.find((a) => a.id === child.assetId), time);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/ui/components/Stage/snapping.test.ts`
Expected: PASS (new `slice 47b` describe blocks green; existing `groupAABB`/`objectAABB` tests still green).

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/Stage/snapping.ts src/ui/components/Stage/snapping.test.ts
git commit -m "feat(slice47b): instanceAABB/entityAABB/sceneContentAABB + groupAABB instance-child"
```

---

### Task 2: Selection bbox + scale/rotate handles for a single instance (`Stage.tsx`)

Make the `groupBounds` overlay (the solid bbox + 8 scale handles + rotate handle, slices 40/41/45b) appear for a single selected instance, and make those handles drive the instance's own transform. The handle render markup and drag math are unchanged — only the gating and the `previewInstanceChildren` hook are new.

**Files:**
- Modify: `src/ui/components/Stage/Stage.tsx`
- Test: `src/ui/components/Stage/Stage.test.tsx`

**Interfaces:**
- Consumes (from Task 1): `instanceAABB`, `entityAABB`, `isSymbolInstance` from `./snapping`. From engine: `applyFrame` (already imported via `../../playback/applyFrame`), `Transform2D` type, `sampleObject`, `buildTransform`, `Project`, `SceneObject` (already imported).
- Produces: `previewInstanceChildren(proj, instance, time, base)` (module-internal Stage closure, mirrors `previewGroupChildren`); a single instance now yields a truthy `groupBounds`; `isSingleContainerSelected()` replaces `isSingleGroupSelected()`.

- [ ] **Step 1: Write the failing test**

Add to `src/ui/components/Stage/Stage.test.tsx`. Reuse the 47a symbol-injection setup pattern (already present at the top of the file: `createSymbolAsset`, `createVectorAsset`, `createSceneObject`, `createProject`).

```ts
it('shows bbox + scale + rotate handles for a single selected symbol instance (slice 47b)', () => {
  const inner = createVectorAsset('rect', { id: 'asset-inner', shapeType: 'rect' });
  const innerObj = createSceneObject('asset-inner', { id: 'inner', name: 'inner', zOrder: 0 });
  innerObj.shapeBase = { width: 20, height: 20 };
  const sym = createSymbolAsset({ id: 'sym-1', objects: [innerObj], width: 20, height: 20 });
  const instance = createSceneObject('sym-1', { id: 'inst', name: 'inst', zOrder: 1, anchorX: 10, anchorY: 10 });
  const project = createProject();
  project.assets = [inner, sym];
  project.objects = [instance];
  act(() => {
    useEditor.getState().commit(project);
    useEditor.getState().selectObject('inst');
  });
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  expect(screen.getByTestId('group-handles')).toBeInTheDocument();
  expect(screen.getByTestId('group-handle-se')).toBeInTheDocument();
  expect(screen.getByTestId('group-rotate-handle')).toBeInTheDocument();
});

it('scaling the SE handle of a single instance commits the instance scale (slice 47b)', () => {
  stubIdentityCTM(); // client coords == content coords (top-level helper already in this file)
  const inner = createVectorAsset('rect', { id: 'asset-inner', shapeType: 'rect' });
  const innerObj = createSceneObject('asset-inner', { id: 'inner', name: 'inner', zOrder: 0 });
  innerObj.shapeBase = { width: 20, height: 20 };
  const sym = createSymbolAsset({ id: 'sym-1', objects: [innerObj], width: 20, height: 20 });
  // content box is 0..20; anchor at the box centre (10,10), base identity.
  const instance = createSceneObject('sym-1', { id: 'inst', name: 'inst', zOrder: 1, anchorX: 10, anchorY: 10 });
  const project = createProject();
  project.assets = [inner, sym];
  project.objects = [instance];
  act(() => {
    useEditor.getState().commit(project);
    useEditor.getState().selectObject('inst');
    useEditor.getState().setAutoKey(true);
  });
  const nodes = new Map<string, SVGGraphicsElement>();
  render(<Stage nodes={nodes} />);
  // SE handle sits at the bbox max corner (20,20); the pivot is the NW corner (0,0).
  // Drag it to (40,40): scale factor 2 about the NW pivot (exact under the identity-CTM stub).
  const se = screen.getByTestId('group-handle-se');
  act(() => {
    fireEvent.pointerDown(se, { clientX: 20, clientY: 20, button: 0 });
  });
  act(() => {
    fireEvent.pointerMove(window, { clientX: 40, clientY: 40 });
    fireEvent.pointerUp(window, { clientX: 40, clientY: 40 });
  });
  const committed = useEditor.getState().history.present.objects.find((o) => o.id === 'inst')!;
  const s = sampleObject(committed, 0);
  expect(s.scaleX).toBeCloseTo(2, 1);
  expect(s.scaleY).toBeCloseTo(2, 1);
});
```

> Note: `stubIdentityCTM()` (a top-level helper already defined in `Stage.test.tsx`, used by every existing handle/move test) makes `getScreenCTM` identity so client coords == content coords — the drag deltas above are therefore exact. `toBeCloseTo(2, 1)` only absorbs floating-point noise from the scale division.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/ui/components/Stage/Stage.test.tsx -t "single selected symbol instance"`
Expected: FAIL — `group-handles` not in the document (an instance produces no `groupBounds` yet).

- [ ] **Step 3: Implement the wiring in `Stage.tsx`**

(a) Extend the `./snapping` import (the line `import { computeSnap, aabbIntersect, groupBBox, groupAABB, objectAABB, resolveObjectAnchor, SNAP_PX, type AABB } from './snapping';`) to add `instanceAABB, entityAABB, isSymbolInstance`:

```ts
import { computeSnap, aabbIntersect, groupBBox, groupAABB, instanceAABB, entityAABB, isSymbolInstance, objectAABB, resolveObjectAnchor, SNAP_PX, type AABB } from './snapping';
```

(b) Ensure `Transform2D` is imported from the engine type import. Add `Transform2D` to the existing `import type { ... } from '../../../engine';` list.

(c) In the `groupBounds` useMemo, replace the single-selection branch so a single instance also yields a box:

```ts
    if (selectedIds.length === 1) {
      const only = project.objects.find((o) => o.id === selectedIds[0]);
      if (!only) return null;
      if (only.isGroup) return groupAABB(only, project.objects, project.assets, time);
      if (isSymbolInstance(only, project.assets)) return instanceAABB(only, project.assets, time);
      return null;
    }
```

(d) Add `previewInstanceChildren` immediately after `previewGroupChildren`:

```ts
  // Live-preview a symbol INSTANCE's handle/move drag: an instance has no DOM node of its own
  // (it renders as flattened composite-id leaves), so repaint the whole stage from a project
  // where THIS instance carries the in-progress transform as a static base (tracks stripped so
  // it samples to `base`). Reuses computeFrame/applyFrame — the exact commit path — so the
  // preview matches the committed result by construction (slice 47b, mirrors previewGroupChildren).
  const previewInstanceChildren = (proj: Project, instance: SceneObject, time: number, base: Transform2D) => {
    const previewObj = { ...instance, base, tracks: {} };
    const previewProj = { ...proj, objects: proj.objects.map((o) => (o.id === instance.id ? previewObj : o)) };
    applyFrame(nodes, previewProj, time);
  };
```

(e) Replace `isSingleGroupSelected` (definition + both call sites) with a container-aware version:

```ts
  // True when exactly one node-less CONTAINER is selected — a group OR a symbol instance. Its
  // bbox handles edit that container's transform (keyframed when auto-key is on, base when off;
  // slices 45b/45d/47b).
  const isSingleContainerSelected = () => {
    const ids = useEditor.getState().selectedObjectIds;
    if (ids.length !== 1) return false;
    const proj = useEditor.getState().history.present;
    const o = proj.objects.find((x) => x.id === ids[0]);
    return !!o && (o.isGroup || isSymbolInstance(o, proj.assets));
  };
```

Update the two `if (!isSingleGroupSelected() && !useEditor.getState().autoKey) return;` lines (in `onGroupHandlePointerDown` and `onGroupRotatePointerDown`) to call `isSingleContainerSelected()`.

(f) In the group-scale `onMove` loop, extend the no-node branch (currently `else if (obj.isGroup) previewGroupChildren(proj, obj.id, time, xf);`) to handle an instance. The loop already has `const sampled = sampleObject(obj, time);` in scope:

```ts
          const node = nodes.get(it.id);
          if (node) node.setAttribute('transform', xf);
          else if (obj.isGroup) previewGroupChildren(proj, obj.id, time, xf); // group has no node — preview its children
          else if (isSymbolInstance(obj, proj.assets))
            previewInstanceChildren(proj, obj, time, { x: nx, y: ny, scaleX: it.osx * sx, scaleY: it.osy * sy, rotation: sampled.rotation, opacity: sampled.opacity });
```

(g) In the group-rotate `onMove` loop, same pattern (the loop has `const sampled = sampleObject(obj, time);` in scope):

```ts
          const node = nodes.get(it.id);
          if (node) node.setAttribute('transform', xf);
          else if (obj.isGroup) previewGroupChildren(proj, obj.id, time, xf); // group has no node — preview its children
          else if (isSymbolInstance(obj, proj.assets))
            previewInstanceChildren(proj, obj, time, { x: nx, y: ny, scaleX: sampled.scaleX, scaleY: sampled.scaleY, rotation: it.orot + theta, opacity: sampled.opacity });
```

(No commit-path change is needed: `onGroupHandlePointerDown`/`onGroupRotatePointerDown` build `items` from `selectedIds` and commit via `setObjectsTransforms`, which writes the instance's own transform — `resolveObjectAnchor` returns `null` for a symbol asset, so the item falls back to the instance's stored `anchorX/anchorY` (the content centre), exactly as a single group does.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/ui/components/Stage/Stage.test.tsx -t "slice 47b"`
Expected: PASS. Then run the whole Stage suite to confirm no group regressions:
Run: `npm test -- src/ui/components/Stage/Stage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/Stage/Stage.tsx src/ui/components/Stage/Stage.test.tsx
git commit -m "feat(slice47b): instance shows bbox + scale/rotate handles; previewInstanceChildren"
```

---

### Task 3: Instance move — snapping + live preview (`Stage.tsx`)

Let a single instance begin a move-drag like a group (regardless of auto-key), snap its `instanceAABB` to the artboard + other entities, preview its leaves mid-drag, and become a snap target for other objects' moves.

**Files:**
- Modify: `src/ui/components/Stage/Stage.tsx`
- Test: `src/ui/components/Stage/Stage.test.tsx`

**Interfaces:**
- Consumes (Task 1/2): `instanceAABB`, `entityAABB`, `isSymbolInstance`, `previewInstanceChildren`. Existing `dragRef` shape (`{ id, startX, startY, originX, originY, curX, curY, moved, baseAABB, targets }`), `nudgeSelected`/`setProperties` commit on pointer-up (unchanged).
- Produces: a single-instance move branch in `onObjectPointerDown`; instance leaves tracking the drag; instance boxes added as snap targets in the plain single-object drag.

- [ ] **Step 1: Write the failing test**

Add to `src/ui/components/Stage/Stage.test.tsx`:

```ts
it('drag-moves a single symbol instance and commits its base translation (slice 47b)', () => {
  stubIdentityCTM(); // client coords == content coords; drag deltas are exact
  const inner = createVectorAsset('rect', { id: 'asset-inner', shapeType: 'rect' });
  const innerObj = createSceneObject('asset-inner', { id: 'inner', name: 'inner', zOrder: 0 });
  innerObj.shapeBase = { width: 20, height: 20 };
  const sym = createSymbolAsset({ id: 'sym-1', objects: [innerObj], width: 20, height: 20 });
  const instance = createSceneObject('sym-1', { id: 'inst', name: 'inst', zOrder: 1, anchorX: 10, anchorY: 10 });
  const project = createProject();
  project.assets = [inner, sym];
  project.objects = [instance];
  act(() => {
    useEditor.getState().commit(project);
    useEditor.getState().selectObject('inst');
    useEditor.getState().setAutoKey(false); // a container moves regardless of auto-key
    useEditor.getState().setSnapEnabled(false); // isolate the raw translation
  });
  const nodes = new Map<string, SVGGraphicsElement>();
  const { container } = render(<Stage nodes={nodes} />);
  // Grab one of the instance's flattened leaf nodes (composite id) and start a drag on it.
  const leaf = container.querySelector('[data-savig-object*="/"]')!;
  act(() => {
    fireEvent.pointerDown(leaf, { clientX: 5, clientY: 5, button: 0 });
  });
  act(() => {
    fireEvent.pointerMove(window, { clientX: 35, clientY: 25 });
    fireEvent.pointerUp(window, { clientX: 35, clientY: 25 });
  });
  const committed = useEditor.getState().history.present.objects.find((o) => o.id === 'inst')!;
  const s = sampleObject(committed, 0);
  expect(s.x).toBeCloseTo(30, 1);
  expect(s.y).toBeCloseTo(20, 1);
});
```

> `stubIdentityCTM()` makes the mapping 1:1, so the drag delta (35−5, 25−5) = (30,20) lands exactly on the committed base `x/y`. (The plain single-object move path computes `curX = originX + (clientX − startX)/zoom`, zoom == 1.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/ui/components/Stage/Stage.test.tsx -t "drag-moves a single symbol instance"`
Expected: FAIL — with auto-key off, the single-object move branch is gated out (`if (!autoKey) return;`), so the instance does not move; committed `x` stays 0.

- [ ] **Step 3: Implement the move branch + snapping in `Stage.tsx`**

(a) In `onObjectPointerDown`, immediately **after** the group (`grp`) branch's closing `}` (the `if (grp) { ... return; }`) and **before** `if (!useEditor.getState().autoKey) return;`, add a single-instance branch:

```ts
    // A single SYMBOL INSTANCE is a node-less container like a group: begin a move-drag
    // regardless of auto-key. baseAABB is its instanceAABB so it snaps; targets are every other
    // entity's box; the preview repaints its leaves; the commit (setProperties on pointer-up)
    // writes base when auto-key is off / keyframes when on (slice 47b).
    const inst =
      !alreadyMulti
        ? useEditor.getState().history.present.objects.find(
            (o) => o.id === useEditor.getState().selectedObjectId && isSymbolInstance(o, useEditor.getState().history.present.assets),
          )
        : undefined;
    if (inst) {
      const proj = useEditor.getState().history.present;
      const t = useEditor.getState().time;
      const origin = sampleObject(inst, t);
      const targets: AABB[] = [];
      for (const o of proj.objects) {
        if (o.id === inst.id || o.isGroup || o.parentId) continue; // group containers have no box; children counted below
        const box = entityAABB(o, proj.objects, proj.assets, t);
        if (box) targets.push(box);
      }
      // include group children individually (parentId'd leaves), matching the plain-object loop
      for (const o of proj.objects) {
        if (o.id === inst.id || !o.parentId || o.isGroup) continue;
        const box = objectAABB(o, proj.assets.find((a) => a.id === o.assetId), t);
        if (box) targets.push(box);
      }
      targets.push({ minX: 0, minY: 0, maxX: proj.meta.width, maxY: proj.meta.height });
      dragRef.current = {
        id: inst.id, startX: e.clientX, startY: e.clientY,
        originX: origin.x, originY: origin.y, curX: origin.x, curY: origin.y, moved: false,
        baseAABB: instanceAABB(inst, proj.assets, t), targets,
      };
      return;
    }
```

(b) In the single-object move preview (the `if (obj && node) { ... }` block inside `onMove`, the branch that sets `node.setAttribute('transform', ...)` for a non-multi drag), add an `else if` so an instance previews its leaves. Locate:

```ts
      const proj = useEditor.getState().history.present;
      const obj = proj.objects.find((o) => o.id === d.id);
      const node = nodes.get(d.id);
      if (obj && node) {
        const sampled = sampleObject(obj, useEditor.getState().time);
        const resolved = resolveObjectAnchor(obj, proj.assets.find((a) => a.id === obj.assetId), sampled);
        const ax = resolved ? resolved.anchorX : obj.anchorX;
        const ay = resolved ? resolved.anchorY : obj.anchorY;
        node.setAttribute('transform', buildTransform({ ...sampled, x: d.curX, y: d.curY }, ax, ay));
      }
```

and append:

```ts
      else if (obj && isSymbolInstance(obj, proj.assets)) {
        const sampled = sampleObject(obj, useEditor.getState().time);
        previewInstanceChildren(proj, obj, useEditor.getState().time, { x: d.curX, y: d.curY, scaleX: sampled.scaleX, scaleY: sampled.scaleY, rotation: sampled.rotation, opacity: sampled.opacity });
      }
```

(c) Make instances first-class snap targets for a **plain object's** move-drag too. In the plain single-object move setup (the loop building `targets` just before the final `dragRef.current = { ... baseAABB: objectAABB(...) }`), change the per-object box from `objectAABB` to `entityAABB` (and skip group containers, which have no box of their own):

```ts
    const targets: AABB[] = [];
    for (const o of proj.objects) {
      if (o.id === id || o.isGroup) continue;
      const a = entityAABB(o, proj.objects, proj.assets, dragTime);
      if (a) targets.push(a);
    }
    targets.push({ minX: 0, minY: 0, maxX: proj.meta.width, maxY: proj.meta.height });
```

(The moved object's own `baseAABB` for a plain object stays `objectAABB(obj, assetsById.get(obj.assetId), dragTime)` — unchanged; instances reach their own move via the branch in (a).)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/ui/components/Stage/Stage.test.tsx -t "drag-moves a single symbol instance"`
Expected: PASS. Then the whole Stage suite:
Run: `npm test -- src/ui/components/Stage/Stage.test.tsx`
Expected: PASS (no move/snap regressions).

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/Stage/Stage.tsx src/ui/components/Stage/Stage.test.tsx
git commit -m "feat(slice47b): instance move-snapping + live drag preview of internals"
```

---

### Task 4: e2e + full-suite verification

Prove the whole transform UI end-to-end in a real browser, and confirm parity/lint/typecheck/all-unit are green.

**Files:**
- Modify: `e2e/symbols.spec.ts` (add a transform-UI test)

**Interfaces:**
- Consumes: the existing `symbols.spec.ts` helpers (draw-rect, Create Symbol button). Selection-handle `data-testid`s: `group-handles`, `group-handle-se`, `group-rotate-handle` (rendered for a single instance after Task 2).

- [ ] **Step 1: Write the failing e2e test**

Append to `e2e/symbols.spec.ts`:

```ts
test('a selected symbol instance shows transform handles and scales its internals', async ({ page }) => {
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

  await drawRect(120, 100, 200, 170);
  await drawRect(240, 120, 320, 190);

  const objects = page.locator('[data-savig-object]');
  await expect(objects).toHaveCount(2);
  await objects.nth(0).click();
  await objects.nth(1).click({ modifiers: ['Shift'] });
  await page.getByRole('button', { name: 'Create Symbol', exact: true }).click();

  // Select the instance (click an internal leaf — atomic selection routes to the instance).
  const composite = page.locator('[data-savig-object*="/"]');
  await expect(composite).toHaveCount(2);
  await composite.first().click();

  // The instance now shows the container transform handles (slice 47b).
  await expect(page.getByTestId('group-handles')).toBeVisible();
  await expect(page.getByTestId('group-rotate-handle')).toBeVisible();

  // Enable auto-key so the scale commits, then drag the SE handle outward and confirm the
  // instance's flattened leaves grew (their rendered width increased).
  // (Auto-key toggle: the Timeline "Auto-key" control.)
  const beforeBox = await composite.first().boundingBox();
  const se = page.getByTestId('group-handle-se');
  const seBox = (await se.boundingBox())!;
  await page.getByRole('checkbox', { name: /auto-key/i }).check().catch(() => {});
  await page.mouse.move(seBox.x + seBox.width / 2, seBox.y + seBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(seBox.x + 80, seBox.y + 80);
  await page.mouse.up();
  const afterBox = await composite.first().boundingBox();
  // The leaf rendered larger after the outward scale drag.
  expect(afterBox!.width).toBeGreaterThan(beforeBox!.width - 1);
});
```

> The auto-key control selector (`getByRole('checkbox', { name: /auto-key/i })`) must match the actual Timeline toggle. Before finalizing, grep the Timeline component for the auto-key control's accessible name and adjust the selector to match (`grep -rn "auto-key\|Auto-key\|autoKey" src/ui/components/Timeline`). If the toggle is a button, use `getByRole('button', { name: /auto-key/i })`. The assertion (handles visible + leaf grows on outward drag) is the contract; keep the selectors honest to the real DOM.

- [ ] **Step 2: Run the e2e test to verify it fails (then passes after Tasks 1–3)**

Since Tasks 1–3 are already implemented when this task runs, the test should PASS. Run:
Run: `npm run e2e -- symbols.spec.ts`
Expected: PASS (both the 47a test and the new 47b test). If the auto-key selector is wrong, fix it per the note above.

- [ ] **Step 3: Full-suite verification**

```bash
npm test
npm run typecheck
npm run lint
npm run e2e
```
Expected: all green. The engine/parity suites (`engine/symbol.test.ts`, `runtime/frame.test.ts`, `services/export/renderDocument.test.ts`) must be UNCHANGED and green — this slice touched no engine render code.

- [ ] **Step 4: Commit**

```bash
git add e2e/symbols.spec.ts
git commit -m "test(slice47b): e2e instance transform handles + scale internals"
```

---

## Self-Review

**1. Spec coverage** (slice47 spec §6 "Deferred to 47b (instance transform UI)"):
- scale/rotate **handles** + computed bbox **outline overlay** (needs `instanceAABB`) → Task 1 (`instanceAABB`) + Task 2 (`groupBounds` → handles + solid bbox rect). ✅
- **move-snapping** for instances → Task 3 (instance move branch with `instanceAABB` baseAABB + `entityAABB` targets; instance as a target for plain moves). ✅
- **live drag-preview of internals** (`previewInstanceChildren`, mirroring `previewGroupChildren`) → Task 2 (helper + scale/rotate) + Task 3 (move). ✅
- NOT in scope (correctly deferred to 47b-edit): double-click enter, scoped timeline/Stage, breadcrumb, internal selection. ✅

**2. Placeholder scan:** No TBD/TODO; every code step shows full code; every test step shows full test code. Two harness-dependent selectors (jsdom drag deltas, the e2e auto-key control name) carry explicit "verify against the real DOM and adjust" notes with the invariant assertion called out — these are calibration notes, not placeholders. ✅

**3. Type consistency:** `instanceAABB(instance, assets, time, seenAssets?)`, `sceneContentAABB(objects, assets, time, seenAssets?)`, `entityAABB(obj, objects, assets, time)`, `isSymbolInstance(obj, assets)`, `previewInstanceChildren(proj, instance, time, base)` are used identically across tasks. `previewInstanceChildren`'s `base` is a `Transform2D` (`{x,y,scaleX,scaleY,rotation,opacity}`) at every call site. `groupAABB`'s existing `(group, objects, assets, time, seen?)` signature is unchanged. ✅

**4. Parity invariant:** No file under `engine/`, `runtime/`, or `services/export/` is modified — all changes are in `Stage.tsx` and `snapping.ts` (editor chrome). The preview path's `previewInstanceChildren` reuses `applyFrame`→`computeFrame`, the same code the commit uses, so preview==committed by construction. ✅
