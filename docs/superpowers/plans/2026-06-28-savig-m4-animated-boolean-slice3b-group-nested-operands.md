# Animated Boolean — Slice 3b: Group + Nested-Boolean Operands — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a live boolean take a GROUP (union of its vector leaves) or another LIVE BOOLEAN (its own result) as any operand — rendering, animating, authoring, and exporting it exactly like a leaf-operand boolean.

**Architecture:** Everything funnels through `resolveBooleanRings` (the seam `computeFrame`, `renderSvgDocument`, and Stage all call). Make `operandWorldGeom` resolve a nested boolean to its raw `PcMultiPolygon` (holes preserved, captured before the flatten-to-rings step) with a cycle guard; expand `flattenInstances`'s `consumed` set so a group operand's whole subtree is render-hidden; relax the store's live-operand filter to admit groups + booleans; regenerate the runtime bundle so a standalone export animates them.

**Tech Stack:** TypeScript (strict), Zustand store, `polygon-clipping`, Vitest. Runtime bundle is esbuild-generated via `pnpm build:runtime`.

## Global Constraints

- **Faceted only:** group / nested-boolean operands carry NO cubic provenance — they reconstruct as corners, exactly as the destructive group-boolean already does. Leaf operands keep their existing curve provenance.
- **Full parity:** a boolean with only leaf operands, and every non-boolean object, behaves byte-identically. New params are optional (`visited: Set<string> = new Set()`); new branches only fire for `obj.boolean` / group operands.
- **Root-scene only** (the slice 1/2/3a boundary): the store's live branch stays gated on `activeAssetId === null`.
- **A nested boolean operand resolves to a `PcMultiPolygon`** (outer + hole rings), NOT to its rendered even-odd ring list — feeding rings back as positive polygons would fill the holes.
- **Cycle-safe:** a boolean that (transitively) references itself resolves to `[]`, never infinite recursion.
- **Runtime bundle MUST be regenerated** after the engine + flatten changes (`frame.ts` → `resolveBooleanRings` and `flattenInstances` are both bundled), else a standalone export animates with the stale resolver.

---

### Task 1: Engine — nested-boolean operand resolution + cycle guard

**Files:**
- Modify: `src/engine/geom/boolean.ts` (`booleanOp` ~234-303, `operandWorldGeom` ~224-232, `operandCubicsWorld` ~188-199, `resolveBooleanRings` ~306-314)
- Test: `src/engine/geom/boolean.test.ts` (append to the existing `describe('resolveBooleanRings', …)`)

**Interfaces:**
- Consumes: existing `operandWorldGeom`, `objectToWorldPolygon`, `reconstructRing`, `ringToPathData`, `cubicsToRing`, types `PcMultiPolygon`/`PcPolygon`/`OperandCubics` (all already in this file).
- Produces:
  - `booleanOp(project, objs, op, time, visited?: Set<string>): PathData[]` — unchanged output; new optional last param.
  - `resolveBooleanRings(project, booleanObj, time, visited?: Set<string>): PathData[]` — unchanged output; new optional last param + cycle guard.
  - `operandWorldGeom(project, obj, time, visited?: Set<string>): PcPolygon | PcMultiPolygon` — new optional last param; now resolves `obj.boolean`.
  - internal `booleanResultGeom(...)`, `resolveBooleanGeom(...)` (not exported).

- [ ] **Step 1: Write the failing tests**

Append inside `describe('resolveBooleanRings', () => { … })` in `src/engine/geom/boolean.test.ts`:

