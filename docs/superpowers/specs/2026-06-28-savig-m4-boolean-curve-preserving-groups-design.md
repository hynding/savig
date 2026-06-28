# Boolean — Curve Preservation for GROUP Operands — Design

**Date:** 2026-06-28
**Status:** Draft (pending review)
**Area:** Savig M4 — boolean follow-ups
**Scope:** Keep bezier/ellipse curvature on the untouched edges of a GROUP operand in a boolean result

## Context

The curve-preserving boolean feature (`f5d4477`) keeps original curvature on untouched edges of LEAF
operands: each leaf contributes its world-space cubics as an `OperandCubics` provenance entry, and
`reconstructRing` projects each clipped output vertex back onto those cubics — a vertex on an untouched
edge matches a source cubic and stays curved; a vertex at an intersection seam matches nothing and
becomes a corner.

GROUP operands were explicitly excluded ("group pre-union loses provenance"). A group is reduced to
the UNION of its leaves' FLAT rings via `operandWorldGeom` and pushed as a flat geom with NO provenance
entry, so every vertex of the group's contribution reconstructs as a corner — a grouped circle returns
a polygon, not 4 curved nodes.

## The insight

The provenance model already DECOUPLES the `geoms` list (what gets clipped) from the `operands` list
(provenance), keying provenance by `opIdx` (not list position). `classifyVertex` projects each output
vertex onto EVERY operand's cubics. So a group can contribute:

- ONE flat geom = the pre-union of its leaves (unchanged — preserves the group-as-one-operand boolean
  semantics: `intersect(big, group{s1,s2}) == big ∩ (s1∪s2)`), AND
- ONE provenance operand PER plain-vector leaf, each with its own `opIdx` and its world cubics.

Then `reconstructRing` projects each union-boundary vertex onto the per-leaf cubics: a vertex on an
untouched leaf edge matches that leaf's cubic → curved; a vertex at a union seam (where two leaves
meet) or a clip intersection matches nothing → corner. The pre-union boundary is built from the leaves'
flat rings (`cubicsToRing`), so its vertices lie ON the leaf cubics within tolerance — exactly the
match-back condition the leaf path already relies on.

**Per-leaf `opIdx` (not one shared group opIdx) is required.** `reconstructRing`'s `verbatim`
shortcut — "all vertices share one opIdx → rebuild from that operand's segs in order" — assumes an
operand's segs form ONE ring. A group's leaves form MULTIPLE (disjoint) rings, so a shared opIdx would
make `verbatim` rebuild all leaves' segs as one bogus ring. Per-leaf opIdx makes `verbatim` fire
correctly per leaf (an untouched leaf survives whole and curved).

## Goal

A group operand's plain-vector leaf edges that survive a boolean keep their curvature (a grouped
circle ∩ a covering rect returns the curved circle; a grouped circle unioned with a disjoint rect
returns the curved circle + the rect). Union seams between group members, and clip intersections, stay
cornered. Faceted-only inputs (rects, corner paths) are byte-identical to before.

### Non-goals

- **Nested-boolean operands** stay faceted (their result has no original cubics; preserving their
  curvature requires threading provenance through the nested clip — a separate follow-up).
- **Boolean / nested-group / SVG leaves** of a group stay faceted (only plain-vector leaves —
  rect/ellipse/path — carry cubics via `operandCubicsWorld`).
- Changing boolean semantics, the seam-stitch approximation, or the leaf-operand path.

## Architecture

`src/engine/geom/boolean.ts`, `booleanResultGeom`'s operand loop. Today each `o` is either a
cubic-bearing leaf (`operandCubicsWorld(o).length >= 2` → provenance + `[ring]` geom) or "everything
else" (flat `operandWorldGeom` geom, no provenance). Add a GROUP branch between them:

