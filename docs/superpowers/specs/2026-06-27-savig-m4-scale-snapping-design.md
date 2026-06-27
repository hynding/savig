# Scale Position-Snapping — Design

**Date:** 2026-06-27 · **Milestone:** M4 (snapping follow-up — slice 33/44 deferral)
**Status:** approved design, ready for implementation plan

## Problem

Today only MOVE drags snap to other objects' edges/centers + the artboard (slice 33/44, via
`computeSnap` + alignment guides). Resizing/scaling does NOT snap — the dragged edge can't be
aligned to another object while scaling. This adds position-snapping to all three scale drag
machines, including the uniform (Shift) and from-center (Alt) modifiers.

## Key idea: snap the POINTER onto (constraint ∩ guide), not the factor

Each scale handler reads the pointer, then derives scale factors. The single-object handlers
(`applyScaleHandleDrag`, resize) internally PROJECT the pointer — through `R(-rotation)`, and under
uniform onto the start diagonal. So snapping the raw pointer first and letting them re-project would
move the edge OFF the guide. Instead, the snap helper returns an **adjusted pointer that already lies
on the mode's constraint AND on the target line**; passing that to the existing projection is then a
no-op (projecting a diagonal point onto the diagonal is identity), so the edge lands exactly on the
guide and `applyScaleHandleDrag`/resize stay **unchanged**.

## Architecture

New pure, unit-tested module `src/ui/components/Stage/scaleSnap.ts` with two helpers:

### 1. `snapScalePoint(p, sxAxis, syAxis, targets, threshold) → { x, y, guideX, guideY }`
Free (non-uniform) snap for an axis-aligned drag. Builds a degenerate AABB at `p`, runs the existing
`computeSnap`, and applies the resulting dx/dy ONLY on the dragged axes (`sxAxis`/`syAxis` — an edge
handle moves one axis, a corner both). Returns the snapped point + the matched guide line(s).
Used by: the group/multi-select scale handler (group bbox is always axis-aligned, no modifiers), and
the single-object free (non-uniform, rotation≈0) case.

### 2. `snapScaleAlongSegment(p, segStart, segEnd, targets, threshold) → { x, y, guideX, guideY }`
Constrained snap for uniform (segment = opposite-corner-content `oC` → corner-content `cC`) and
from-center (segment = anchor-content `aC` → corner-content `cC`). Steps: project `p` onto the
segment → `P`; for each target vertical line `Lx` near `P.x`, compute the segment point with `x = Lx`
(`t = (Lx − segStart.x)/(segEnd.x − segStart.x)`, clamped to the segment's valid range), and likewise
for each horizontal line `Ly` near `P.y`; pick the candidate whose distance to `P` is smallest and
within `threshold`; return it (which lies ON the segment) + that guide. If no candidate, return `P`
(the unconstrained projection — identity to today). The grabbed edge lands on the guide; the other
axis follows proportionally (standard uniform/center snap behavior).

## Wiring (all gated on `snapEnabled`; threshold `SNAP_PX / zoom`)

Each scale handler builds `targets` on pointer-down — every OTHER object's `entityAABB` plus the
artboard rect — exactly as the move drag does, and stores it on its drag ref. On move:

1. **Group / multi-select scale** (`groupScaleRef`): snap the dragged corner `cur` via
   `snapScalePoint`, then derive `sx/sy` from the snapped corner.
2. **Single-object scale** (`scaleRef` → `applyScaleHandleDrag`): compute the adjusted pointer
   (free → `snapScalePoint`; uniform → `snapScaleAlongSegment` on the `oC→cC` diagonal; from-center →
   `snapScaleAlongSegment` on the `aC→cC` ray), then call `applyScaleHandleDrag` with that pointer
   UNCHANGED otherwise.
3. **Single-object resize** (`resizeRef`, rect/ellipse geometry): same, against its resize helper.

Alignment guides reuse the existing `guides` state + Stage overlay (the same lines move-snap shows).

## Rotation (v1 limit)

Snapping engages only when the dragged object's effective rotation ≈ 0 (`|rotation| < EPS`). For a
ROTATED single object the scale axes aren't screen-aligned, so landing an axis-aligned guide has no
clean factor solution — those drags scale unsnapped (no guide). Group scale is unaffected: the
group/multi-select bbox is always an axis-aligned AABB. Uniform + from-center are fully supported in
the axis-aligned case.

## Data flow

pointer-move → (snapEnabled?) compute adjusted pointer/corner via `scaleSnap` against the drag ref's
`targets` → existing factor math (`applyScaleHandleDrag`/resize/group-derive) → imperative preview +
guide overlay; pointer-up commits the (snapped) transform through the existing path.

## Edge cases

- Snap disabled, or no target within threshold → behavior byte-identical to today (helpers return the
  raw point/projection).
- Edge handle (one axis) → only that axis snaps.
- Degenerate denominators (`MIN_SCALE` clamps) unchanged — snapping only adjusts the pointer before
  the existing clamped math.
- All-group/instance neighbors still contribute `entityAABB` targets (groups/instances included as
  snap TARGETS, like move-snap).

## Scope

**In (v1):** position-snap for group scale + single scale + single resize; free + uniform +
from-center; reuse `computeSnap`/guides; rotation≈0 gate. Tests: `scaleSnap` unit suite
(free/uniform/center × x-line / y-line / none / edge-axis), plus an e2e (resize an object so its edge
snaps to a neighbor's edge, guide appears).

**Out (non-goals, documented):** snapping a ROTATED single object's scale; snapping the ROTATE handle
(angle-snap — a separate future slice); distance/spacing guides; snap-to-grid.

## Parity / invariants

Editor-chrome only — drag preview + the committed transform. No change to `flattenInstances` /
`computeFrame` / `renderSvgDocument` / runtime. Snap-disabled and no-target paths are byte-identical
to today.