```ts
  it('resolves a GROUP operand as the union of its vector leaves', () => {
    // group{g1: rect 0..20, g2: rect 20..40 abutting} subtracted-from a big rect 0..40 leaves nothing
    // interesting; instead intersect a covering rect with the group -> equals the group's union.
    const g1 = rectObj('g1', 0, 20, 40, 0, 0); // 0..20 x, 0..40 y
    const g2 = rectObj('g2', 1, 20, 40, 20, 0); // 20..40 x
    const group = createGroupObject({ id: 'grp', anchorX: 0.5, anchorY: 0.5, zOrder: 2 });
    g1[0].parentId = 'grp';
    g2[0].parentId = 'grp';
    const cover = rectObj('cover', 3, 40, 40, 0, 0); // 0..40 fully covers the group
    const boolAsset = createVectorAsset('path', { id: 'bg', path: { nodes: [], closed: false } });
    const boolObj = createSceneObject('bg', { id: 'bgobj', zOrder: 4, boolean: { op: 'intersect', operandIds: ['grp', 'cover'] } });
    const project = {
      ...createProject(),
      objects: [g1[0], g2[0], group, cover[0], boolObj],
      assets: [g1[1], g2[1], cover[1], boolAsset],
    };
    const rings = resolveBooleanRings(project, boolObj, 0);
    expect(rings.length).toBeGreaterThan(0); // group resolved as one operand (union of g1,g2)
    const xs = rings.flatMap((r) => r.nodes.map((n) => n.anchor.x));
    expect(Math.min(...xs)).toBeCloseTo(0, 3);
    expect(Math.max(...xs)).toBeCloseTo(40, 3); // spans the whole group, not just one rect
  });

  it('resolves a NESTED boolean operand as a multipolygon with its hole preserved', () => {
    // inner = subtract(big 0..40, small interior) -> a ring WITH a hole.
    const big = rectObj('ib', 0, 40, 40, 0, 0);
    const small = rectObj('is', 1, 10, 10, 15, 15);
    const innerAsset = createVectorAsset('path', { id: 'innera', path: { nodes: [], closed: false } });
    const inner = createSceneObject('innera', { id: 'inner', zOrder: 2, boolean: { op: 'subtract', operandIds: ['ib', 'is'] } });
    // far = a disjoint rect far to the right (no overlap with inner).
    const far = rectObj('far', 3, 10, 10, 100, 0);
    const outerAsset = createVectorAsset('path', { id: 'outera', path: { nodes: [], closed: false } });
    const outer = createSceneObject('outera', { id: 'outer', zOrder: 4, boolean: { op: 'union', operandIds: ['inner', 'far'] } });
    const project = {
      ...createProject(),
      objects: [big[0], small[0], inner, far[0], outer],
      assets: [big[1], small[1], innerAsset, far[1], outerAsset],
    };
    const rings = resolveBooleanRings(project, outer, 0);
    // inner contributes 2 rings (outer boundary + hole), far contributes 1 -> 3 total.
    // If the hole were filled (rings fed back as positive polys), inner would be 1 ring -> 2 total.
    expect(rings.length).toBe(3);
  });

  it('returns [] (no infinite recursion) for a cyclic boolean reference', () => {
    const x = rectObj('cx', 0, 20, 20, 0, 0);
    const y = rectObj('cy', 1, 20, 20, 10, 0);
    const aAsset = createVectorAsset('path', { id: 'ca', path: { nodes: [], closed: false } });
    const bAsset = createVectorAsset('path', { id: 'cb', path: { nodes: [], closed: false } });
    // A operand-of [B, x]; B operand-of [A, y] -> mutual cycle.
    const a = createSceneObject('ca', { id: 'A', zOrder: 2, boolean: { op: 'union', operandIds: ['B', 'cx'] } });
    const b = createSceneObject('cb', { id: 'B', zOrder: 3, boolean: { op: 'union', operandIds: ['A', 'cy'] } });
    const project = { ...createProject(), objects: [x[0], y[0], a, b], assets: [x[1], y[1], aAsset, bAsset] };
    expect(resolveBooleanRings(project, a, 0)).toEqual([]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/engine/geom/boolean.test.ts -t "GROUP operand|NESTED boolean operand|cyclic"`
Expected: FAIL — the nested test gets `0` rings (boolean operand resolves to empty fallback path), the cycle test may recurse/throw or return non-empty.

- [ ] **Step 3: Refactor `booleanOp` into `booleanResultGeom` + tail**

In `src/engine/geom/boolean.ts`, replace the whole `export function booleanOp(...) { … }` (lines ~234-303) with the helper + thin wrapper below. The loop/clip/tol logic is moved verbatim into `booleanResultGeom`; the only change inside the loop is threading `visited` into the `operandWorldGeom` call.

