# Live Boolean Inside a Group Operand — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a group used as a boolean operand contains a live boolean, that boolean contributes its resolved clip geometry to the group union (instead of being dropped via its empty fallback path).

**Architecture:** Route each of a group operand's collected leaves through `operandWorldGeom` (which dispatches `obj.boolean → resolveBooleanGeom`) instead of calling `objectToWorldPolygon` directly, threading the `visited` cycle guard.

**Tech Stack:** TypeScript (strict), polygon-clipping, Vitest.

## Global Constraints

- **Parity:** a group operand with NO boolean descendant yields byte-identical geometry (the recursive `operandWorldGeom(leaf)` for a plain vector leaf is exactly `objectToWorldPolygon(leaf)`).
- **Cycle-safe:** a boolean descendant that transitively references an ancestor boolean resolves to `[]` (the threaded `visited` set), never infinite recursion.
- **Faceted only:** the group/nested result carries no curve provenance (unchanged; separate task).

---

### Task 1: Resolve boolean descendants in a group operand

**Files:**
- Modify: `src/engine/geom/boolean.ts` (`operandWorldGeom` group branch — the `leaves.map(...)`)
- Test: `src/engine/geom/boolean.test.ts` (append to the existing boolean-operand tests)

**Interfaces:**
- Consumes: `operandWorldGeom(project, obj, time, visited)` (recursing into itself), `collectVectorLeaves`, `resolveBooleanGeom` (reached via the `obj.boolean` branch), `pc.union`.
- Produces: no signature change — `operandWorldGeom` now resolves boolean descendants of a group.

- [ ] **Step 1: Write the failing tests**

Append to `src/engine/geom/boolean.test.ts` (the file already imports `createGroupObject`, `createProject`, `createSceneObject`, `createVectorAsset`, and has the `rectObj` helper):

```ts
describe('boolean operand: a live boolean INSIDE a group operand (resolved, not dropped)', () => {
  it('a group containing a boolean contributes the boolean result + the group siblings', () => {
    // inner boolean = union(p,q): p 0..20, q 15..35  -> spans 0..35
    const p = rectObj('p', 0, 20, 20, 0, 0);
    const q = rectObj('q', 1, 20, 20, 15, 0);
    // innerAsset is load-bearing: collectVectorLeaves only collects `inner` as a leaf because
    // assetOf(inner) is truthy (a vector asset exists for its assetId). Its empty path is never read
    // after the fix (inner routes through resolveBooleanGeom, not objectToWorldPolygon).
    const innerAsset = createVectorAsset('path', { id: 'inner-a', path: { nodes: [], closed: false } });
    const inner = createSceneObject('inner-a', { id: 'inner', parentId: 'grp', zOrder: 2, boolean: { op: 'union', operandIds: ['p', 'q'] } });
    // a sibling rect inside the same group, far to the right: 100..120
    const sib = rectObj('sib', 3, 20, 20, 100, 0);
    sib[0].parentId = 'grp';
    const group = createGroupObject({ id: 'grp', anchorX: 0.5, anchorY: 0.5, zOrder: 4 });
    // outer boolean unions the group with a covering rect so we read the group's contributed extent.
    const cover = rectObj('cover', 5, 200, 40, 0, 0); // 0..200 covers everything
    const outerAsset = createVectorAsset('path', { id: 'outer-a', path: { nodes: [], closed: false } });
    const outer = createSceneObject('outer-a', { id: 'outer', zOrder: 6, boolean: { op: 'intersect', operandIds: ['grp', 'cover'] } });
    const project = {
      ...createProject(),
      objects: [p[0], q[0], inner, sib[0], group, cover[0], outer],
      assets: [p[1], q[1], innerAsset, sib[1], cover[1], outerAsset],
    };
    const rings = resolveBooleanRings(project, outer, 0);
    expect(rings.length).toBeGreaterThan(0);
    const xs = rings.flatMap((r) => r.nodes.map((n) => n.anchor.x));
    // group = (inner union 0..35) ∪ (sib 100..120); intersect with cover(0..200) keeps both.
    expect(Math.min(...xs)).toBeCloseTo(0, 3);   // inner's left edge present (was dropped before)
    expect(Math.max(...xs)).toBeCloseTo(120, 3); // sibling's right edge present
  });

  it('parity: a group of plain rects (no boolean descendant) is unchanged', () => {
    const g1 = rectObj('g1', 0, 20, 40, 0, 0);
    const g2 = rectObj('g2', 1, 20, 40, 20, 0);
    g1[0].parentId = 'grp';
    g2[0].parentId = 'grp';
    const group = createGroupObject({ id: 'grp', anchorX: 0.5, anchorY: 0.5, zOrder: 2 });
    const cover = rectObj('cover', 3, 40, 40, 0, 0);
    const outerAsset = createVectorAsset('path', { id: 'o-a', path: { nodes: [], closed: false } });
    const outer = createSceneObject('o-a', { id: 'outer', zOrder: 4, boolean: { op: 'intersect', operandIds: ['grp', 'cover'] } });
    const project = {
      ...createProject(),
      objects: [g1[0], g2[0], group, cover[0], outer],
      assets: [g1[1], g2[1], cover[1], outerAsset],
    };
    const rings = resolveBooleanRings(project, outer, 0);
    const xs = rings.flatMap((r) => r.nodes.map((n) => n.anchor.x));
    expect(Math.min(...xs)).toBeCloseTo(0, 3);
    expect(Math.max(...xs)).toBeCloseTo(40, 3);
  });
});
```