```ts
for (const o of sorted) {
  const cubics = operandCubicsWorld(project, o, time);
  if (cubics.length >= 2) {
    // leaf with provenance (unchanged)
    const id = opIdx++;
    operands.push({ opIdx: id, segs: cubics });
    const ring = cubicsToRing(cubics);
    for (const [x, y] of ring) fold(x, y);
    geoms.push([ring]);
  } else if (o.isGroup) {
    // GROUP: ONE flat pre-union geom (semantics) + ONE provenance operand per plain-vector leaf
    // (curve preservation). Per-leaf opIdx so reconstructRing's verbatim path works per leaf.
    const leaves: SceneObject[] = [];
    collectVectorLeaves(project, o.id, leaves, new Set());
    for (const leaf of leaves) {
      const lc = operandCubicsWorld(project, leaf, time); // [] for boolean/nested-group leaves
      if (lc.length >= 2) {
        operands.push({ opIdx: opIdx++, segs: lc });
        const lr = cubicsToRing(lc);
        for (const [x, y] of lr) fold(x, y);
      }
    }
    const g = operandWorldGeom(project, o, time, visited); // pre-union (faceted leaves union flat)
    if (g.length > 0) geoms.push(g);
  } else {
    // nested boolean / non-vector / fallback flat geom, no provenance (faceted, unchanged)
    const g = operandWorldGeom(project, o, time, visited);
    if (g.length > 0) geoms.push(g);
  }
}
```

`reconstructRing`, `classifyVertex`, `tol`, the `geoms`/`operands` opIdx decoupling, and the per-ring
try/catch → faceted fallback are all UNCHANGED — the group simply now appears in `operands` as several
per-leaf entries. The `fold` over each leaf's ring extends the bbox (and thus `tol`) to include group
extent, which the old flat-group branch omitted — strictly more correct for `tol`.

## Edge cases

- **Group of a single circle, intersected with a covering rect:** result ring = the circle; all
  vertices match the one leaf's opIdx → `verbatim` → rebuild from the 4 KAPPA cubics → curved. Matches
  the bare-circle-leaf behavior.
- **Group of two abutting circles, unioned:** the merged boundary's outer arcs match each leaf →
  curved. The seam points where the circles meet are NEW intersection vertices; they become corners
  *unless* a seam point happens to lie within `tol` of one circle's cubics (e.g. exactly-tangent or
  heavily-overlapping circles), in which case it projects onto that circle and keeps a curve handle —
  the SAME seam-stitch approximation the existing leaf-operand path already has (curvature exact away
  from seams, minutely curved/straight right at them). This is inherited, not introduced; see Deferred.
- **Group of rects (all corners):** every leaf cubic is straight; `reconstructRing`/`segmentsToPathData`
  emit corner nodes → byte-identical to the old faceted output. PARITY.
- **Boolean / nested-group / SVG leaf inside the group:** `operandCubicsWorld` returns `[]` → no
  provenance → that part of the union boundary is faceted (documented scope). Its GEOMETRY still
  contributes via `operandWorldGeom` (which resolves boolean descendants if the boolean-in-group task
  has shipped; orthogonal to this task).
- **Degenerate leaf:** `operandCubicsWorld` `[]` → skipped; the flat geom still unions whatever has
  area.
- **Per-ring reconstruction failure:** the existing try/catch falls back to `ringToPathData` (faceted)
  — never throws or corrupts.

## Files touched

- `src/engine/geom/boolean.ts` — the GROUP branch in `booleanResultGeom`'s operand loop.
- `src/engine/geom/boolean.test.ts` — grouped-circle intersect keeps curvature; grouped-rects parity;
  grouped two-circle union curves-with-seam-corners.

## Testing

- **Engine (unit):**
  - `intersect(coveringRect, group{circle})` → the result ring has FEW nodes (≈4) whose handles are
    non-trivial (curved), and its midpoints lie on the circle (reuse the ellipse-on-curve check from
    the existing curve tests). Was: many faceted nodes.
  - `union(group{circle}, disjointRect)` → the circle ring stays curved (≈4 nodes), the rect ring is 4
    corners.
  - **Parity:** `intersect(coveringRect, group{rectA, rectB})` → corner nodes only, identical bounds /
    ring count to the pre-change faceted output (pin node-is-corner: every node's `in`/`out` equals its
    anchor, i.e. no handles).
  - A group whose only members are a nested boolean / SVG → still faceted (no provenance), no crash.
- **Parity (regression):** the entire existing boolean suite (leaf curve preservation, group operand
  ring counts, nested operands, cycle) stays green — the change only ADDS per-leaf operands for groups.

## Open / deferred

- Curve preservation for NESTED-boolean operands (provenance through the nested clip).
- Curve preservation for SVG-asset operands (depends on the SVG-operand task + its own provenance).
- Seam-stitch approximation (curved run ends ≤1/16-segment short of the true intersection) is inherited
  from the leaf feature, unchanged.
