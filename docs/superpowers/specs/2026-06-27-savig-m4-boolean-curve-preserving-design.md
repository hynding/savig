# Curve-Preserving Boolean Results (v1) — Design

**Date:** 2026-06-27
**Status:** Approved (pending spec review)
**Area:** Savig M4 — boolean follow-ups
**Scope:** Leaf (non-group) vector operands only

## Problem

Boolean ops (`union`/`subtract`/`intersect`/`exclude`) currently produce **faceted
polyline** results. `localOutline` (src/engine/geom/boolean.ts) flattens every operand
— paths via `flattenPath`, ellipses via 64-step sampling — into dense **corner-only**
point rings, and `ringToPathData` emits `PathNode`s with `anchor` only (no bezier
handles). So a circle subtracted from a rectangle comes back as a 64-gon bite, and any
curved input loses its curvature.

`polygon-clipping` is a flat-polygon engine: it has no concept of bezier curves and does
not preserve input-vertex identity. "Preserving curves" is therefore not a flag — it is
a recovery problem layered on top of the existing clip.

## Goal

**Highest-fidelity preservation:** where the boolean did NOT cut, the original
bezier/circle/ellipse outline survives (as exact sub-curves); only the new seams along
intersections become corners. This matches Illustrator/Figma behavior.

### Non-goals (v1)

- **Group operands** keep today's faceted behavior. A group operand is itself a
  `pc.union` of its leaves (`operandWorldGeom`) — a second clip stage that destroys
  provenance — so curve preservation across the group-union seam is deferred to a
  fast-follow.
- **SVG operands** remain excluded (separate follow-up).
- **Animated/live boolean** remains out of scope — results are still baked as a static
  snapshot at the current `time` (separate follow-up). Curve preservation runs per-frame
  the same way, but the output is still a consumed, static asset.

## Architecture

All changes live in **`src/engine/geom/boolean.ts`** (plus one possible small fix in
`pathBounds`, see Integration §). The public signature is unchanged:

```ts
export function booleanOp(project, objs, op, time): PathData[]
```

It still returns `PathData[]`; the difference is that result nodes now carry `in`/`out`
handles. The store handler (`store.ts` `booleanOp`), Inspector `canBool`, and keyboard
shortcuts are **untouched**.

`PathNode.in`/`out` are stored as **offsets relative to the anchor** (engine/types.ts),
and offsets are translation-invariant, so the store's `shift()` (which only translates
anchors) stays correct as-is with handles present. Confirmed — no store change for shift.

### Pipeline

Replaces the current "flatten → clip → corner-only rings" flow:

1. **Outline → cubic segments (world space).** Each leaf operand's outline becomes an
   ordered list of cubic bezier segments `{ p0, c1, c2, p3 }` in **world** coordinates:
   - **path** — one cubic per consecutive node pair, from `anchor` + `out`/`in` offsets;
     a missing handle ⇒ that control point coincides with its anchor (straight/degenerate
     cubic). Respects `closed` (last→first segment for closed paths).
   - **rect** — 4 straight cubics.
   - **ellipse** — **4 quadrant cubics** using kappa `0.5522847498`. A circle/ellipse
     round-trips as ~4 curved nodes instead of a 64-gon. This is the headline visible win.
   - Affine transforms (translate/rotate/scale/skew + group-ancestor chain via the
     existing `toWorld`) apply directly to control points; beziers are affine-invariant,
     so the world-space cubics are exact.

2. **Flatten with provenance (clip input).** Sample each segment into points tagged
   `{ opIdx, segIdx }`. (Sample `t` is NOT relied on for output matching — see step 4.)
   Density is **moderate** — just enough for clip topology accuracy. The flattened,
   closed rings are the input to `polygon-clipping`.

3. **Clip.** Run `polygon-clipping` exactly as today
   (`union`/`intersection`/`xor`/`difference`), bottom-most operand first (zOrder sort,
   unchanged). Output is a `MultiPolygon` of flat rings.

4. **Match-back by curve projection** (NOT nearest-sample). For each output vertex,
   project it onto the candidate source **cubics** (pre-filtered by segment bbox) and
   recover its nearest-point `t`:
   - Within tolerance of some source cubic ⇒ inherit provenance `(opIdx, segIdx, t)`,
     where `t` is the **projected** parameter (exact position on the source curve).
   - No source cubic within tolerance ⇒ genuine **intersection vertex** ⇒ corner.

   Projection-based matching (vs. matching to a tagged sample) is deliberate: it absorbs
   `polygon-clipping`'s inserted T-junction points (they lie *on* the curve, so they
   extend a run instead of kinking it), it removes the brittle epsilon-vs-sample-spacing
   coupling, and it yields exact intersection `t` for clean splits (step 5).