- [ ] **Step 2: Run the tests to verify the first fails**

Run: `pnpm vitest run src/engine/geom/boolean.test.ts -t "INSIDE a group operand"`
Expected: the first test FAILS on `expect(Math.min(...xs)).toBeCloseTo(0, 3)` — before the fix the nested `inner` boolean is dropped, so the group contributes ONLY `sib` (x 100..120); `Math.min(...xs)` is `100`, not `0`. (The `Math.max(...xs)` assertion passes regardless, since `sib`'s right edge at 120 is present either way — `Math.min` is the discriminating assertion.) The parity test passes (unchanged path for plain leaves).

- [ ] **Step 3: Route group leaves through operandWorldGeom**

In `src/engine/geom/boolean.ts`, in `operandWorldGeom`'s group branch, change the per-leaf map:

```ts
  const leaves: SceneObject[] = [];
  collectVectorLeaves(project, obj.id, leaves, new Set());
  // Route each leaf through operandWorldGeom (not objectToWorldPolygon) so a leaf that is itself a
  // live boolean resolves via resolveBooleanGeom instead of reading its empty fallback path; a plain
  // vector leaf still returns objectToWorldPolygon. `visited` threads the boolean cycle guard.
  const polys = leaves
    .map((l) => operandWorldGeom(project, l, time, visited))
    .filter((g) => g.length > 0);
  if (polys.length === 0) return [];
  if (polys.length === 1) return polys[0];
  return pc.union(polys[0], ...polys.slice(1));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/engine/geom/boolean.test.ts`
Expected: PASS — both new tests + all pre-existing boolean tests (parity, curve preservation, group operand, nested boolean, cycle).

- [ ] **Step 5: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: clean (`operandWorldGeom` returns `PcPolygon | PcMultiPolygon`; `pc.union` and `.filter` accept both).

- [ ] **Step 6: Commit**

```bash
git add src/engine/geom/boolean.ts src/engine/geom/boolean.test.ts
git commit -m "fix(boolean): resolve a live boolean nested inside a group operand"
```

---

## Notes for the executor

- This is a one-line behavioral change (`objectToWorldPolygon` → `operandWorldGeom` in the group map) plus the threaded `visited`. Do not change `collectVectorLeaves` or the cycle-guard model.
- **Cycle safety** is already covered: the threaded `visited` flows into `resolveBooleanGeom` for a boolean descendant, which has the `visited.has(id) → []` guard (exercised by the existing `'returns [] (no infinite recursion) for a cyclic boolean reference'` engine test). A boolean-in-group that transitively references an ancestor boolean therefore resolves to `[]` for that descendant, no hang — no new cycle test needed, but you may add one mirroring the existing cyclic test with the cyclic boolean placed under a group.
- The double-count edge (a boolean AND its operand both being children of the same group) is a documented benign limitation — do not add special handling for it.
- If the parity test drifts, confirm `operandWorldGeom(plainLeaf)` returns exactly `objectToWorldPolygon(plainLeaf)` (it must — same branch).
