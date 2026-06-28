# Animated Boolean — Slice 1: Live-Boolean Geometry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `SceneObject.boolean` field makes an object a live boolean whose path is recomputed every frame by clipping its operands — rendered and animated in the editor on both scrub and RAF playback.

**Architecture:** Mirror morph's dual computation: a field on the object (`boolean`) drives a per-frame `d` computed in two coexisting places — the Stage's React render (scrub/static) and `computeFrame` (RAF playback/export-render) — both routed through one shared `resolveBooleanRings(project, obj, time)` helper over the existing `booleanOp` engine. Operands stay in the scene but are skipped as render leaves by `flattenInstances`.

**Tech Stack:** TypeScript (strict), React 18, Vitest + RTL, esbuild (runtime bundle), `polygon-clipping`.

## Global Constraints

- Root-scene booleans only (operands + result in the root scene); boolean-inside-symbol is out of scope.
- Operand semantics governed by **zOrder** (like the destructive op); `operandIds` order is irrelevant.
- The boolean node renders **world-space geometry under an identity transform** (Slice 1 fixtures give it identity); its movable transform/anchor is deferred.
- Non-boolean objects must render byte-identically to today (`o.boolean` absent → existing path).
- `computeFrame` MUST compute the boolean (editor RAF playback paints via it) → the runtime bundle gains `polygon-clipping`; regenerate `runtimeSource.generated.ts` via `pnpm build:runtime`.
- Reuse the existing `booleanOp(project, objs, op, time): PathData[]` (world-space rings) unchanged.
- Standalone-export INITIAL markup (`renderSvgDocument`) is NOT changed here (Slice 3).

---

### Task 1: Data model + `resolveBooleanRings`

**Files:**
- Modify: `src/engine/types.ts` (move `BoolOp` here; add `SceneObject.boolean` field)
- Modify: `src/engine/geom/boolean.ts` (re-export `BoolOp` from types; add `resolveBooleanRings`)
- Test: `src/engine/geom/boolean.test.ts`

**Interfaces:**
- Consumes: existing `booleanOp(project, objs, op, time): PathData[]`, `Project`, `SceneObject`, `PathData`.
- Produces:
  - `type BoolOp = 'union' | 'subtract' | 'intersect' | 'exclude'` (now defined in `types.ts`).
  - `SceneObject.boolean?: { op: BoolOp; operandIds: string[] }`
  - `function resolveBooleanRings(project: Project, booleanObj: SceneObject, time: number): PathData[]`

- [ ] **Step 1: Write the failing test**

```ts
// append to src/engine/geom/boolean.test.ts — reuses this file's existing rectObj/proj helpers
import { resolveBooleanRings } from './boolean';
import { createKeyframe } from '../project';

describe('resolveBooleanRings', () => {
  function liveUnionFixture() {
    // two overlapping rects; operand B animates x from 0 -> 30 over t in [0,1]
    const A = rectObj('la', 0, 20, 20, 0, 0); // 0..20
    const B = rectObj('lb', 1, 20, 20, 10, 0); // 10..30 at t=0
    B[0].tracks = { x: [createKeyframe(0, 10), createKeyframe(1, 40)] }; // moves right over time
    const boolAsset = createVectorAsset('path', { id: 'bool-a', path: { nodes: [], closed: false } });
    const boolObj = createSceneObject('bool-a', { id: 'boolobj', zOrder: 2, boolean: { op: 'union', operandIds: ['la', 'lb'] } });
    const project = { ...createProject(), objects: [A[0], B[0], boolObj], assets: [A[1], B[1], boolAsset] };
    return { project, boolObj };
  }

  it('clips the operands at the given time; result moves as an operand animates', () => {
    const { project, boolObj } = liveUnionFixture();
    const at0 = resolveBooleanRings(project, boolObj, 0);
    const at1 = resolveBooleanRings(project, boolObj, 1);
    expect(at0.length).toBeGreaterThan(0);
    expect(at1.length).toBeGreaterThan(0);
    const maxX = (rings: typeof at0) => Math.max(...rings.flatMap((r) => r.nodes.map((n) => n.anchor.x)));
    expect(maxX(at1)).toBeGreaterThan(maxX(at0)); // B moved right -> union footprint extends further right
  });

  it('returns [] when fewer than two operands resolve', () => {
    const { project, boolObj } = liveUnionFixture();
    boolObj.boolean = { op: 'union', operandIds: ['la', 'missing'] };
    expect(resolveBooleanRings(project, boolObj, 0)).toEqual([]);
  });

  it('returns [] for an object with no boolean field', () => {
    const { project } = liveUnionFixture();
    const plain = createSceneObject('bool-a', { id: 'plain' });
    expect(resolveBooleanRings({ ...project, objects: [...project.objects, plain] }, plain, 0)).toEqual([]);
  });
});
```