```ts
interface BooleanGeom {
  result: PcMultiPolygon;
  operands: OperandCubics[];
  tol: number;
}

// The raw clip result + provenance data, BEFORE flattening to PathData rings. null when fewer than
// two operands contribute geometry (degenerate). `visited` carries the set of boolean ids on the
// current resolution stack (cycle guard for nested-boolean operands).
function booleanResultGeom(
  project: Project,
  objs: SceneObject[],
  op: BoolOp,
  time: number,
  visited: Set<string>,
): BooleanGeom | null {
  const sorted = objs.slice().sort((a, b) => a.zOrder - b.zOrder); // bottom-most first

  const operands: OperandCubics[] = [];
  const geoms: (PcPolygon | PcMultiPolygon)[] = [];
  let opIdx = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const fold = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  for (const o of sorted) {
    const cubics = operandCubicsWorld(project, o, time);
    if (cubics.length >= 2) {
      const id = opIdx++;
      operands.push({ opIdx: id, segs: cubics });
      const ring = cubicsToRing(cubics);
      for (const [x, y] of ring) fold(x, y);
      geoms.push([ring]);
    } else {
      // group / nested-boolean / non-vector / fallback flat geom. geoms and operands lengths are
      // intentionally decoupled — these entries have no operands counterpart, so reconstructRing
      // must resolve by opIdx, never by a geoms position.
      const g = operandWorldGeom(project, o, time, visited);
      if (g.length > 0) geoms.push(g);
    }
  }
  if (geoms.length < 2) return null;

  const head = geoms[0];
  const rest = geoms.slice(1);
  let result: PcMultiPolygon;
  if (op === 'union') result = pc.union(head, ...rest);
  else if (op === 'intersect') result = pc.intersection(head, ...rest);
  else if (op === 'exclude') result = pc.xor(head, ...rest);
  else result = pc.difference(head, ...rest); // subtract upper from bottom-most

  // Match-back tolerance: must exceed polygon-clipping rounding, stay below feature size.
  const diag = Number.isFinite(minX) ? Math.hypot(maxX - minX, maxY - minY) : 0;
  const tol = Math.max(1e-4, diag * 1e-4);
  return { result, operands, tol };
}

export function booleanOp(
  project: Project,
  objs: SceneObject[],
  op: BoolOp,
  time: number,
  visited: Set<string> = new Set(),
): PathData[] {
  const g = booleanResultGeom(project, objs, op, time, visited);
  if (!g) return [];
  const { result, operands, tol } = g;

  // Flatten MultiPolygon (Polygon[] -> Ring[]) to a flat ring list; even-odd fill handles holes.
  const rings: PathData[] = [];
  for (const poly of result) {
    for (const ring of poly) {
      let pd: PathData | null = null;
      if (operands.length > 0) {
        try {
          pd = reconstructRing(ring, operands, tol);
        } catch {
          pd = null; // parity-safe: fall back to faceted ring on any reconstruction error
        }
      }
      const final = pd ?? ringToPathData(ring);
      if (final.nodes.length >= 3) rings.push(final);
    }
  }
  return rings;
}

// A live boolean OPERAND's raw clip geometry (holes preserved as polygon nesting). [] when the
// boolean is degenerate or forms a cycle. Used by operandWorldGeom for a nested-boolean operand.
function resolveBooleanGeom(
  project: Project,
  booleanObj: SceneObject,
  time: number,
  visited: Set<string>,
): PcMultiPolygon {
  const spec = booleanObj.boolean;
  if (!spec) return [];
  if (visited.has(booleanObj.id)) return []; // cycle guard
  const next = new Set(visited);
  next.add(booleanObj.id);
  const operands = spec.operandIds
    .map((id) => project.objects.find((o) => o.id === id))
    .filter((o): o is SceneObject => !!o);
  if (operands.length < 2) return [];
  return booleanResultGeom(project, operands, spec.op, time, next)?.result ?? [];
}
```

- [ ] **Step 4: Add the boolean branches to the operand resolvers**

In `operandCubicsWorld` (top of the function body), add the boolean guard as the first line:

```ts
export function operandCubicsWorld(project: Project, obj: SceneObject, time: number): Cubic[] {
  if (obj.boolean) return []; // a nested boolean has no leaf cubics; resolve via operandWorldGeom
  if (obj.isGroup) return [];
  // ... unchanged ...
```

In `operandWorldGeom`, add the `visited` param and the leading boolean branch:

