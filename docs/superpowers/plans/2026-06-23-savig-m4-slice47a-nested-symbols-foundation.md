# Nested Symbols — 47a Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce reusable animated *symbols* — a new `SymbolAsset` whose self-contained scene is instanced by ordinary `SceneObject`s — with a single recursive scene-walker (`flattenInstances`) that all three render consumers share, plus a `createSymbol` authoring action.

**Architecture:** A symbol instance is a `SceneObject` whose `assetId` points at a `SymbolAsset` (parallel to SVG-asset objects). One shared `flattenInstances(project, time)` walks every scene, skips group containers (folding their `groupTransformPrefix` into descendants), expands symbol instances (composing transform + opacity, namespacing ids, cycle-guarded), and emits drawable leaves. `computeFrame`, `renderDocument`, and the editor Stage skeleton all consume those leaves, preserving the preview==export parity invariant.

**Tech Stack:** TypeScript, React 18, Zustand, Vitest (unit), Playwright (e2e). No new dependencies.

## Global Constraints

- **Preview == export.** `computeFrame` (editor painter) and `renderSvgDocument` (export) must emit identical geometry; a parity test pins them. Every render change must keep it green.
- **A symbol-free project must render byte-identical to today.** `flattenInstances` of a project with no `SymbolAsset` yields exactly the prior flat, zOrder-ordered, group-composed scene.
- **No new dependencies.** Pure TS + existing engine helpers.
- **47a samples internal scenes at GLOBAL time** (`localTime = time`); the time-remap seam is `InstanceLeaf.localTime`, isolated for 47c. Do NOT add per-instance timeline fields in this slice.
- **Instances are atomic in 47a** (selected/moved as one object, like a group); individual internals are not selectable (that is 47b).
- **TDD, frequent commits, exact paths.** Tests live beside the unit (`*.test.ts(x)`). Run `npm test` (Vitest) and `npm run e2e` (Playwright).
- **Commit message footer:** end every commit body with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

- `src/engine/types.ts` — add `SymbolAsset` to the `Asset` union (modify).
- `src/engine/project.ts` — add `createSymbolAsset` factory (modify).
- `src/engine/groupTransform.ts` — refactor `parentGroupOf`/`groupTransformPrefix` to take a scene `objects: SceneObject[]` instead of `Project` (modify).
- `src/engine/symbol.ts` — **new**: `InstanceLeaf` + `flattenInstances` (the single scene-walker).
- `src/engine/symbol.test.ts` — **new**: walker unit tests.
- `src/engine/index.ts` — re-export the new symbol API + `SymbolAsset` (modify).
- `src/runtime/frame.ts` — `computeFrame` consumes `flattenInstances` (modify).
- `src/services/export/renderDocument.ts` — `renderSvgDocument` consumes `flattenInstances` (modify).
- `src/ui/components/Stage/Stage.tsx` — render the leaf skeleton keyed by `renderId` (modify).
- `src/ui/store/store.ts` — `createSymbol` action (modify).
- `src/ui/components/Inspector/Inspector.tsx` — "Create Symbol" button (modify).
- e2e: `e2e/symbols.spec.ts` — **new** (match the existing e2e dir/naming).

---

### Task 1: `SymbolAsset` type + factory

**Files:**
- Modify: `src/engine/types.ts` (the `Asset` union, ~line 281)
- Modify: `src/engine/project.ts` (new factory near `createVectorAsset`, ~line 100)
- Modify: `src/engine/index.ts` (export `createSymbolAsset`; `SymbolAsset` flows through the `types` re-export)
- Test: `src/engine/project.test.ts`

**Interfaces:**
- Produces: `interface SymbolAsset { id: string; kind: 'symbol'; name: string; objects: SceneObject[]; width: number; height: number; duration: number }`; `type Asset = SvgAsset | AudioAsset | VectorAsset | SymbolAsset`; `createSymbolAsset(overrides?: Partial<SymbolAsset>): SymbolAsset`.

- [ ] **Step 1: Write the failing test** — append to `src/engine/project.test.ts`:

```ts
import { createSymbolAsset } from './project';

describe('createSymbolAsset', () => {
  it('creates an empty symbol asset with defaults and a uuid', () => {
    const s = createSymbolAsset();
    expect(s.kind).toBe('symbol');
    expect(s.objects).toEqual([]);
    expect(s.id).toMatch(/[0-9a-f-]{8,}/);
    expect(typeof s.duration).toBe('number');
  });
  it('applies overrides', () => {
    const s = createSymbolAsset({ name: 'Spinner', width: 120, height: 80 });
    expect(s.name).toBe('Spinner');
    expect(s.width).toBe(120);
    expect(s.height).toBe(80);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/engine/project.test.ts`
Expected: FAIL — `createSymbolAsset is not a function`.

- [ ] **Step 3: Implement.** In `src/engine/types.ts`, add the interface above the `Asset` union and extend it:

```ts
export interface SymbolAsset {
  id: string; // uuid
  kind: 'symbol';
  name: string;
  /** The symbol's self-contained scene graph. parentId references resolve WITHIN this list. */
  objects: SceneObject[];
  /** Intrinsic content size (library thumbnail / future clip). Not a hard clip in 47a. */
  width: number;
  height: number;
  /** The symbol's own timeline length (seconds). Informational in 47a; authoritative at 47c. */
  duration: number;
}

export type Asset = SvgAsset | AudioAsset | VectorAsset | SymbolAsset;
```

In `src/engine/project.ts`, add after `createVectorAsset`:

```ts
export function createSymbolAsset(overrides: Partial<SymbolAsset> = {}): SymbolAsset {
  return {
    id: newId(),
    kind: 'symbol',
    name: 'Symbol',
    objects: [],
    width: 0,
    height: 0,
    duration: 0,
    ...overrides,
  };
}
```

Add `SymbolAsset` to the `types` import in `project.ts`. In `src/engine/index.ts`, add `createSymbolAsset` to the `./project` re-export (and confirm `SymbolAsset` is exported via the `./types` re-export).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/engine/project.test.ts`
Expected: PASS. Also run `npm run typecheck` — expect any `switch (asset.kind)` exhaustiveness errors to surface; if the compiler flags a non-exhaustive `kind` switch, that is caught in Tasks 4/5 where those consumers change. If typecheck fails ONLY in `frame.ts`/`renderDocument.ts`/`Stage.tsx`, that is expected pre-Task-4; proceed.

- [ ] **Step 5: Commit**

```bash
git add src/engine/types.ts src/engine/project.ts src/engine/index.ts src/engine/project.test.ts
git commit -m "feat(slice47a): SymbolAsset type + createSymbolAsset factory

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Refactor `groupTransformPrefix`/`parentGroupOf` to a scene `objects[]`

A pure refactor so the walker can compute group prefixes inside a symbol scene. Keeps every existing consumer green by passing `project.objects`.

**Files:**
- Modify: `src/engine/groupTransform.ts` (signatures of `parentGroupOf`, `groupTransformPrefix`)
- Modify: `src/runtime/frame.ts:52` and `src/services/export/renderDocument.ts:47` (call sites pass `project.objects`)
- Test: `src/engine/groupTransform.test.ts`

**Interfaces:**
- Produces: `parentGroupOf(objects: SceneObject[], obj: SceneObject): SceneObject | null`; `groupTransformPrefix(objects: SceneObject[], obj: SceneObject, time: number): string`.
- Consumes: nothing new.

- [ ] **Step 1: Update the failing test.** In `src/engine/groupTransform.test.ts`, change every `parentGroupOf(project, ...)` / `groupTransformPrefix(project, ...)` call to pass `project.objects`. Add one explicit assertion that the scene-list form works without a `Project`:

```ts
it('computes a group prefix from a bare objects list', () => {
  // build `objects` = [group, child] as in the existing fixtures, then:
  expect(groupTransformPrefix(objects, child, 0)).toContain('translate');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/engine/groupTransform.test.ts`
Expected: FAIL — current signature takes `Project`, so `objects` (an array) has no `.objects`.

- [ ] **Step 3: Implement.** In `src/engine/groupTransform.ts`:

```ts
export function parentGroupOf(objects: SceneObject[], obj: SceneObject): SceneObject | null {
  if (!obj.parentId) return null;
  const g = objects.find((o) => o.id === obj.parentId && o.isGroup);
  return g ?? null;
}

export function groupTransformPrefix(objects: SceneObject[], obj: SceneObject, time: number): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  let cur = parentGroupOf(objects, obj);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    parts.push(buildTransform(sampleObject(cur, time), cur.anchorX, cur.anchorY));
    cur = parentGroupOf(objects, cur);
  }
  return parts.reverse().join(' ');
}
```

Remove the now-unused `Project` import if nothing else in the file needs it (keep `SceneObject`). Update the two call sites:
- `src/runtime/frame.ts:52`: `const prefix = groupTransformPrefix(project.objects, obj, time);`
- `src/services/export/renderDocument.ts:47`: `const groupPrefix = groupTransformPrefix(project.objects, obj, 0);`

