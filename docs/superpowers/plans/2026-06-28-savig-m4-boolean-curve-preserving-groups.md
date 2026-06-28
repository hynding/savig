# Curve Preservation for GROUP Operands — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A group used as a boolean operand keeps its plain-vector leaves' curvature on untouched edges (a grouped circle stays curved through a boolean), with union seams + clip intersections still cornered.

**Architecture:** In `booleanResultGeom`'s operand loop, a GROUP pushes ONE flat pre-union geom (unchanged semantics) PLUS one `OperandCubics` provenance entry PER plain-vector leaf, each with its own `opIdx`. The existing `reconstructRing`/`classifyVertex` projection match-back then preserves curves on untouched leaf edges. No change to the reconstruct machinery.

**Tech Stack:** TypeScript (strict), polygon-clipping, the provenance module `geom/boolean-curves.ts`, Vitest.

## Global Constraints

- **Parity:** all-corner inputs (rects, corner paths), leaf operands, and groups whose leaves are all faceted reconstruct byte-identically. Corner = a node with no `in`/`out` handles.
- **Per-leaf `opIdx`** (NOT one shared group opIdx) — required so `reconstructRing`'s `verbatim` path (all-same-opIdx → rebuild from that operand's segs as one ring) works per leaf, since a group's leaves form multiple disjoint rings.
- **Scope = plain-vector leaves only** (`operandCubicsWorld` returns cubics for rect/ellipse/path; `[]` for boolean / nested-group / SVG leaves → those stay faceted).
- The flat pre-union geom (`operandWorldGeom(group)`) and the boolean semantics are unchanged.

---

### Task 1: Per-leaf provenance for group operands