```ts
export function operandWorldGeom(
  project: Project,
  obj: SceneObject,
  time: number,
  visited: Set<string> = new Set(),
): PcPolygon | PcMultiPolygon {
  if (obj.boolean) return resolveBooleanGeom(project, obj, time, visited); // nested live boolean
  if (!obj.isGroup) return objectToWorldPolygon(project, obj, time);
  // ... unchanged group-union branch ...
```

- [ ] **Step 5: Add the cycle guard + visited threading to `resolveBooleanRings`**

Replace `resolveBooleanRings` (lines ~306-314) with:

```ts
export function resolveBooleanRings(
  project: Project,
  booleanObj: SceneObject,
  time: number,
  visited: Set<string> = new Set(),
): PathData[] {
  const spec = booleanObj.boolean;
  if (!spec) return [];
  if (visited.has(booleanObj.id)) return []; // cycle guard (defense-in-depth vs corrupt operandIds)
  const next = new Set(visited);
  next.add(booleanObj.id);
  const operands = spec.operandIds
    .map((id) => project.objects.find((o) => o.id === id))
    .filter((o): o is SceneObject => !!o);
  if (operands.length < 2) return [];
  return booleanOp(project, operands, spec.op, time, next);
}
```

- [ ] **Step 6: Run the new tests + the full boolean suite (parity)**

Run: `pnpm vitest run src/engine/geom/boolean.test.ts`
Expected: PASS — all new tests green AND every pre-existing test (leaf operands, curve preservation, subtract-hole) still green.

- [ ] **Step 7: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: clean (no errors).

- [ ] **Step 8: Commit**

```bash
git add src/engine/geom/boolean.ts src/engine/geom/boolean.test.ts
git commit -m "feat(boolean): nested-boolean + group operand resolution (multipolygon + cycle guard)"
```

---

### Task 2: Scene walk — no double-render of group operand leaves

**Files:**
- Modify: `src/engine/symbol.ts` (`flattenInstances`, the `consumed` set ~96)
- Test: `src/engine/symbol.test.ts` (new `describe` block)

**Interfaces:**
- Consumes: `groupDescendantIds(objects: SceneObject[], groupId: string): Set<string>` from `./groupTransform` (already exists).
- Produces: no signature change — `flattenInstances` now render-hides a group operand's whole subtree.

- [ ] **Step 1: Write the failing test**

Append to `src/engine/symbol.test.ts` (imports `flattenInstances` already present; add `createGroupObject`, `createVectorAsset`, `createSceneObject`, `createProject` to the `../project` import if not present):

```ts
describe('flattenInstances — live boolean group operand (slice 3b)', () => {
  it('does not draw the leaves of a group used as a boolean operand', () => {
    const g1 = createSceneObject('rg1-a', { id: 'g1', parentId: 'grp', zOrder: 0 });
    const g2 = createSceneObject('rg2-a', { id: 'g2', parentId: 'grp', zOrder: 1 });
    const group = createGroupObject({ id: 'grp', anchorX: 0.5, anchorY: 0.5, zOrder: 0 });
    const leaf = createSceneObject('leaf-a', { id: 'leaf', zOrder: 1 });
    const boolAsset = createVectorAsset('path', { id: 'b-a', path: { nodes: [], closed: false } });
    const boolObj = createSceneObject('b-a', { id: 'b', zOrder: 2, boolean: { op: 'union', operandIds: ['grp', 'leaf'] } });
    const project = {
      ...createProject(),
      objects: [g1, g2, group, leaf, boolObj],
      assets: [
        createVectorAsset('rect', { id: 'rg1-a' }),
        createVectorAsset('rect', { id: 'rg2-a' }),
        createVectorAsset('rect', { id: 'leaf-a' }),
        boolAsset,
      ],
    };
    const ids = flattenInstances(project, 0).map((l) => l.renderId);
    // The group's leaves (g1,g2) and the leaf operand are consumed; only the boolean object draws.
    expect(ids).not.toContain('g1');
    expect(ids).not.toContain('g2');
    expect(ids).not.toContain('leaf');
    expect(ids).toContain('b');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/engine/symbol.test.ts -t "group operand"`
