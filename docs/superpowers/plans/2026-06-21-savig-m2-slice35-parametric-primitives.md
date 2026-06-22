# Slice 35 — Parametric primitive re-editing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A stamped polygon/star carries a `PrimitiveSpec` on its vector asset; the Inspector re-edits sides/points/innerRatio/cornerRadius and regenerates the path in place; node-editing detaches the spec.

**Architecture:** `PrimitiveSpec` on `VectorAsset`; pure `primitivePathFromSpec`; store `addPrimitive` (stamp + store local-frame spec), `setPrimitiveParam` (re-edit + regenerate), detach in `setPathData`; Stage routes polygon/star stamps to `addPrimitive`; Inspector "Primitive" section. Editor + persistence only.

**Tech Stack:** TS engine, Zustand, React + RTL, Playwright.

## Global Constraints

- Additive optional field → generic serialize, NO migration/version bump (v4), NO runtime/export change, NO bundle regen.
- The local-frame spec keeps the centre fixed on re-edit (`base + (cx,cy)` unchanged).
- Full gate before merge: `pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test`.
- Commit footer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: `PrimitiveSpec` type + `primitivePathFromSpec`

**Files:**
- Modify: `src/engine/types.ts` (`PrimitiveSpec`; `VectorAsset.primitive?`)
- Modify: `src/engine/primitives.ts` (`primitivePathFromSpec`)
- Test: `src/engine/primitives.test.ts`

**Interfaces:**
```ts
export interface PrimitiveSpec {
  kind: 'polygon' | 'star';
  cx: number; cy: number; radius: number; rotation: number;
  sides?: number; points?: number; innerRatio?: number; cornerRadius: number;
}
export function primitivePathFromSpec(spec: PrimitiveSpec): PathData;
```

- [ ] **Step 1: Write the failing tests** — append to `primitives.test.ts`:

```ts
import { primitivePathFromSpec } from './primitives'; // add to import
import type { PrimitiveSpec } from './types';

describe('primitivePathFromSpec', () => {
  it('regenerates a polygon equal to polygonPath', () => {
    const spec: PrimitiveSpec = { kind: 'polygon', cx: 50, cy: 50, radius: 40, rotation: 0, sides: 6, cornerRadius: 0 };
    expect(primitivePathFromSpec(spec)).toEqual(polygonPath(50, 50, 40, 6, 0, 0));
  });
  it('regenerates a star equal to starPath (inner = radius*ratio)', () => {
    const spec: PrimitiveSpec = { kind: 'star', cx: 50, cy: 50, radius: 40, rotation: 0, points: 5, innerRatio: 0.5, cornerRadius: 0 };
    expect(primitivePathFromSpec(spec)).toEqual(starPath(50, 50, 40, 20, 5, 0, 0));
  });
  it('carries the corner radius (rounded -> handles)', () => {
    const spec: PrimitiveSpec = { kind: 'polygon', cx: 50, cy: 50, radius: 40, rotation: 0, sides: 5, cornerRadius: 6 };
    expect(primitivePathFromSpec(spec).nodes.some((n) => n.in || n.out)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run src/engine/primitives.test.ts`
Expected: FAIL (primitivePathFromSpec undefined).

- [ ] **Step 3: Implement** — in `types.ts` add `PrimitiveSpec` (near `VectorAsset`) and add `primitive?: PrimitiveSpec;` to `VectorAsset`. In `primitives.ts`:

```ts
import type { PathData, PathPoint, PrimitiveSpec } from './types'; // add PrimitiveSpec

export function primitivePathFromSpec(spec: PrimitiveSpec): PathData {
  if (spec.kind === 'star') {
    return starPath(spec.cx, spec.cy, spec.radius, spec.radius * (spec.innerRatio ?? 0.5), spec.points ?? 5, spec.rotation, spec.cornerRadius);
  }
  return polygonPath(spec.cx, spec.cy, spec.radius, spec.sides ?? 5, spec.rotation, spec.cornerRadius);
}
```

- [ ] **Step 4: Run to verify pass** — `pnpm vitest run src/engine/primitives.test.ts` → PASS.