5. **Reconstruct curves per ring.**
   - **No-corner ring (verbatim case):** if a ring's vertices all share contiguous
     single-operand provenance forming a closed loop with **zero** intersection vertices
     (disjoint union, or one operand fully inside another under intersect), rebuild the
     operand's original segments directly — the operand survives verbatim (e.g. union of
     two separate circles → two real circles, 4 curved nodes each). This is the
     best-fidelity path and is handled explicitly, before the general walk.
   - **General case:** rotate the ring to start at a corner, then walk it grouping
     **maximal runs** of consecutive vertices sharing the same `(opIdx, segIdx)` with
     **monotonic** `t` (increasing OR decreasing — `polygon-clipping` reorients rings to
     GeoJSON winding, so `t` may decrease). For each run, **De Casteljau split** the
     source cubic at `[min(t), max(t)]`; if the run traverses with decreasing `t`,
     **reverse** the resulting sub-cubic so `in`/`out` point along traversal. Emit `out`
     on the run's first node and `in` on its last (as anchor-relative offsets).
     Intersection vertices and run boundaries ⇒ corner nodes (no handles). Because the
     run boundaries carry the projected intersection `t` (step 4), each sub-curve meets
     the seam exactly — no straight nub/gap.

6. **Emit `PathData[]`.** Closed rings with handled nodes. Holes/disjoint pieces stay
   separate rings; the store already routes the largest-area ring to `primary` and the
   rest to `compoundRings`, with even-odd fill handling holes.

### Parity-safe per-ring fallback

If reconstruction throws or yields a degenerate ring (<3 nodes), fall back to today's
`ringToPathData` **corner-only** output **for that ring only** — never a silent
whole-op failure. Matches the project's "byte-identical fallback when no match"
convention. Straight-only inputs (rect ∩ rect) naturally collapse to corner nodes at
corners + intersections, so they stay effectively identical to today.

## Integration & verification

- **`pathBounds` / bezier extent (verify before coding).** The store derives the
  result's bounding box and `base.x/y` shift via `pathBounds` on the result `PathData`.
  If `pathBounds` measures **anchors only**, a curve that bulges past its anchors will be
  clipped at the result-bounds edge and `base.x/y` will be slightly off. Verify
  `pathBounds` accounts for control points; if it does not, extend it to include bezier
  extent (in scope, small).
- **`shift()` (store.ts):** no change — handles are relative offsets (confirmed).
- **`ringArea` (store primary-ring selection):** reads anchors only; ordering stays
  stable since anchors are unchanged relative to today. Curve-bulge does not affect
  anchor-area ordering. Caveat noted, no change.

## Performance

Operand counts are tiny (usually 2 shapes). Projection-based matching with a per-segment
bbox pre-filter on candidates is sufficient; no spatial index for v1. Keep flatten
density moderate. A spatial index is a noted future lever only if complex paths get slow.

## Testing

Unit tests in `src/engine/geom/boolean.test.ts`:

- **Parity:** rect ∩ rect, rect ∪ rect → corner-only nodes, ~identical to today (green
  without new-expectation churn).
- **Curve preservation (changed expectations — intentional, with new handles):**
  - circle ∪ offset-rect → outer arc stays curved, seam vertices are corners.
  - rect minus a circular bite (`subtract`) → rect corners + curved bite.
  - circle fully inside rect (`intersect`) → circle verbatim (~4 curved nodes).
- **Verbatim / no-corner ring:** two disjoint circles `union` → two real circles.
- **Affine:** rotated/skewed ellipse operand → correctly curved reconstruction.
- **Holes:** donut via `subtract` → curved hole ring.
- **Robustness:** degenerate/empty operand geometry → fallback, **no throw**.

Existing ellipse-based boolean assertions are updated intentionally to the new
curved-node expectations; rect-based assertions are expected to remain green.

E2E (`e2e/boolean-ops.spec.ts`): a smoke check that a circle-involved boolean produces a
result object with handled nodes (curved), guarding the engine→store→render path.

## Files touched

- `src/engine/geom/boolean.ts` — new cubic-segment model, provenance flatten,
  projection match-back, De Casteljau split/reverse, ring reconstruction, per-ring
  fallback. (Helpers may be split into a sibling module if the file grows too large,
  e.g. `boolean-curves.ts`, following the codebase's focused-file preference.)
- `src/engine/path.ts` (or wherever `pathBounds` lives) — only if `pathBounds` ignores
  control-point extent.
- `src/engine/geom/boolean.test.ts` — updated ellipse expectations + new cases.
- `e2e/boolean-ops.spec.ts` — curved-result smoke check.

## Open risks (accepted for v1)

- Kappa ellipse approximation has ~0.06% max radial error (invisible).
- Group and SVG operands remain faceted/excluded (deferred follow-ups).
- Result remains a baked static snapshot (animated boolean is a separate follow-up).