(`bakeGroupIntoChild`/`unbakeGroupFromChild`/`isRenderHidden`/`mapPoint` keep their signatures — only the two scene-walk helpers change. Check other call sites with: `grep -rn "groupTransformPrefix\|parentGroupOf" src/` and update each to pass `.objects`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/engine/groupTransform.test.ts && npm test -- src/runtime/frame.test.ts && npm test -- src/services/export/renderDocument.test.ts`
Expected: PASS (no behavior change — same arguments, unwrapped).

- [ ] **Step 5: Commit**

```bash
git add src/engine/groupTransform.ts src/runtime/frame.ts src/services/export/renderDocument.ts src/engine/groupTransform.test.ts
git commit -m "refactor(slice47a): groupTransformPrefix/parentGroupOf take a scene objects[]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `flattenInstances` scene-walker

The heart of the slice. One recursive walker → ordered drawable leaves.

**Files:**
- Create: `src/engine/symbol.ts`
- Create: `src/engine/symbol.test.ts`
- Modify: `src/engine/index.ts` (export `flattenInstances`, `InstanceLeaf`)

**Interfaces:**
- Consumes: `buildTransform` (transform.ts), `sampleObject` (sample.ts), `groupTransformPrefix`/`isRenderHidden` (groupTransform.ts, scene-list form from Task 2).
- Produces: `interface InstanceLeaf { renderId: string; object: SceneObject; transformPrefix: string; opacityFactor: number; localTime: number }`; `flattenInstances(project: Project, time: number): InstanceLeaf[]`.

- [ ] **Step 1: Write the failing test** — `src/engine/symbol.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { flattenInstances } from './symbol';
import { createProject, createSceneObject, createSymbolAsset, createVectorAsset } from './project';
import type { Project } from './types';

// Helper: a rect object at zOrder z with id.
function rect(id: string, z: number, x = 0): ReturnType<typeof createSceneObject> {
  const o = createSceneObject({ id, name: id, assetId: `asset-${id}`, zOrder: z });
  o.base.x = x;
  return o;
}

it('a symbol-free project flattens to its objects in zOrder (parity)', () => {
  const p = createProject();
  p.assets = [createVectorAsset('rect', { id: 'asset-b' }), createVectorAsset('rect', { id: 'asset-a' })];
  p.objects = [rect('b', 2), rect('a', 1)];
  const leaves = flattenInstances(p, 0);
  expect(leaves.map((l) => l.renderId)).toEqual(['a', 'b']);
  expect(leaves.every((l) => l.transformPrefix === '' && l.opacityFactor === 1 && l.localTime === 0)).toBe(true);
});

it('expands a symbol instance into composite-id leaves with a composed prefix', () => {
  const inner = createVectorAsset('rect', { id: 'asset-inner' });
  const innerObj = createSceneObject({ id: 'inner', name: 'inner', assetId: 'asset-inner', zOrder: 1 });
  const sym = createSymbolAsset({ id: 'sym-1', objects: [innerObj] });
  const p = createProject();
  p.assets = [inner, sym];
  const instance = createSceneObject({ id: 'inst', name: 'inst', assetId: 'sym-1', zOrder: 1 });
  instance.base.x = 50; // instance translation must appear in the leaf prefix
  p.objects = [instance];
  const leaves = flattenInstances(p, 0);
  expect(leaves).toHaveLength(1);
  expect(leaves[0].renderId).toBe('inst/inner');
  expect(leaves[0].object.id).toBe('inner');
  expect(leaves[0].transformPrefix).toContain('translate(50');
});

it('multiplies opacity down the instance chain', () => {
  const inner = createVectorAsset('rect', { id: 'asset-inner' });
  const innerObj = createSceneObject({ id: 'inner', name: 'inner', assetId: 'asset-inner', zOrder: 1 });
  const sym = createSymbolAsset({ id: 'sym-1', objects: [innerObj] });
  const p = createProject();
  p.assets = [inner, sym];
  const instance = createSceneObject({ id: 'inst', name: 'inst', assetId: 'sym-1', zOrder: 1 });
  instance.base.opacity = 0.5;
  p.objects = [instance];
  expect(flattenInstances(p, 0)[0].opacityFactor).toBeCloseTo(0.5);
});

it('cycle-guards a self-referential symbol (finite, drops the cyclic branch)', () => {
  const sym = createSymbolAsset({ id: 'sym-1', objects: [] });
  // sym contains an instance of itself
  const selfInstance = createSceneObject({ id: 'self', name: 'self', assetId: 'sym-1', zOrder: 1 });
  sym.objects = [selfInstance];
  const p = createProject();
  p.assets = [sym];
  const top = createSceneObject({ id: 'top', name: 'top', assetId: 'sym-1', zOrder: 1 });
  p.objects = [top];
  expect(() => flattenInstances(p, 0)).not.toThrow();
  expect(flattenInstances(p, 0)).toEqual([]); // top expands; inner self is cycle-skipped
});

it('skips group containers but folds their transform into children (parity with computeFrame)', () => {
  const p = createProject();
  p.assets = [createVectorAsset('rect', { id: 'asset-c' })];
  const group = createSceneObject({ id: 'g', name: 'g', assetId: '', zOrder: 1 });
  group.isGroup = true;
  group.base.x = 10;
  const child = createSceneObject({ id: 'c', name: 'c', assetId: 'asset-c', zOrder: 1, parentId: 'g' });
  p.objects = [group, child];
  const leaves = flattenInstances(p, 0);
  expect(leaves.map((l) => l.renderId)).toEqual(['c']); // group is not a leaf
  expect(leaves[0].transformPrefix).toContain('translate(10');
});
```

(If `createSceneObject`'s signature differs from the `{ id, name, assetId, zOrder, parentId }` options object used here, adapt these fixtures to its real shape — check `src/engine/project.ts:64` first. The assertions stay the same.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/engine/symbol.test.ts`
Expected: FAIL — `flattenInstances` not found.

- [ ] **Step 3: Implement** — `src/engine/symbol.ts`:

```ts
// The single scene-walker for instance composition (slice 47a). Walks every scene
// (top-level + each symbol's objects[]), skips group containers (folding their transform
// into descendants via groupTransformPrefix) and render-hidden objects, expands symbol
// instances (composing transform + opacity, namespacing ids), and emits drawable leaves.
// Shared by computeFrame, renderDocument, and the editor Stage so preview == export.
import { buildTransform } from './transform';
import { sampleObject } from './sample';
import { groupTransformPrefix, isRenderHidden } from './groupTransform';
import type { Project, SceneObject } from './types';

export interface InstanceLeaf {
  renderId: string;
  object: SceneObject;
  transformPrefix: string;
  opacityFactor: number;
  localTime: number;
}

export function flattenInstances(project: Project, time: number): InstanceLeaf[] {
  const assetsById = new Map(project.assets.map((a) => [a.id, a] as const));
  const leaves: InstanceLeaf[] = [];

  const walk = (
    objects: SceneObject[],
    localTime: number,
    basePrefix: string,
    idPrefix: string,
    opacity: number,
    visited: Set<string>,
  ): void => {
    const objectsById = new Map(objects.map((o) => [o.id, o] as const));
    const ordered = objects
      .map((o, i) => ({ o, i }))
      .sort((a, b) => a.o.zOrder - b.o.zOrder || a.i - b.i);
    for (const { o } of ordered) {
      if (o.isGroup) continue; // its transform reaches children via groupTransformPrefix
      if (isRenderHidden(o, objectsById)) continue; // self-hidden or under a hidden group
      const groupPrefix = groupTransformPrefix(objects, o, localTime);
      const fullPrefix = [basePrefix, groupPrefix].filter(Boolean).join(' ');
      const renderId = idPrefix ? `${idPrefix}/${o.id}` : o.id;
      const asset = assetsById.get(o.assetId);
      if (asset && asset.kind === 'symbol') {
        if (visited.has(asset.id)) continue; // cycle guard: a symbol cannot contain itself
        const st = sampleObject(o, localTime);
        const instTransform = [fullPrefix, buildTransform(st, o.anchorX, o.anchorY)]
          .filter(Boolean)
          .join(' ');
        const nextVisited = new Set(visited);
        nextVisited.add(asset.id);
        walk(asset.objects, localTime, instTransform, renderId, opacity * st.opacity, nextVisited);
      } else {
        leaves.push({ renderId, object: o, transformPrefix: fullPrefix, opacityFactor: opacity, localTime });
      }
    }
  };

  walk(project.objects, time, '', '', 1, new Set());
  return leaves;
}
```

Export from `src/engine/index.ts`: add `export { flattenInstances } from './symbol';` and `export type { InstanceLeaf } from './symbol';`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/engine/symbol.test.ts`
Expected: PASS (all five cases).

- [ ] **Step 5: Commit**

```bash
git add src/engine/symbol.ts src/engine/symbol.test.ts src/engine/index.ts
git commit -m "feat(slice47a): flattenInstances scene-walker (instance + group composition)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `computeFrame` consumes `flattenInstances`

**Files:**
- Modify: `src/runtime/frame.ts` (`computeFrame`, lines 36–79)
- Test: `src/runtime/frame.test.ts`

**Interfaces:**
- Consumes: `flattenInstances`, `InstanceLeaf` (Task 3).
- Produces: `computeFrame(project, time)` unchanged signature; each `FrameItem.objectId` is now a `renderId` (== object id for non-instanced objects).

- [ ] **Step 1: Write the failing test** — append to `src/runtime/frame.test.ts`:

```ts
import { createSymbolAsset } from '../engine';

it('computeFrame expands a symbol instance into composite-id frame items', () => {
  // Reuse this file's existing project builder; if none, build inline like symbol.test.ts.
  const inner = createVectorAsset('rect', { id: 'asset-inner' }); // adapt to local helpers
  const innerObj = createSceneObject({ id: 'inner', name: 'inner', assetId: 'asset-inner', zOrder: 1 });
  const sym = createSymbolAsset({ id: 'sym-1', objects: [innerObj] });
  const instance = createSceneObject({ id: 'inst', name: 'inst', assetId: 'sym-1', zOrder: 1 });
  instance.base.x = 50;
  const p = createProject();
  p.assets = [inner, sym];
  p.objects = [instance];
  const items = computeFrame(p, 0);
  expect(items.map((it) => it.objectId)).toEqual(['inst/inner']);
  expect(items[0].transform).toContain('translate(50');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/runtime/frame.test.ts`
Expected: FAIL — today's `computeFrame` keys items by `state.objectId` (`'inner'`) and never composes the instance transform.

- [ ] **Step 3: Implement.** Replace the body of `computeFrame` so it iterates `flattenInstances` leaves. Keep ALL existing per-object resolution (geometry/path/color/gradient/dash); only the source object, id, transform-prefix and opacity change:

```ts
export function computeFrame(project: Project, time: number): FrameItem[] {
  const assetsById = new Map(project.assets.map((a) => [a.id, a] as const));
  return flattenInstances(project, time)
    .map((leaf): FrameItem | null => {
      const obj = leaf.object;
      const state = sampleObject(obj, leaf.localTime);
      const asset = assetsById.get(obj.assetId);
      const shapeType = asset && asset.kind === 'vector' ? asset.shapeType : undefined;
      const pathBox =
        asset && asset.kind === 'vector' && asset.shapeType === 'path'
          ? pathBounds(state.path ?? asset.path ?? { nodes: [], closed: false })
          : undefined;
      const { anchorX, anchorY } = resolveAnchor(obj, state, shapeType, pathBox);
      const item: FrameItem = {
        objectId: leaf.renderId,
        transform: (leaf.transformPrefix ? leaf.transformPrefix + ' ' : '') + buildTransform(state, anchorX, anchorY),
        opacity: fmt(state.opacity * leaf.opacityFactor),
      };
      if (shapeType && shapeType !== 'path' && state.geometry) {
        item.geometry = geometryToSvgAttrs(shapeType, state.geometry);
      }
      if (state.path) item.pathD = pathToD(state.path);
      const hasFillGradient =
        (asset?.kind === 'vector' && !!asset.style.fillGradient) || state.fillGradient !== undefined;
      const hasStrokeGradient =
        (asset?.kind === 'vector' && !!asset.style.strokeGradient) || state.strokeGradient !== undefined;
      if (state.fill !== undefined && !hasFillGradient) item.fill = state.fill;
      if (state.stroke !== undefined && !hasStrokeGradient) item.stroke = state.stroke;
      if (state.fillGradient !== undefined) item.fillGradient = state.fillGradient;
      if (state.strokeGradient !== undefined) item.strokeGradient = state.strokeGradient;
      if (state.strokeDashoffset !== undefined) item.strokeDashoffset = fmt(state.strokeDashoffset);
      return item;
    })
    .filter((it): it is FrameItem => it !== null);
}
```

Update the imports at the top of `frame.ts`: add `flattenInstances`, `sampleObject`, `buildTransform`, `resolveAnchor`, `pathBounds`, `pathToD`, `geometryToSvgAttrs`, `fmt` from `'../engine'` (most already imported); REMOVE the now-unused `groupTransformPrefix` and `sampleProject` imports. The `isGroup` skip and the per-item `groupTransformPrefix`/`resolveAnchor` block are gone — the walker handled grouping and the leaf provides the prefix. The gradient `<defs>` reference ids stay `savig-grad-${objectId}-fill` but MUST now use `leaf.renderId` for uniqueness across instances: change `applyGradientToElement` callers in `applyFrameToNodes` only if ids are derived there — they read `item.objectId`, which is already `renderId`, so no change needed.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/runtime/frame.test.ts`
Expected: PASS (existing flat-scene cases unchanged; new instance case green).

- [ ] **Step 5: Commit**

```bash
git add src/runtime/frame.ts src/runtime/frame.test.ts
git commit -m "feat(slice47a): computeFrame composes symbol instances via flattenInstances

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `renderSvgDocument` consumes `flattenInstances` (+ parity)

**Files:**
- Modify: `src/services/export/renderDocument.ts` (body builder, lines 40–97)
- Test: `src/services/export/renderDocument.test.ts`

**Interfaces:**
- Consumes: `flattenInstances` (Task 3).
- Produces: `renderSvgDocument(project)` unchanged signature; body `<g>`/`<use>` `data-savig-object` ids are now `renderId`s.

- [ ] **Step 1: Write the failing test** — append to `renderDocument.test.ts` a parity + instance assertion:

```ts
import { computeFrame } from '../../runtime/frame';
import { createSymbolAsset } from '../../engine';

it('export parity: each body node transform matches computeFrame for an instance', () => {
  const inner = createVectorAsset('rect', { id: 'asset-inner', shapeType: 'rect' });
  const innerObj = createSceneObject({ id: 'inner', name: 'inner', assetId: 'asset-inner', zOrder: 1 });
  innerObj.shapeBase = { width: 10, height: 10 };
  const sym = createSymbolAsset({ id: 'sym-1', objects: [innerObj] });
  const instance = createSceneObject({ id: 'inst', name: 'inst', assetId: 'sym-1', zOrder: 1 });
  instance.base.x = 50;
  const p = createProject();
  p.assets = [inner, sym];
  p.objects = [instance];
  const svg = renderSvgDocument(p);
  expect(svg).toContain('data-savig-object="inst/inner"');
  const item = computeFrame(p, 0).find((i) => i.objectId === 'inst/inner')!;
  expect(svg).toContain(`transform="${item.transform}"`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/services/export/renderDocument.test.ts`
Expected: FAIL — body iterates `sampleProject` and emits `data-savig-object="inner"` with no instance transform.

- [ ] **Step 3: Implement.** Replace the body builder so it iterates `flattenInstances(project, 0)`. For each leaf: resolve `asset = assetsById.get(leaf.object.assetId)`, sample with `sampleObject(leaf.object, leaf.localTime)`, and emit exactly today's vector/`<use>` markup but (a) keyed by `leaf.renderId` for `data-savig-object`, (b) prefixing `leaf.transformPrefix`, (c) using `state.opacity * leaf.opacityFactor` for `opacity`, (d) gradient def ids `savig-grad-${leaf.renderId}-fill|stroke`. Delete the `if (obj.isGroup) return ''` branch and the per-item `groupTransformPrefix` call (the walker handles both). The `usedSvgIds`/`defineSymbol` `<defs>` block for SVG assets is unchanged EXCEPT the visibility filter: replace the `project.objects.filter(!isRenderHidden)` used-id scan with `flattenInstances(project, 0)` leaves whose `object.assetId` is an svg asset (a leaf list already excludes hidden + group objects and includes instanced svg-asset leaves):

```ts
const leaves = flattenInstances(project, 0);
const usedSvgIds = Array.from(
  new Set(leaves.map((l) => l.object.assetId).filter((id) => assetsById.get(id)?.kind === 'svg')),
).sort();
const defs = usedSvgIds.map((assetId) => defineSymbol(assetsById.get(assetId) as SvgAsset)).join('');

const gradientDefs: string[] = [];
const body = leaves
  .map((leaf) => {
    const obj = leaf.object;
    const state = sampleObject(obj, leaf.localTime);
    const asset = assetsById.get(obj.assetId);
    if (!asset) {
      throw new MissingAssetError(`Missing asset "${obj.assetId}" referenced by object "${obj.id}".`);
    }
    const groupPrefix = leaf.transformPrefix; // already composed (instances + in-scene groups)
    const opacity = fmt(state.opacity * leaf.opacityFactor);
    if (asset.kind === 'vector') {
      const fillGrad = state.fillGradient ?? asset.style.fillGradient;
      const strokeGrad = state.strokeGradient ?? asset.style.strokeGradient;
      if (fillGrad) gradientDefs.push(gradientToSvg(`savig-grad-${leaf.renderId}-fill`, fillGrad));
      if (strokeGrad) gradientDefs.push(gradientToSvg(`savig-grad-${leaf.renderId}-stroke`, strokeGrad));
      const framePath = asset.shapeType === 'path' ? state.path ?? asset.path : undefined;
      const pathBox = framePath ? pathBounds(framePath) : undefined;
      const { anchorX, anchorY } = resolveAnchor(obj, state, asset.shapeType, pathBox);
      const transform = (groupPrefix ? groupPrefix + ' ' : '') + buildTransform(state, anchorX, anchorY);
      let shape = renderShapeToSvg(
        asset.shapeType,
        state.geometry ?? {},
        asset.style,
        framePath,
        leaf.renderId,
        { fill: !!fillGrad, stroke: !!strokeGrad },
        state.strokeDashoffset,
        asset.shapeType === 'path' ? asset.compoundRings : undefined,
      );
      if (!shape && asset.shapeType === 'path' && obj.shapeTrack && obj.shapeTrack.length > 0) {
        shape = '<path d=""/>';
      }
      return `<g data-savig-object="${leaf.renderId}" transform="${transform}" opacity="${opacity}">${shape}</g>`;
    }
    if (asset.kind !== 'svg') {
      throw new MissingAssetError(`Object "${obj.id}" references non-visual asset "${obj.assetId}".`);
    }
    const { anchorX, anchorY } = resolveAnchor(obj, state, undefined);
    const transform = (groupPrefix ? groupPrefix + ' ' : '') + buildTransform(state, anchorX, anchorY);
    return `<use data-savig-object="${leaf.renderId}" href="#savig-asset-${obj.assetId}" transform="${transform}" opacity="${opacity}"/>`;
  })
  .join('');
```

Update imports: add `flattenInstances`, `sampleObject`, `buildTransform`; the `renderShapeToSvg` call's id argument changes from `obj.id` to `leaf.renderId` (note: `renderShapeToSvg` uses that id for gradient `url(#...)` refs — passing `renderId` keeps them matched to the `gradientDefs` ids above). Remove `groupTransformPrefix`, `isRenderHidden`, `sampleProject` imports if now unused.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/services/export/renderDocument.test.ts && npm test -- src/runtime/frame.test.ts`
Expected: PASS — existing parity tests green, new instance parity green.

- [ ] **Step 5: Commit**

```bash
git add src/services/export/renderDocument.ts src/services/export/renderDocument.test.ts
git commit -m "feat(slice47a): renderSvgDocument flattens symbol instances (export parity)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Stage renders the leaf skeleton

The editor Stage must have a DOM node per `renderId` so the imperative painter (`applyFrameToNodes`, keyed by `item.objectId == renderId`) finds it, and so an instance's internals are visible.

**Files:**
- Modify: `src/ui/components/Stage/Stage.tsx` (the `ordered.map(...)` skeleton, lines ~1398–1502)
- Test: `src/ui/components/Stage/Stage.test.tsx`

**Interfaces:**
- Consumes: `flattenInstances` (Task 3).
- Produces: skeleton `<g/use data-savig-object={renderId}>` nodes; pointer-down on any leaf selects the top-level ancestor (`renderId.split('/')[0]`).

- [ ] **Step 1: Write the failing test** — append to `Stage.test.tsx`. Mirror the file's existing render-setup (store seeding); assert an instance's internal node exists with a composite id and that clicking it selects the instance:

```ts
it('renders a symbol instance as a composite-id leaf node and selects the instance on click', async () => {
  // Seed the store with: asset-inner (vector rect), symbol sym-1 { objects: [inner] },
  // and a top-level instance object `inst` referencing sym-1. (Use the file's existing
  // store-seed helper / renderStage().)
  // ...seed...
  const node = await screen.findByTestId('object-inst/inner');
  expect(node).toBeInTheDocument();
  await userEvent.pointer({ target: node, keys: '[MouseLeft>]' });
  expect(useStore.getState().selectedObjectIds).toContain('inst');
});
```

(Adapt the seeding + store import to this test file's existing conventions — check the top of `Stage.test.tsx` for its render helper and store handle before writing.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/ui/components/Stage/Stage.test.tsx`
Expected: FAIL — no `object-inst/inner` testid (today only top-level `ordered` objects render).

- [ ] **Step 3: Implement.** Build the leaf list near the existing `ordered` memo:

```ts
const renderLeaves = useMemo(() => flattenInstances(project, time), [project, time]);
```

Replace `{ordered.map((o) => { ... })}` (the shape skeleton block only — NOT the selection-handle/marquee code that follows) with `{renderLeaves.map((leaf) => { const o = leaf.object; const renderId = leaf.renderId; ... })}`, and inside it:
- `key`, `data-testid={`object-${renderId}`}`, `data-savig-object={renderId}`, and `ref={register(renderId)}` all use `renderId` (not `o.id`).
- `data-selected={renderId.split('/')[0] === selectedId}` — the owning top-level instance shows selected.
- `onPointerDown={(e) => onObjectPointerDown(renderId.split('/')[0], e)}` — selects the top-level ancestor so instances/internals are atomic in 47a.
- gradient ref ids use `renderId`: `paintRef(`savig-grad-${renderId}-fill`)`, `GradientEl id={`savig-grad-${renderId}-fill`}`, etc. (matches export Task 5).
- Everything else (the vector path/rect/ellipse/`<use>` branches, `sampleObject(o, time)`, `dashProps`, gradient resolution) stays as-is but reads from `o = leaf.object`.

Keep the existing `ordered` memo and ALL downstream code (selection outline, resize/rotate handles, marquee, snapping) UNCHANGED — those operate on top-level objects and must not regress. Only the shape-skeleton `.map` switches to `renderLeaves`.

Note on `register`: confirm `register(id)` keys the nodes map by the string id (it does — it currently receives `o.id`); passing `renderId` is the same call shape.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/ui/components/Stage/Stage.test.tsx`
Expected: PASS — new instance case green; all existing Stage cases green (non-instanced leaves have `renderId === o.id`, so identical output).

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/Stage/Stage.tsx src/ui/components/Stage/Stage.test.tsx
git commit -m "feat(slice47a): Stage renders flattened instance leaves (atomic selection)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: `createSymbol` store action

**Files:**
- Modify: `src/ui/store/store.ts` (new action near `groupSelected`, ~line 1215; add to the store interface near line 220)
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- Consumes: `createSymbolAsset`, `createSceneObject`, `newId` (engine); `groupBBox`/`objectAABB`/`groupAABB` already imported for `groupSelected`.
- Produces: `createSymbol(): void` on the store — moves the selected top-level non-locked objects into a new `SymbolAsset`, replaces them with one instance object selecting it.

- [ ] **Step 1: Write the failing test** — append to `store.test.ts`:

```ts
it('createSymbol moves selected objects into a new SymbolAsset + one instance', () => {
  const store = makeStore(); // use this file's store factory/helper
  // seed two top-level rect objects r1, r2 + their assets, select both
  store.getState().createSymbol();
  const p = store.getState().history.present;
  const symbols = p.assets.filter((a) => a.kind === 'symbol');
  expect(symbols).toHaveLength(1);
  expect(symbols[0].objects.map((o) => o.id).sort()).toEqual(['r1', 'r2']);
  // the two objects are gone from the top level, replaced by ONE instance referencing the symbol
  const top = p.objects;
  expect(top).toHaveLength(1);
  expect(top[0].assetId).toBe(symbols[0].id);
  expect(store.getState().selectedObjectIds).toEqual([top[0].id]);
});

it('createSymbol is undoable', () => {
  const store = makeStore();
  // seed + select two objects, capture the pre-state object ids
  store.getState().createSymbol();
  store.getState().undo();
  const p = store.getState().history.present;
  expect(p.assets.some((a) => a.kind === 'symbol')).toBe(false);
  expect(p.objects.map((o) => o.id).sort()).toEqual(['r1', 'r2']);
});

it('two instances of one symbol share the asset (edit-propagation)', () => {
  const store = makeStore();
  // seed+select two objects, createSymbol(), then duplicate the instance
  store.getState().createSymbol();
  const symId = store.getState().history.present.assets.find((a) => a.kind === 'symbol')!.id;
  const instId = store.getState().history.present.objects[0].id;
  store.getState().selectObject(instId);
  store.getState().duplicateSelected(); // existing action; clones keeping assetId
  const instances = store.getState().history.present.objects.filter((o) => o.assetId === symId);
  expect(instances).toHaveLength(2); // both read the same SymbolAsset.objects
});
```

(Adapt `makeStore`/seeding to the test file's real helpers and the real duplicate action name — check `store.test.ts` for how `groupSelected` is tested and reuse that exact setup.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/ui/store/store.test.ts`
Expected: FAIL — `createSymbol is not a function`.

- [ ] **Step 3: Implement.** Add `createSymbol(): void;` to the store interface. Implement near `groupSelected`:

```ts
createSymbol() {
  const s = get();
  const project = s.history.present;
  const time = snapToFrame(s.time, project.meta.fps);
  // Selected top-level, non-locked objects (groups allowed as members, like grouping).
  const targets = s.selectedObjectIds
    .map((id) => project.objects.find((o) => o.id === id))
    .filter((o): o is SceneObject => !!o && !o.locked && !o.parentId);
  if (targets.length < 1) return;
  const ids = new Set(targets.map((o) => o.id));
  // Members keep their authored coordinates INSIDE the symbol; the instance is an
  // identity wrapper at the selection-bbox centre -> the result is visually identical.
  const boxes = targets
    .map((o) =>
      o.isGroup
        ? groupAABB(o, project.objects, project.assets, time)
        : objectAABB(o, project.assets.find((a) => a.id === o.assetId), time),
    )
    .filter((b): b is NonNullable<typeof b> => !!b);
  const bb = groupBBox(boxes);
  const cx = bb ? (bb.minX + bb.maxX) / 2 : 0;
  const cy = bb ? (bb.minY + bb.maxY) / 2 : 0;
  const width = bb ? bb.maxX - bb.minX : 0;
  const height = bb ? bb.maxY - bb.minY : 0;
  // Move members (and any of THEIR group descendants by parentId) into the symbol scene.
  const descendantIds = new Set(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const o of project.objects) {
      if (o.parentId && descendantIds.has(o.parentId) && !descendantIds.has(o.id)) {
        descendantIds.add(o.id);
        grew = true;
      }
    }
  }
  const symbolObjects = project.objects.filter((o) => descendantIds.has(o.id));
  const symId = newId();
  const symbol = createSymbolAsset({ id: symId, name: 'Symbol', objects: symbolObjects, width, height });
  const instance = createSceneObject({
    id: newId(),
    name: 'Symbol',
    assetId: symId,
    zOrder: Math.max(...targets.map((o) => o.zOrder)) + 1,
  });
  instance.anchorX = cx;
  instance.anchorY = cy;
  const objects = [...project.objects.filter((o) => !descendantIds.has(o.id)), instance];
  get().commit({ ...project, assets: [...project.assets, symbol], objects });
  get().selectObject(instance.id);
},
```

(Verify `createSceneObject`'s option shape and `objectAABB`/`groupAABB`/`groupBBox`/`snapToFrame` import names against `groupSelected` — reuse exactly what it uses. If `createSceneObject` doesn't accept `anchorX/anchorY` in options, set them after as shown.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/ui/store/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(slice47a): createSymbol store action (selection -> SymbolAsset + instance)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Inspector "Create Symbol" button

**Files:**
- Modify: `src/ui/components/Inspector/Inspector.tsx` (near the Group/Ungroup buttons)
- Test: `src/ui/components/Inspector/Inspector.test.tsx`

**Interfaces:**
- Consumes: `createSymbol` (Task 7) from the store.
- Produces: a "Create Symbol" button enabled when ≥1 eligible top-level non-locked object is selected.

- [ ] **Step 1: Write the failing test** — append to `Inspector.test.tsx`, mirroring the existing Group-button test:

```ts
it('Create Symbol button calls createSymbol for an eligible selection', async () => {
  // seed + select an eligible object as the Group-button test does
  const btn = screen.getByRole('button', { name: /create symbol/i });
  expect(btn).toBeEnabled();
  await userEvent.click(btn);
  expect(useStore.getState().history.present.assets.some((a) => a.kind === 'symbol')).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/ui/components/Inspector/Inspector.test.tsx`
Expected: FAIL — no such button.

- [ ] **Step 3: Implement.** Find the Group/Ungroup button block in `Inspector.tsx`. Add a sibling button using the same eligibility predicate the Group button uses (≥1 selected top-level non-locked object — relax the Group button's `>= 2` to `>= 1` for this one), wired to `createSymbol`:

```tsx
<button
  type="button"
  disabled={!canCreateSymbol}
  onClick={() => createSymbol()}
>
  Create Symbol
</button>
```

Derive `canCreateSymbol` next to the existing `canGroup` computation: `const canCreateSymbol = eligibleTopLevelSelection.length >= 1;` (reuse whatever array `canGroup` is derived from). Pull `createSymbol` from the store hook alongside `groupSelected`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/ui/components/Inspector/Inspector.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/Inspector/Inspector.tsx src/ui/components/Inspector/Inspector.test.tsx
git commit -m "feat(slice47a): Inspector Create Symbol button

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: End-to-end — create a symbol and verify it renders

**Files:**
- Create: `e2e/symbols.spec.ts` (match the existing e2e directory + Playwright config; check `e2e/` for a sibling like the slice46 boolean-op e2e and copy its bootstrapping)

**Interfaces:**
- Consumes: the full UI (draw tool, selection, Inspector button).

- [ ] **Step 1: Write the e2e test.** Following the existing e2e setup (app boot, draw a rect helper):

```ts
import { test, expect } from '@playwright/test';

test('create a symbol from two shapes; instance renders', async ({ page }) => {
  await page.goto('/'); // adapt to the existing e2e baseURL/bootstrap
  // draw two rectangles (reuse the helper the slice46 e2e uses), then select both
  // (Shift-click or marquee — copy the multi-select helper from an existing e2e)
  await page.getByRole('button', { name: /create symbol/i }).click();
  // one instance node should be present, and it should contain a flattened leaf
  const leaves = page.locator('[data-savig-object*="/"]');
  await expect(leaves.first()).toBeVisible();
});
```

- [ ] **Step 2: Run it to verify it passes**

Run: `npm run e2e -- symbols.spec.ts`
Expected: PASS. (If the harness needs a built runtime, run `npm run build:runtime` first, matching how the slice46 e2e is run.)

- [ ] **Step 3: Commit**

```bash
git add e2e/symbols.spec.ts
git commit -m "test(slice47a): e2e create-symbol -> instance renders

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification (after all tasks)

- [ ] `npm test` — full unit suite green.
- [ ] `npm run typecheck` — no errors (the `Asset` union switch sites all handle `'symbol'`).
- [ ] `npm run lint` — clean.
- [ ] `npm run e2e` — green (or at least `symbols.spec.ts` + a smoke of the existing suite).
- [ ] Manual parity sanity: a project with NO symbols exports identically to `main` (diff `renderSvgDocument` output on a saved fixture if one exists).
- [ ] Then run the requesting-code-review skill (review LOOP until no Critical/Important remain), then `--no-ff` merge to `main` per the SDD flow, and update `docs/superpowers/INDEX.md`.

## Self-Review (author's checklist — completed)

- **Spec coverage:** §2 data model → Task 1; §4 walker → Tasks 2–3; §4 consumers → Tasks 4 (computeFrame), 5 (renderDocument), 6 (Stage); §5 export-flatten → Task 5; §6 authoring → Tasks 7–8; §9 testing → tests in every task + Task 9 e2e. Deferred items (§7) explicitly out of scope.
- **Placeholder scan:** every code step shows real code; fixtures flagged "adapt to local helpers" name the exact helper to check and keep concrete assertions. No TBD/TODO.
- **Type consistency:** `flattenInstances(project, time): InstanceLeaf[]` and `InstanceLeaf { renderId, object, transformPrefix, opacityFactor, localTime }` used identically in Tasks 3–6; `createSymbolAsset(overrides)` and `SymbolAsset` fields consistent across Tasks 1, 5, 7; `groupTransformPrefix(objects, obj, time)` new signature consistent across Tasks 2–5; gradient def ids `savig-grad-${renderId}-{fill|stroke}` consistent across Tasks 4–6.