- [ ] **Step 5: Commit**
```bash
git add src/engine/types.ts src/engine/primitives.ts src/engine/primitives.test.ts
git commit -m "feat(slice35): PrimitiveSpec on VectorAsset + primitivePathFromSpec"
```

---

### Task 2: store `addPrimitive` + `setPrimitiveParam` + detach

**Files:**
- Modify: `src/ui/store/store.ts`
- Test: `src/ui/store/store.test.ts`

**Interfaces:**
- `addPrimitive(spec: PrimitiveSpec): void` — `spec` in STAGE frame (cx/cy/radius/rotation = stage); stores the LOCAL-frame spec.
- `setPrimitiveParam(param: 'sides'|'points'|'innerRatio'|'cornerRadius', value: number): void`.

- [ ] **Step 1: Write the failing tests** — append to `store.test.ts`:

```ts
describe('parametric primitives', () => {
  it('addPrimitive creates a path object whose asset carries a primitive spec', () => {
    useEditor.getState().newProject();
    useEditor.getState().addPrimitive({ kind: 'polygon', cx: 100, cy: 100, radius: 40, rotation: 0, sides: 6, cornerRadius: 0 });
    const obj = useEditor.getState().history.present.objects.at(-1)!;
    const asset = useEditor.getState().history.present.assets.find((a) => a.id === obj.assetId)!;
    expect(asset.kind).toBe('vector');
    expect((asset as Extract<typeof asset, { kind: 'vector' }>).primitive?.kind).toBe('polygon');
    expect((asset as Extract<typeof asset, { kind: 'vector' }>).primitive?.sides).toBe(6);
  });

  it('setPrimitiveParam regenerates the path (more sides) and keeps it parametric', () => {
    useEditor.getState().newProject();
    useEditor.getState().addPrimitive({ kind: 'polygon', cx: 100, cy: 100, radius: 40, rotation: 0, sides: 5, cornerRadius: 0 });
    useEditor.getState().setPrimitiveParam('sides', 8);
    const obj = useEditor.getState().history.present.objects.at(-1)!;
    const asset = useEditor.getState().history.present.assets.find((a) => a.id === obj.assetId)! as Extract<Asset, { kind: 'vector' }>;
    expect(asset.primitive?.sides).toBe(8);
    expect(asset.path?.nodes).toHaveLength(8);
  });

  it('node-editing detaches the primitive spec; setPrimitiveParam then no-ops', () => {
    useEditor.getState().newProject();
    useEditor.getState().addPrimitive({ kind: 'star', cx: 100, cy: 100, radius: 40, rotation: 0, points: 5, innerRatio: 0.5, cornerRadius: 0 });
    const id0 = useEditor.getState().history.present.assets.at(-1)!.id;
    // a node edit on the static path detaches
    const current = useEditor.getState().history.present.assets.find((a) => a.id === id0)! as Extract<Asset, { kind: 'vector' }>;
    useEditor.getState().setPathData({ ...current.path!, nodes: current.path!.nodes.map((n, i) => (i === 0 ? { anchor: { x: n.anchor.x + 5, y: n.anchor.y } } : n)) }, undefined);
    const after = useEditor.getState().history.present.assets.find((a) => a.id === id0)! as Extract<Asset, { kind: 'vector' }>;
    expect(after.primitive).toBeUndefined();
    const lenBefore = after.path!.nodes.length;
    useEditor.getState().setPrimitiveParam('points', 9); // no spec -> no-op
    const after2 = useEditor.getState().history.present.assets.find((a) => a.id === id0)! as Extract<Asset, { kind: 'vector' }>;
    expect(after2.path!.nodes.length).toBe(lenBefore);
  });
});
```

(Import `Asset` type in store.test.ts if not present.)

- [ ] **Step 2: Run to verify fail** — `pnpm vitest run src/ui/store/store.test.ts` → FAIL.

- [ ] **Step 3: Implement** — add to the interface: `addPrimitive(spec: PrimitiveSpec): void;` and `setPrimitiveParam(param: 'sides' | 'points' | 'innerRatio' | 'cornerRadius', value: number): void;`. Import `PrimitiveSpec`, `primitivePathFromSpec`. Implement:

```ts
addPrimitive(spec) {
  const project = get().history.present;
  const path = primitivePathFromSpec(spec); // stage-frame
  if (path.nodes.length < 2) return;
  const box = pathBounds(path);
  const normalized: PathData = {
    closed: path.closed,
    nodes: path.nodes.map((n) => ({ anchor: { x: n.anchor.x - box.x, y: n.anchor.y - box.y }, ...(n.in ? { in: n.in } : {}), ...(n.out ? { out: n.out } : {}) })),
  };
  const local: PrimitiveSpec = { ...spec, cx: spec.cx - box.x, cy: spec.cy - box.y };
  const asset = createVectorAsset('path', { path: normalized, style: { ...PATH_DEFAULT_STYLE }, primitive: local });
  const obj = createSceneObject(asset.id, {
    name: `${asset.name} ${nextZOrder(project.objects) + 1}`,
    zOrder: nextZOrder(project.objects),
    anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5,
    base: { ...DEFAULT_TRANSFORM, x: box.x, y: box.y },
  });
  get().commit({ ...project, assets: [...project.assets, asset], objects: [...project.objects, obj] });
  set({ selectedObjectId: obj.id, selectedKeyframe: null, selectedNodeIndex: null, activeTool: 'node' });
},
setPrimitiveParam(param, value) {
  const s = get();
  const project = s.history.present;
  const obj = project.objects.find((o) => o.id === s.selectedObjectId);
  const asset = obj ? project.assets.find((a) => a.id === obj.assetId) : undefined;
  if (!asset || asset.kind !== 'vector' || !asset.primitive) return;
  const p = asset.primitive;
  const clamp = {
    sides: Math.max(3, Math.floor(value)),
    points: Math.max(2, Math.floor(value)),
    innerRatio: Math.min(0.99, Math.max(0.01, value)),
    cornerRadius: Math.max(0, value),
  }[param];
  const next: PrimitiveSpec = { ...p, [param]: clamp };
  const nextAsset = { ...asset, primitive: next, path: primitivePathFromSpec(next) };
  get().commit({ ...project, assets: project.assets.map((a) => (a.id === asset.id ? nextAsset : a)) });
},
```

Then in `setPathData`'s static-path branch, detach:
```ts
const next = { ...asset, path, primitive: undefined }; // node-edit detaches the parametric spec
```

- [ ] **Step 4: Run to verify pass** — `pnpm vitest run src/ui/store/store.test.ts` → PASS.

- [ ] **Step 5: Commit**
```bash
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(slice35): addPrimitive + setPrimitiveParam + detach on node-edit"
```

---

### Task 3: Stage routing + Inspector "Primitive" section

**Files:**
- Modify: `src/ui/components/Stage/drawGeometry.ts` (`primitiveSpecFromDrag`)
- Modify: `src/ui/components/Stage/Stage.tsx` (onUp routes polygon/star to `addPrimitive`)
- Modify: `src/ui/components/Inspector/Inspector.tsx` (Primitive section)
- Test: `src/ui/components/Stage/drawGeometry.test.ts`, `src/ui/components/Inspector/Inspector.test.tsx`

- [ ] **Step 1: `primitiveSpecFromDrag`** — in `drawGeometry.ts`, add (mirrors `primitivePathFromDrag` but returns the stage spec):
```ts
export function primitiveSpecFromDrag(tool: 'polygon' | 'star', start: Point, end: Point, opts: PrimitiveOpts, minSize: number): PrimitiveSpec | null {
  const dist = Math.hypot(end.x - start.x, end.y - start.y);
  if (dist < minSize) return null;
  const rotation = Math.atan2(end.y - start.y, end.x - start.x) + Math.PI / 2;
  return tool === 'polygon'
    ? { kind: 'polygon', cx: start.x, cy: start.y, radius: dist, rotation, sides: opts.polygonSides, cornerRadius: opts.cornerRadius }
    : { kind: 'star', cx: start.x, cy: start.y, radius: dist, rotation, points: opts.starPoints, innerRatio: opts.starInnerRatio, cornerRadius: opts.cornerRadius };
}
```
Add a `drawGeometry.test.ts` test: a polygon drag → spec.kind 'polygon', sides from opts, radius == dist.