Expected: FAIL — `ids` still contains `g1`/`g2` (the group's leaves are not in `consumed`, so they double-render).

- [ ] **Step 3: Expand the `consumed` set to group subtrees**

In `src/engine/symbol.ts`, add the import (top of file, with the other `./groupTransform` import or a new line):

```ts
import { groupDescendantIds } from './groupTransform';
```

Replace the one-liner `const consumed = new Set(project.objects.flatMap((o) => o.boolean?.operandIds ?? []));` (~line 96) with:

```ts
  // Objects consumed by a live boolean (its operands) are sampled for the clip but not drawn
  // directly. A GROUP operand contributes the union of its leaf descendants, so the WHOLE subtree
  // must be hidden (not just the group id, which never draws as a leaf anyway). A nested-boolean
  // operand needs no special case: its id is an operandId here, and its own operandIds are collected
  // by the same loop across all boolean objects (with their group subtrees expanded in turn).
  const consumed = new Set<string>();
  for (const o of project.objects) {
    for (const id of o.boolean?.operandIds ?? []) {
      consumed.add(id);
      const operand = project.objects.find((x) => x.id === id);
      if (operand?.isGroup) {
        for (const d of groupDescendantIds(project.objects, id)) consumed.add(d);
      }
    }
  }
```

- [ ] **Step 4: Run the test + the full symbol suite (parity)**

Run: `pnpm vitest run src/engine/symbol.test.ts`
Expected: PASS — the new test green AND all existing flatten tests (leaf-operand boolean, symbol instances) still green.

- [ ] **Step 5: Commit**

```bash
git add src/engine/symbol.ts src/engine/symbol.test.ts
git commit -m "fix(flatten): render-hide a group boolean-operand's whole subtree (no double-render)"
```

---

### Task 3: Regenerate the runtime bundle

**Files:**
- Modify (generated): `src/runtime/runtimeSource.generated.ts` (via `pnpm build:runtime`)

**Interfaces:**
- Consumes: the final `boolean.ts` (Task 1) + `symbol.ts` (Task 2) — both are bundled into the runtime through `frame.ts`.
- Produces: a regenerated bundle whose embedded `computeFrame` resolves group/nested operands per frame, so a standalone export animates them.

- [ ] **Step 1: Regenerate the bundle**

Run: `pnpm build:runtime`
Expected: writes `src/runtime/runtimeSource.generated.ts` with the updated `resolveBooleanRings`/`flattenInstances`.

- [ ] **Step 2: Confirm only the generated bundle changed + it typechecks/builds**

Run: `git status --porcelain` (expect only `src/runtime/runtimeSource.generated.ts` modified) then `pnpm tsc --noEmit`
Expected: only the generated file is dirty; typecheck clean.

- [ ] **Step 3: Run the runtime + export suites (the bundle is exercised by export/runtime tests)**

Run: `pnpm vitest run src/runtime src/services/export`
Expected: PASS (no regression from the regenerated bundle).

- [ ] **Step 4: Commit**

```bash
git add src/runtime/runtimeSource.generated.ts
git commit -m "build(runtime): regenerate bundle for group/nested boolean operand resolution"
```

---

### Task 4: Authoring — relax the live-operand filter (groups + nested booleans)

**Files:**
- Modify: `src/ui/store/store.ts` (the `booleanOp` live branch, ~1816-1838)
- Test: `src/ui/store/store.test.ts` — the `describe('live boolean authoring (booleanOp live)', …)` block (~4377). TWO existing tests assert the now-lifted restriction and must be UPDATED (they flip from no-op to creating a boolean); plus one new group-style test.

**Interfaces:**
- Consumes: the in-scope `eligible` array (selected objects with `vectorLeavesOf(o).length > 0` — already includes groups-with-leaves AND live booleans, since `vectorLeavesOf` returns `[o]` for any vector-asset non-group, and a boolean's asset is a path `VectorAsset`); the in-scope `vectorLeavesOf` helper. Both are defined just above the live branch in the same `booleanOp` body.
- Produces: a live boolean whose `operandIds` may include group ids and live-boolean ids.
- Test helpers already in the file: `twoRects()` (returns `{ a, b }`, both selected), `useEditor.getState()`, `addVectorShape`, `groupSelected`, `selectObjects`, `history.present`.

- [ ] **Step 1: Update the two flipping tests + add the group-style test**

In `src/ui/store/store.test.ts`, the `describe('live boolean authoring (booleanOp live)', …)` block.

**1a.** REPLACE the existing test `it('self-gates: one leaf + one group selected -> no-op (only 1 leaf operand)', …)` (its premise is now invalid — a group counts as an operand) with:

```ts
  it('authors a live boolean from one leaf + one group (group = one operand)', () => {
    const s = useEditor.getState();
    s.newProject();
    s.addVectorShape('rect', { x: 0, y: 0, width: 20, height: 20 });
    const leaf = useEditor.getState().selectedObjectId!;
    s.addVectorShape('rect', { x: 40, y: 0, width: 20, height: 20 });
    const g1 = useEditor.getState().selectedObjectId!;
    s.addVectorShape('rect', { x: 60, y: 0, width: 20, height: 20 });
    const g2 = useEditor.getState().selectedObjectId!;
    useEditor.getState().selectObjects([g1, g2]);
    useEditor.getState().groupSelected();
    const groupId = useEditor.getState().selectedObjectId!;
    useEditor.getState().selectObjects([leaf, groupId]);
    const before = useEditor.getState().history.present.objects.length;
    useEditor.getState().booleanOp('union', { live: true });
    const proj = useEditor.getState().history.present;
    expect(proj.objects.length).toBe(before + 1); // a live boolean was created
    const result = proj.objects.find((o) => o.id === useEditor.getState().selectedObjectId)!;
    expect(result.boolean).toEqual({ op: 'union', operandIds: [leaf, groupId] }); // group kept whole, selection order
    expect(proj.objects.some((o) => o.id === groupId)).toBe(true); // operands kept
  });
```

**1b.** REPLACE the existing test `it('excludes a nested live boolean operand (live boolean + 1 leaf -> only 1 live operand -> no-op)', …)` with:

```ts
  it('authors a live boolean from a nested live boolean + one leaf', () => {
    const { a } = twoRects();
    useEditor.getState().booleanOp('union', { live: true });
    const liveBoolId = useEditor.getState().selectedObjectId!;
    useEditor.getState().selectObjects([liveBoolId, a]);
    const before = useEditor.getState().history.present.objects.length;
    useEditor.getState().booleanOp('subtract', { live: true });
    const proj = useEditor.getState().history.present;
    expect(proj.objects.length).toBe(before + 1); // nested boolean now a valid operand
    const result = proj.objects.find((o) => o.id === useEditor.getState().selectedObjectId)!;
    expect(result.boolean!.op).toBe('subtract');
    expect(result.boolean!.operandIds).toEqual([liveBoolId, a]); // selection order
  });
```

**1c.** ADD a new test (after 1b) confirming style descends to a concrete leaf when the topmost operand is a group:

```ts
  it('inherits the topmost-zOrder LEAF style even when that leaf is inside a group operand', () => {
    const s = useEditor.getState();
    s.newProject();
    const leafAsset = createVectorAsset('rect', { id: 'leaf-asset' });
    leafAsset.style = { ...leafAsset.style, fill: '#aaaaaa' };
    const innerAsset = createVectorAsset('rect', { id: 'inner-asset' });
    innerAsset.style = { ...innerAsset.style, fill: '#cccccc' };
    const leaf = createSceneObject('leaf-asset', { id: 'leaf', zOrder: 0, shapeBase: { width: 20, height: 20 } });
    const inner = createSceneObject('inner-asset', { id: 'inner', parentId: 'grp', zOrder: 5, shapeBase: { width: 20, height: 20 }, base: { x: 40, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
    const group = createGroupObject({ id: 'grp', anchorX: 0.5, anchorY: 0.5, zOrder: 1 });
    const p = createProject();
    p.assets = [leafAsset, innerAsset];
    p.objects = [leaf, inner, group];
    s.commit(p);
    useEditor.getState().selectObjects(['leaf', 'grp']);
    useEditor.getState().booleanOp('union', { live: true });
    const result = useEditor.getState().history.present.objects.find((o) => o.id === useEditor.getState().selectedObjectId)!;
    const asset = useEditor.getState().history.present.assets.find((x) => x.id === result.assetId) as VectorAsset;
    expect(asset.style.fill).toBe('#cccccc'); // inner leaf (zOrder 5) is topmost reachable, not the leaf (zOrder 0)
  });
```

Confirm `createVectorAsset`, `createSceneObject`, `createGroupObject`, `createProject` are imported at the top of `store.test.ts` (the file already uses them in neighboring blocks — add any missing to the `../../engine` import).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/ui/store/store.test.ts -t "live boolean authoring"`
Expected: FAIL — 1a/1b now expect a created boolean but the current filter rejects groups/booleans (returns early → object count unchanged); 1c's `topAsset` would crash or pick the wrong style.

- [ ] **Step 3: Relax the filter to reuse `eligible`**

In `src/ui/store/store.ts`, inside `if (opts?.live && activeAssetId === null) { … }`, replace the `liveOperands` block and the `topLeaf` line. Current:

```ts
      const liveOperands = s.selectedObjectIds
        .map((id) => activeObjects.find((o) => o.id === id))
        .filter((o): o is SceneObject => {
          if (!o || o.isGroup || o.boolean) return false;
          const a = project.assets.find((x) => x.id === o.assetId);
          return a?.kind === 'vector';
        });
      // Self-gate: never a silent partial op. NOTE: the buttons' `canBool` enablement reflects
      // DESTRUCTIVE eligibility (groups + live booleans count); the Alt (live) path is narrower
      // and is only known at click time, so an Alt+click on a selection with <2 live-eligible
      // leaves (e.g. two live booleans, or a leaf + a group) no-ops here — consistent with how the
      // destructive path also self-gates (e.g. disjoint intersect).
      if (liveOperands.length < 2) return;

      const z = nextZOrder(activeObjects);
      const topLeaf = liveOperands.slice().sort((a, b) => b.zOrder - a.zOrder)[0];
      const topAsset = project.assets.find((x) => x.id === topLeaf.assetId) as VectorAsset;
```

Replace with:

```ts
      // Live operands = geometry-contributing selected objects: a vector leaf, a GROUP with vector
      // leaves (union of its leaves), or another LIVE BOOLEAN (its own result). `eligible` already
      // captures exactly this (vectorLeavesOf(o).length > 0), so the live path now matches the
      // buttons' `canBool` enablement — an enabled Alt+click always forms a live boolean.
      const liveOperands = eligible;
      // Self-gate: never a silent partial op.
      if (liveOperands.length < 2) return;

      const z = nextZOrder(activeObjects);
      // Style from the topmost-zOrder VECTOR LEAF reachable from the operands (a group/boolean has
      // no direct asset, so descend to a concrete leaf via vectorLeavesOf).
      const topLeaf = liveOperands.flatMap(vectorLeavesOf).slice().sort((a, b) => b.zOrder - a.zOrder)[0];
      const topAsset = project.assets.find((x) => x.id === topLeaf.assetId) as VectorAsset;
```

The `operandIds: liveOperands.map((o) => o.id)` line below is unchanged (now naturally includes group/boolean ids in selection order).

- [ ] **Step 4: Run the new tests + the full store suite (parity)**

Run: `pnpm vitest run src/ui/store`
Expected: PASS — new tests green AND existing live/destructive boolean tests still green (the leaf-only path is a subset of `eligible`).

- [ ] **Step 5: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/ui/store/store.ts src/ui/store/store.test.ts
git commit -m "feat(boolean): author live booleans from group + nested-boolean operands"
```

---

### Task 5: Export + flatten integration confirmation (no new code)

**Files:**
- Test: `src/services/export/renderDocument.test.ts` (append to `describe('renderSvgDocument — live boolean', …)`)

**Interfaces:**
- Consumes: `resolveBooleanRings` (Task 1), `flattenInstances` consumed-subtree (Task 2), `renderSvgDocument` (already boolean-aware from 3a). No production code changes — this task proves the stack end-to-end.

- [ ] **Step 1: Write the tests**

Append inside `describe('renderSvgDocument — live boolean', () => { … })` in `src/services/export/renderDocument.test.ts`. All four factories (`createGroupObject`, `createProject`, `createSceneObject`, `createVectorAsset`) are already imported at the top of the file. Mirror the existing `liveBoolProject` fixture style (`project.assets = […]; project.objects = […]`):

```ts
  it('exports a live boolean with a GROUP operand: non-empty evenodd path, group leaves absent', () => {
    const g1 = createSceneObject('g1-a', { id: 'g1', parentId: 'grp', zOrder: 0, shapeBase: { width: 20, height: 40 } });
    const g2 = createSceneObject('g2-a', {
      id: 'g2', parentId: 'grp', zOrder: 1, shapeBase: { width: 20, height: 40 },
      base: { x: 20, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    });
    const group = createGroupObject({ id: 'grp', anchorX: 0.5, anchorY: 0.5, zOrder: 0 });
    const cover = createSceneObject('cov-a', { id: 'cover', zOrder: 1, shapeBase: { width: 40, height: 40 } });
    const boolObj = createSceneObject('bg-a', { id: 'boolobj', zOrder: 2, boolean: { op: 'intersect', operandIds: ['grp', 'cover'] } });
    const project = createProject();
    project.assets = [
      createVectorAsset('rect', { id: 'g1-a' }),
      createVectorAsset('rect', { id: 'g2-a' }),
      createVectorAsset('rect', { id: 'cov-a' }),
      createVectorAsset('path', { id: 'bg-a', path: { nodes: [], closed: false } }),
    ];
    project.objects = [g1, g2, group, cover, boolObj];
    const out = renderSvgDocument(project);
    expect(out).toMatch(/data-savig-object="boolobj"[^>]*>\s*<path[^>]*\bd="M[^"]+"[^>]*fill-rule="evenodd"/);
    expect(out).not.toContain('data-savig-object="g1"');
    expect(out).not.toContain('data-savig-object="g2"');
  });

  it('exports a live boolean with a NESTED boolean operand: non-empty path, inner subtree absent', () => {
    // inner = subtract(big 0..40, small interior); outer = union(inner, far disjoint rect).
    const big = createSceneObject('big-a', { id: 'big', zOrder: 0, shapeBase: { width: 40, height: 40 } });
    const small = createSceneObject('small-a', {
      id: 'small', zOrder: 1, shapeBase: { width: 10, height: 10 },
      base: { x: 15, y: 15, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    });
    const inner = createSceneObject('inner-a', { id: 'inner', zOrder: 2, boolean: { op: 'subtract', operandIds: ['big', 'small'] } });
    const far = createSceneObject('far-a', {
      id: 'far', zOrder: 3, shapeBase: { width: 10, height: 10 },
      base: { x: 100, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    });
    const outer = createSceneObject('outer-a', { id: 'boolobj', zOrder: 4, boolean: { op: 'union', operandIds: ['inner', 'far'] } });
    const project = createProject();
    project.assets = [
      createVectorAsset('rect', { id: 'big-a' }),
      createVectorAsset('rect', { id: 'small-a' }),
      createVectorAsset('path', { id: 'inner-a', path: { nodes: [], closed: false } }),
      createVectorAsset('rect', { id: 'far-a' }),
      createVectorAsset('path', { id: 'outer-a', path: { nodes: [], closed: false } }),
    ];
    project.objects = [big, small, inner, far, outer];
    const out = renderSvgDocument(project);
    expect(out).toMatch(/data-savig-object="boolobj"[^>]*>\s*<path[^>]*\bd="M[^"]+"[^>]*fill-rule="evenodd"/);
    expect(out).not.toContain('data-savig-object="inner"'); // inner boolean + its operands render-hidden
    expect(out).not.toContain('data-savig-object="big"');
  });
```

- [ ] **Step 2: Run the export suite**

Run: `pnpm vitest run src/services/export/renderDocument.test.ts`
Expected: PASS — both new tests green (group + nested operands export a non-empty evenodd path; operand subtrees absent).

- [ ] **Step 3: Full unit suite (final parity gate)**

Run: `pnpm vitest run`
Expected: PASS — all tests green.

- [ ] **Step 4: Commit**

```bash
git add src/services/export/renderDocument.test.ts
git commit -m "test(export): confirm group + nested-boolean operands export end-to-end"
```

---

## Notes for the executor

- **Faceted is correct, not a defect:** group/nested operands intentionally have no cubic provenance. Do not add provenance plumbing for them (deferred). A reviewer flagging "group operand result is faceted" should be told it's a documented non-goal.
- **`as VectorAsset` cast** on `topAsset` is safe because `topLeaf` comes from `vectorLeavesOf`, which only yields vector-asset objects.
- **If a store test needs a selection API:** the neighboring live-boolean tests already show how to seed `selectedObjectIds` and call `booleanOp(op, { live: true })`; copy that exact setup rather than inventing one.
- **Do not hand-edit `runtimeSource.generated.ts`** — only regenerate via `pnpm build:runtime` (Task 3).