**Files:**
- Modify: `src/engine/geom/boolean.ts` (`booleanResultGeom`'s operand loop — add a `o.isGroup` branch between the cubic-leaf branch and the flat-fallback branch)
- Test: `src/engine/geom/boolean.test.ts` (append to `describe('booleanOp curve preservation', …)`)

**Interfaces:**
- Consumes: `operandCubicsWorld(project, leaf, time): Cubic[]`, `collectVectorLeaves(project, groupId, out, seen)`, `cubicsToRing(cubics)`, the `operands`/`geoms`/`opIdx`/`fold` locals, `operandWorldGeom`.
- Produces: a group operand now appears in `operands` as one entry per plain-vector leaf; `reconstructRing` (unchanged) consumes them.

- [ ] **Step 1: Write the failing tests**

Append inside `describe('booleanOp curve preservation', () => { … })` in `src/engine/geom/boolean.test.ts` (the file has `ellipseObj`, `rectObj`, `createGroupObject`, `createProject`, `createVectorAsset`, `proj`, and `import { evalCubic } from './boolean-curves'`):

```ts
  it('grouped circle ∩ a covering rect keeps the circle curved (≈4 curved nodes)', () => {
    const circ = ellipseObj('gc', 0, 20, 20, 0, 0); // center (20,20), radius 20
    circ[0].parentId = 'cg';
    const group = createGroupObject({ id: 'cg', anchorX: 0, anchorY: 0, zOrder: 1 });
    const cover = rectObj('cov', 2, 60, 60, -10, -10); // (-10,-10)..(50,50) fully covers the circle
    const project = {
      ...createProject(),
      objects: [circ[0], group, cover[0]],
      assets: [circ[1], cover[1]],
    };
    const rings = booleanOp(project, [group, cover[0]], 'intersect', 0);
    expect(rings.length).toBe(1);
    expect(rings[0].nodes.length).toBeLessThanOrEqual(8); // curved, not faceted (~64)
    expect(rings[0].nodes.some((n) => n.in || n.out)).toBe(true);
  });

  it('union of a grouped circle with a disjoint rect: circle curved, rect cornered', () => {
    const circ = ellipseObj('uc', 0, 20, 20, 0, 0);
    circ[0].parentId = 'ucg';
    const group = createGroupObject({ id: 'ucg', anchorX: 0, anchorY: 0, zOrder: 1 });
    const far = rectObj('uf', 2, 10, 10, 200, 0); // disjoint
    const project = {
      ...createProject(),
      objects: [circ[0], group, far[0]],
      assets: [circ[1], far[1]],
    };
    const rings = booleanOp(project, [group, far[0]], 'union', 0);
    expect(rings.length).toBe(2);
    const curvedRing = rings.find((r) => r.nodes.some((n) => n.in || n.out));
    const cornerRing = rings.find((r) => r.nodes.every((n) => !n.in && !n.out));
    expect(curvedRing).toBeTruthy(); // the circle
    expect(cornerRing).toBeTruthy(); // the rect
    expect(cornerRing!.nodes.length).toBe(4);
  });

  it('parity: grouped rects ∩ a covering rect stays corners-only', () => {
    const r1 = rectObj('pr1', 0, 20, 40, 0, 0); // x 0..20
    const r2 = rectObj('pr2', 1, 20, 40, 20, 0); // x 20..40 (abuts)
    r1[0].parentId = 'pg';
    r2[0].parentId = 'pg';
    const group = createGroupObject({ id: 'pg', anchorX: 0, anchorY: 0, zOrder: 2 });
    const cover = rectObj('pcov', 3, 40, 40, 0, 0);
    const project = {
      ...createProject(),
      objects: [r1[0], r2[0], group, cover[0]],
      assets: [r1[1], r2[1], cover[1]],
    };
    const rings = booleanOp(project, [group, cover[0]], 'intersect', 0);
    expect(rings.length).toBe(1);
    expect(rings[0].nodes.every((n) => !n.in && !n.out)).toBe(true); // faceted/corners, parity
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/engine/geom/boolean.test.ts -t "grouped circle|grouped circle with a disjoint|grouped rects"`
Expected: the two curved-group tests FAIL (the grouped circle reconstructs as a many-node faceted polygon, `nodes.length <= 8` fails / `some(n.in||n.out)` is false). The grouped-rects parity test PASSES (rects are corners either way).

- [ ] **Step 3: Add the GROUP branch to `booleanResultGeom`**

In `src/engine/geom/boolean.ts`, `booleanResultGeom`'s `for (const o of sorted)` loop, replace the `else { … flat geom … }` tail so the group case is handled before the generic fallback:

```ts
  for (const o of sorted) {
    const cubics = operandCubicsWorld(project, o, time);
    if (cubics.length >= 2) {
      const id = opIdx++;
      operands.push({ opIdx: id, segs: cubics });
      const ring = cubicsToRing(cubics);
      for (const [x, y] of ring) fold(x, y);
      geoms.push([ring]);
    } else if (o.isGroup) {
      // GROUP operand: ONE flat pre-union geom (preserves group-as-one-operand semantics) PLUS one
      // provenance operand per plain-vector leaf (curve preservation). Per-leaf opIdx so
      // reconstructRing's verbatim path rebuilds each untouched leaf as its own ring. Boolean /
      // nested-group / SVG leaves yield no cubics -> they stay faceted via the flat geom.
      const leaves: SceneObject[] = [];
      collectVectorLeaves(project, o.id, leaves, new Set());
      for (const leaf of leaves) {
        const lc = operandCubicsWorld(project, leaf, time);
        if (lc.length >= 2) {
          operands.push({ opIdx: opIdx++, segs: lc });
          const lr = cubicsToRing(lc);
          for (const [x, y] of lr) fold(x, y);
        }
      }
      const g = operandWorldGeom(project, o, time, visited);
      if (g.length > 0) geoms.push(g);
    } else {
      // nested boolean / non-vector / fallback flat geom, no provenance (faceted, unchanged).
      const g = operandWorldGeom(project, o, time, visited);
      if (g.length > 0) geoms.push(g);
    }
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/engine/geom/boolean.test.ts`
Expected: PASS — the three new tests AND the full existing boolean suite (leaf curve preservation, the existing "mixed group + leaf union" test [its group is rects → unaffected], group operand ring counts, nested operands, cycle, `operandWorldRings`).

- [ ] **Step 5: Typecheck**

Run: `pnpm tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/engine/geom/boolean.ts src/engine/geom/boolean.test.ts
git commit -m "feat(boolean): curve-preserving GROUP operands (per-leaf cubic provenance)"
```

---

## Notes for the executor

- The change ONLY adds per-leaf `operands` entries and a `fold` for the group's extent. `reconstructRing`, `classifyVertex`, `tol`, and the `geoms`/`operands` opIdx decoupling are untouched.
- A group leaf that is a boolean / nested group / SVG returns `[]` from `operandCubicsWorld` → no provenance for it (faceted) — this is the documented scope, not a bug.
- If a curved-group test shows corners, confirm the leaf's flat ring (`cubicsToRing(lc)`) vertices lie on its cubics (they must — same construction the leaf path uses) so `classifyVertex` matches within `tol`.
- Do NOT give a group one shared opIdx with all leaves' segs — that breaks `reconstructRing`'s verbatim path (multiple disjoint rings under one opIdx).