> Implementer: `rectObj`, `proj`, `createVectorAsset`, `createSceneObject`, `createProject` already exist in/are imported by `boolean.test.ts` (the curve-preserving + boolean-group tests use them). `createKeyframe` is from `../project`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/engine/geom/boolean.test.ts -t resolveBooleanRings`
Expected: FAIL — `resolveBooleanRings` not exported; `boolean` not a `SceneObject` field (typecheck error in the fixture).

- [ ] **Step 3: Move `BoolOp` to `types.ts` and add the field**

In `src/engine/types.ts`, add the type (near `VectorShapeType`) and the field on `SceneObject`:

```ts
export type BoolOp = 'union' | 'subtract' | 'intersect' | 'exclude';
```

```ts
// inside interface SceneObject, near shapeTrack:
/** When present, this object is a LIVE boolean node: its rendered path is computed every
 *  frame by clipping `operandIds` (root-scene object ids) with `op`. The object's VectorAsset
 *  supplies paint only; its `path` is an unused fallback. (Animated-boolean slice 1.) */
boolean?: { op: BoolOp; operandIds: string[] };
```

In `src/engine/geom/boolean.ts`, remove the local `export type BoolOp = …` definition and import
it from types for internal use. Do NOT re-export it: the engine index does both
`export * from './types'` and `export * from './geom/boolean'`, so re-exporting `BoolOp` from
`boolean.ts` would create a duplicate `export *` conflict that silently drops the name (breaking
`store.ts`'s `import { BoolOp } from '../../engine'`). With the definition in `types.ts`, the
index re-exports `BoolOp` via `export * from './types'` and all existing importers keep working.

```ts
// remove:  export type BoolOp = 'union' | 'subtract' | 'intersect' | 'exclude';
// add BoolOp to the existing type-import from '../types':
import type { Project, SceneObject, VectorAsset, PathData, PathPoint, PathNode, BoolOp } from '../types';
```

- [ ] **Step 4: Implement `resolveBooleanRings`**

```ts
// src/engine/geom/boolean.ts — add near booleanOp
/** The live boolean's result rings for `booleanObj` at `time`: resolve its operand objects
 *  from `project.objects` (root scene) by id, then clip via `booleanOp`. [] when fewer than two
 *  operands resolve (degenerate → caller renders nothing). */