- [ ] **Step 2: Stage onUp** — in the polygon/star/line stamp commit, route polygon/star through `addPrimitive(primitiveSpecFromDrag(...))` and keep line on `addVectorPath(primitivePathFromDrag(...))`:
```ts
if (s.activeTool === 'line') {
  const path = primitivePathFromDrag('line', draw.start, draw.end, opts, MIN_DRAW_SIZE);
  if (path) s.addVectorPath(path);
} else {
  const spec = primitiveSpecFromDrag(s.activeTool as 'polygon' | 'star', draw.start, draw.end, opts, MIN_DRAW_SIZE);
  if (spec) s.addPrimitive(spec);
}
```
(The drag PREVIEW stays on `primitivePathFromDrag`.)

- [ ] **Step 3: Inspector Primitive section** — when the selected object's asset has `primitive`, render a "Primitive" `<section>` with number fields: Sides (polygon) / Points + Inner ratio (star) + Corner radius (both), each calling `setPrimitiveParam`. Mirror the existing Inspector field markup; gate the polygon-vs-star fields on `primitive.kind`. Add a fallback hint when none.

- [ ] **Step 4: Tests** — `drawGeometry.test.ts` (spec from drag); `Inspector.test.tsx` (render a parametric object — e.g. via `addPrimitive` then assert the "Sides"/"Points" field renders and editing calls `setPrimitiveParam`, observe `asset.primitive.sides` changes). Run them.

- [ ] **Step 5: Commit**
```bash
git add src/ui/components/Stage/drawGeometry.ts src/ui/components/Stage/Stage.tsx src/ui/components/Inspector/Inspector.tsx src/ui/components/Stage/drawGeometry.test.ts src/ui/components/Inspector/Inspector.test.tsx
git commit -m "feat(slice35): stamp polygon/star parametrically + Inspector Primitive section"
```

---

### Task 4: Persistence round-trip + e2e + full gate

**Files:**
- Test: persistence round-trip (in `store.test.ts` or the persist module's test)
- Test: `e2e/parametric-primitive.spec.ts` (create)

- [ ] **Step 1: Persistence round-trip test** — find the `.savig` serialize/parse (search `src/services/persist*` / `src/runtime/persist*`). Add a test: build a project with a parametric primitive (`addPrimitive`), serialize → parse, assert the loaded asset still has `primitive` with the same params. (If a direct serialize/parse helper isn't unit-testable, assert the field survives a `setProject(structuredClone(project))` round-trip — confirming it's plain serializable data.)

- [ ] **Step 2: e2e** — `e2e/parametric-primitive.spec.ts`: pick the Star tool, stamp a star, read the on-canvas path `d`; in the Inspector change "Points" to a larger number; assert the path `d` changes (more vertices) and the object's bounding-box centre is ~unchanged. (Model setup on `e2e/primitives.spec.ts` and the Inspector field selectors.)

- [ ] **Step 3: Full gate + commit**
```bash
pnpm typecheck && pnpm lint && pnpm vitest run && pnpm build && pnpm exec playwright test
git add -A
git commit -m "test(slice35): parametric-primitive persistence round-trip + re-edit e2e"
```

---

## Self-Review (post-write)

- **Spec coverage:** §3 type/helper → T1; §5 store → T2; Stage/Inspector → T3; persistence + e2e → T4.
- **Type consistency:** `PrimitiveSpec` fields and `setPrimitiveParam` param union consistent across engine/store/Stage/Inspector; `addPrimitive(spec)` stage→local conversion in the store only.
- **No placeholders:** T1/T2 have full code; T3/T4 reference the existing draw/Inspector/persist patterns the executor wires (selectors pinned during impl).
- **Detach correctness:** only `setPathData`'s static branch clears `primitive`; `setPrimitiveParam` sets `asset.path` directly (never via setPathData) so a param edit never self-detaches.
- **No runtime/export/migration:** additive optional field; the runtime renders `asset.path`; persistence is generic. Confirmed no bundle regen.