export function resolveBooleanRings(project: Project, booleanObj: SceneObject, time: number): PathData[] {
  const spec = booleanObj.boolean;
  if (!spec) return [];
  const operands = spec.operandIds
    .map((id) => project.objects.find((o) => o.id === id))
    .filter((o): o is SceneObject => !!o);
  if (operands.length < 2) return [];
  return booleanOp(project, operands, spec.op, time);
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm vitest run src/engine/geom/boolean.test.ts` then `pnpm typecheck`
Expected: all boolean tests pass (incl. the 3 new); typecheck clean (BoolOp re-export keeps existing importers working).

- [ ] **Step 6: Commit**

```bash
git add src/engine/types.ts src/engine/geom/boolean.ts src/engine/geom/boolean.test.ts
git commit -m "feat(boolean): SceneObject.boolean field + resolveBooleanRings (live-boolean geometry)"
```

---

### Task 2: Operand non-render in `flattenInstances`

**Files:**
- Modify: `src/engine/symbol.ts` (`flattenInstances`)
- Test: `src/engine/symbol.test.ts`

**Interfaces:**
- Consumes: `SceneObject.boolean` (Task 1).
- Produces: `flattenInstances` skips objects that are any boolean's operand.

- [ ] **Step 1: Write the failing test**

```ts
// append to src/engine/symbol.test.ts — reuse its existing createProject/createSceneObject/createVectorAsset helpers
import { flattenInstances } from './symbol';

describe('flattenInstances — live-boolean operands', () => {
  it('skips a boolean operand as a render leaf but keeps the boolean and non-operand siblings', () => {
    const aAsset = createVectorAsset('rect', { id: 'a-asset' });
    const bAsset = createVectorAsset('rect', { id: 'b-asset' });
    const cAsset = createVectorAsset('rect', { id: 'c-asset' });
    const boolAsset = createVectorAsset('path', { id: 'bool-asset', path: { nodes: [], closed: false } });
    const a = createSceneObject('a-asset', { id: 'opA', zOrder: 0, shapeBase: { width: 10, height: 10 } });
    const b = createSceneObject('b-asset', { id: 'opB', zOrder: 1, shapeBase: { width: 10, height: 10 } });
    const c = createSceneObject('c-asset', { id: 'sibling', zOrder: 2, shapeBase: { width: 10, height: 10 } });
    const boolObj = createSceneObject('bool-asset', { id: 'boolobj', zOrder: 3, boolean: { op: 'union', operandIds: ['opA', 'opB'] } });
    const project = { ...createProject(), objects: [a, b, c, boolObj], assets: [aAsset, bAsset, cAsset, boolAsset] };
    const ids = flattenInstances(project, 0).map((l) => l.renderId);
    expect(ids).toContain('boolobj'); // the boolean renders
    expect(ids).toContain('sibling'); // a non-operand sibling renders
    expect(ids).not.toContain('opA'); // operands are not drawn directly
    expect(ids).not.toContain('opB');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/engine/symbol.test.ts -t "live-boolean operands"`
Expected: FAIL — `opA`/`opB` still appear as leaves.

- [ ] **Step 3: Implement the operand-skip gate**

In `src/engine/symbol.ts` `flattenInstances`, precompute the consumed set once (at the top, after `const leaves = []`) and add the gate beside the existing `isRenderHidden` check (symbol.ts:109):

```ts
// after: const leaves: InstanceLeaf[] = [];
const consumed = new Set(project.objects.flatMap((o) => o.boolean?.operandIds ?? []));
```

```ts
// in the walk loop, right after the `if (isRenderHidden(o, objectsById)) continue;` line:
if (consumed.has(o.id)) continue; // a live boolean's operand: sampled for the clip, not drawn directly
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/engine/symbol.test.ts` then `pnpm typecheck`
Expected: pass (incl. existing symbol tests — parity); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/engine/symbol.ts src/engine/symbol.test.ts
git commit -m "feat(boolean): flattenInstances skips live-boolean operands as render leaves"
```

---

### Task 3: `computeFrame` boolean branch + regenerate runtime bundle

**Files:**
- Modify: `src/runtime/frame.ts` (`computeFrame`)
- Test: `src/runtime/frame.test.ts`
- Regenerate: `src/runtime/runtimeSource.generated.ts` (via `pnpm build:runtime`)

**Interfaces:**
- Consumes: `resolveBooleanRings` (Task 1), existing `pathToDRings`.
- Produces: `computeFrame` sets `item.pathD` for a boolean leaf from the clipped rings at the frame's time.

- [ ] **Step 1: Write the failing test**

```ts
// append to src/runtime/frame.test.ts — mirror its existing morph pathD test (it imports createProject/
// createSceneObject/createVectorAsset/createKeyframe and computeFrame). Build the same live-union fixture.
import { computeFrame } from './frame';

describe('computeFrame — live boolean', () => {
  it('sets the boolean leaf pathD to the clipped result, and it changes as an operand animates', () => {
    const aAsset = createVectorAsset('rect', { id: 'a-asset' });
    const bAsset = createVectorAsset('rect', { id: 'b-asset' });
    const boolAsset = createVectorAsset('path', { id: 'bool-asset', path: { nodes: [], closed: false } });
    const a = createSceneObject('a-asset', { id: 'opA', zOrder: 0, shapeBase: { width: 20, height: 20 } });
    const b = createSceneObject('b-asset', { id: 'opB', zOrder: 1, shapeBase: { width: 20, height: 20 }, tracks: { x: [createKeyframe(0, 10), createKeyframe(1, 40)] } });
    const boolObj = createSceneObject('bool-asset', { id: 'boolobj', zOrder: 2, boolean: { op: 'union', operandIds: ['opA', 'opB'] } });
    const project = { ...createProject(), objects: [a, b, boolObj], assets: [aAsset, bAsset, boolAsset] };

    const frame0 = computeFrame(project, 0).find((it) => it.objectId === 'boolobj')!;
    const frame1 = computeFrame(project, 1).find((it) => it.objectId === 'boolobj')!;
    expect(frame0.pathD).toBeTruthy();
    expect(frame1.pathD).toBeTruthy();
    expect(frame1.pathD).not.toBe(frame0.pathD); // the live boolean animates
    // operands are not emitted as their own frame items
    expect(computeFrame(project, 0).some((it) => it.objectId === 'opA')).toBe(false);
  });
});
```

> Implementer: confirm `frame.test.ts` already imports `createProject`/`createSceneObject`/`createVectorAsset`/`createKeyframe` (its morph test uses them); add any missing import from `../engine`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/runtime/frame.test.ts -t "live boolean"`
Expected: FAIL — boolean leaf `pathD` is empty/from the fallback path, not the clipped result.

- [ ] **Step 3: Implement the `computeFrame` boolean branch**

In `src/runtime/frame.ts`: add imports and the branch. Add `pathToDRings` to the `../engine` import and `resolveBooleanRings`:

```ts
// in the import from '../engine' (currently has pathToD), add:
pathToDRings,
resolveBooleanRings,
```

Replace the `if (state.path) { item.pathD = pathToD(state.path); }` block (frame.ts:62-64) with:

```ts
if (obj.boolean) {
  const rings = resolveBooleanRings(project, obj, leaf.localTime);
  item.pathD = rings.length > 0 ? pathToDRings(rings[0], rings.slice(1)) : '';
} else if (state.path) {
  item.pathD = pathToD(state.path);
}
```

- [ ] **Step 4: Run the test + full frame/engine suites**

Run: `pnpm vitest run src/runtime/frame.test.ts` then `pnpm typecheck`
Expected: pass (incl. existing morph/geometry frame tests — parity); typecheck clean.

- [ ] **Step 5: Regenerate the runtime bundle + export parity**

Run: `pnpm build:runtime`
Then: `pnpm vitest run src/services/export/exportProject.test.ts`
Expected: `runtimeSource.generated.ts` is rewritten (now bundles `polygon-clipping`); the export test passes (non-boolean export unaffected — if it snapshots/asserts bundle CONTENT, update the snapshot to the regenerated bundle; do NOT weaken a behavioral assertion).

- [ ] **Step 6: Commit**

```bash
git add src/runtime/frame.ts src/runtime/frame.test.ts src/runtime/runtimeSource.generated.ts
git commit -m "feat(boolean): computeFrame computes live-boolean pathD per frame; regen runtime bundle"
```

---

### Task 4: Stage React-render boolean branch

**Files:**
- Modify: `src/ui/components/Stage/Stage.tsx` (path-object render branch ~1885)
- Test: `src/ui/components/Stage/Stage.test.tsx`

**Interfaces:**
- Consumes: `resolveBooleanRings` (Task 1), existing `pathToDRings`, the Stage's `project` (Stage.tsx:127) and `time`.
- Produces: a live boolean's `<path>` renders the clipped `d` at the current playhead (scrub/static).

- [ ] **Step 1: Write the failing test**

```ts
// append to src/ui/components/Stage/Stage.test.tsx — reuse stubIdentityCTM/render/act/createProject/
// createSceneObject/createVectorAsset/createKeyframe (already imported)
it('renders a live boolean and its d changes as the playhead scrubs over an animated operand', () => {
  stubIdentityCTM();
  useEditor.getState().newProject();
  const aAsset = createVectorAsset('rect', { id: 'a-asset' });
  const bAsset = createVectorAsset('rect', { id: 'b-asset' });
  const boolAsset = createVectorAsset('path', { id: 'bool-asset', path: { nodes: [], closed: false } });
  const a = createSceneObject('a-asset', { id: 'opA', zOrder: 0, shapeBase: { width: 20, height: 20 } });
  const b = createSceneObject('b-asset', { id: 'opB', zOrder: 1, shapeBase: { width: 20, height: 20 }, tracks: { x: [createKeyframe(0, 10), createKeyframe(1, 40)] } });
  const boolObj = createSceneObject('bool-asset', { id: 'boolobj', zOrder: 2, boolean: { op: 'union', operandIds: ['opA', 'opB'] } });
  const project = createProject();
  project.assets = [aAsset, bAsset, boolAsset];
  project.objects = [a, b, boolObj];
  act(() => { useEditor.getState().commit(project); useEditor.getState().seek(0); });
  const nodes = new Map<string, SVGGraphicsElement>();
  const { container } = render(<Stage nodes={nodes} />);
  const boolPath = () => container.querySelector('[data-savig-object="boolobj"] path')!.getAttribute('d');
  const d0 = boolPath();
  act(() => { useEditor.getState().seek(1); });
  expect(boolPath()).not.toBe(d0); // the boolean re-renders as the operand animates
  // operands draw no node of their own
  expect(container.querySelector('[data-savig-object="opA"]')).toBeNull();
  expect(container.querySelector('[data-savig-object="opB"]')).toBeNull();
});
```

> Implementer: match the import list / helper names already used in `Stage.test.tsx` (it imports `render`/`act`/`createProject`/`createSceneObject`/`createVectorAsset` and likely `createKeyframe`; add `createKeyframe` from `../../../engine` if missing). `seek` is the store action used by other tests to move the playhead.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx -t "live boolean"`
Expected: FAIL — the boolean renders its empty/fallback `asset.path` `d`, unchanged across seeks.

- [ ] **Step 3: Implement the Stage render branch**

In `src/ui/components/Stage/Stage.tsx`, the path-object branch (Stage.tsx:1885-1900). Compute the rings once for the leaf (just before the `<path>`), and use them in `d`/`fillRule`:

```tsx
const boolRings = o.boolean ? resolveBooleanRings(project, o, time) : null;
```

```tsx
<path
  d={
    boolRings
      ? (boolRings.length > 0 ? pathToDRings(boolRings[0], boolRings.slice(1)) : '')
      : o.shapeTrack && o.shapeTrack.length > 0
        ? pathToD(samplePath(o.shapeTrack, time))
        : asset.path
          ? pathToDRings(asset.path, asset.compoundRings)
          : ''
  }
  fillRule={
    boolRings ? 'evenodd' : asset.compoundRings && asset.compoundRings.length > 0 ? 'evenodd' : undefined
  }
  // …fill/stroke/strokeWidth/etc. unchanged…
/>
```

Add `resolveBooleanRings` to the `../../../engine` import in `Stage.tsx` (it already imports `pathToDRings`/`pathToD`/`samplePath`).

- [ ] **Step 4: Run the test + full Stage suite**

Run: `pnpm vitest run src/ui/components/Stage/Stage.test.tsx` then `pnpm typecheck`
Expected: pass (incl. existing Stage tests — parity); typecheck clean.

- [ ] **Step 5: Full unit suite + lint**

Run: `pnpm test` then `pnpm exec eslint src/engine/types.ts src/engine/geom/boolean.ts src/engine/symbol.ts src/runtime/frame.ts src/ui/components/Stage/Stage.tsx`
Expected: full suite green; lint clean on changed files.

- [ ] **Step 6: Commit**

```bash
git add src/ui/components/Stage/Stage.tsx src/ui/components/Stage/Stage.test.tsx
git commit -m "feat(stage): render live-boolean path at the playhead (scrub); operands draw no node"
```

---

## Self-Review

**Spec coverage:**
- `SceneObject.boolean` field + `BoolOp` (no cycle) → Task 1. ✓
- `resolveBooleanRings` shared resolver → Task 1. ✓
- Operand non-render (`flattenInstances` gate) → Task 2. ✓
- `computeFrame` boolean `pathD` (RAF playback/export-render) → Task 3. ✓
- Runtime bundle regenerated (clipper shipped) + export parity → Task 3. ✓
- Stage React render branch (scrub/static) → Task 4. ✓
- Dual computation routed through one resolver (no drift) → Tasks 3 + 4 both call `resolveBooleanRings`. ✓
- Edge cases (<2 operands, empty clip, non-boolean parity) → Task 1 tests + parity runs. ✓
- Testing: resolver unit, flatten unit, computeFrame unit, Stage RTL, export parity → Tasks 1-4. ✓

**Placeholder scan:** No TBD/TODO. Test fixtures reuse each file's existing helpers, flagged inline with full assertion bodies.

**Type consistency:** `BoolOp`, `SceneObject.boolean?: { op: BoolOp; operandIds: string[] }`, `resolveBooleanRings(project, booleanObj, time): PathData[]` are named/typed identically across tasks. `BoolOp` lives in `types.ts` (Task 1); the engine index exports it via `export * from './types'`, so existing importers (`store.ts`) are unchanged — `boolean.ts` imports it for internal use without re-exporting (avoids a duplicate `export *` conflict).

## Notes / Risks
- The dual computation (Stage render + `computeFrame`) is the same duplication morph already has; both call `resolveBooleanRings` so they cannot drift (root-scene `leaf.localTime === time`).
- Regenerating the runtime bundle grows it by `polygon-clipping` — accepted; measured in Slice 3. If `exportProject.test` asserts bundle content, update the snapshot, never weaken a behavioral assertion.
- A standalone export does not yet render a boolean (initial markup is Slice 3); Slice 1's deliverable is editor render + animation.
