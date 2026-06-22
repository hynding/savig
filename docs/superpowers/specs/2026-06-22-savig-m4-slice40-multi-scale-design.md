# Savig M4 Slice 40 — Multi-object scale (group resize)

**Date:** 2026-06-22
**Status:** Approved (autonomous slice cycle — M4)
**Depends on:** Slice 36 (multi-select), Slice 33 (objectAABB + resolveObjectAnchor), Slice 37 (the commit trick), Slice 1/23 (handle patterns)

## 1. Goal

When more than one object is selected, show a **group bounding box with 8 scale
handles**. Dragging a handle scales the WHOLE selection around the opposite
corner/edge (the fixed pivot): each object's position and `scaleX/scaleY` change so
the group resizes together. This is the first multi-object **transform**; group
ROTATE and shift-uniform are follow-ups.

## 2. The math (artboard space)

A group scale by `S = diag(sx, sy)` around an artboard `pivot` should map every visual
point `p → pivot + S·(p − pivot)`. For each selected object:

- Its **anchor point** in artboard space is `pivotObj = anchorLocal + base` (the content
  map sends the local anchor to `anchor + base` for ANY object scale/rotation).
- New anchor point: `pivotObj' = pivot + S·(pivotObj − pivot)`.
- New base: `base' = pivotObj' − anchorLocal` (anchorLocal is unchanged — geometry is
  not touched, only `Transform2D.scale`).
- New scale: `scaleX' = scaleX·sx`, `scaleY' = scaleY·sy` (clamped ≥ `MIN_SCALE`).

Exact for unrotated objects; for rotated objects the scale is applied along the
object's local axes (the standard editor approximation — a non-uniform scale of a
rotated object is a shear the transform model can't represent).

The drag computes `sx/sy` from the group bbox like the single-object resize: the
opposite handle is the fixed pivot, `sx = (pointer.x − pivot.x)/(handle.x − pivot.x)`
(corner: both axes; edge: one axis, the other = 1). Clamp the bbox extent to a small
minimum to avoid divide-by-zero / collapse.

## 3. Architecture

- **Group bbox:** the union of the selected objects' `objectAABB`s (artboard coords),
  recomputed from the committed state. Handles render at its corners/edges in the
  pan/zoom content `<g>` (axis-aligned — no per-object rotation in the GROUP overlay).
- **Geometry stays in the Stage:** the per-object math uses `resolveObjectAnchor`
  (slice 33) to get `anchorLocal`. The drag captures each object's origin
  (`base x/y`, `scaleX/Y`, `anchorLocal`) at start, previews imperatively, and on
  release computes the final transforms.
- **The store gets a generic commit action** `setObjectsTransforms(updates: {id, x, y,
  scaleX, scaleY}[])` — upserts those four tracks per object at the playhead in ONE
  commit (skips locked; one undo step). Mirrors `nudgeSelected`'s shape.
- **Single-object overlays gate to one selection:** the existing scale/resize/rotate/
  gradient overlays gate on `selectedId` (the primary) — add `selectedObjectIds.length
  === 1` so they hide in a multi-selection (the group handles take over).

## 4. Scope (YAGNI)

**In:** the group bbox + 8 scale handles (when `>1` selected); opposite-corner/edge
fixed, non-uniform scale; `setObjectsTransforms`; gating single overlays to 1 selection.

**Out (deferred → next M4 slices):** group ROTATE; shift-uniform group scale; Alt-from-
center; multi-object snapping; transform of a selection that includes a locked object
(locked members are excluded from the scale). Group scale of ROTATED objects is the
local-axis approximation.

**Editor-only:** no engine/export/runtime/persistence change (v4).

## 5. Implementation surface

- `src/ui/components/Stage/snapping.ts` (AABB module): `groupBBox(boxes: AABB[]): AABB
  | null` (union); maybe `scalePointAround(p, pivot, sx, sy)` (or inline).
- `src/ui/store/store.ts`: `setObjectsTransforms(updates)` — fold x/y/scaleX/scaleY
  upserts over the updates (skip locked, guard `!autoKey`) into one commit.
- `src/ui/components/Stage/Stage.tsx`:
  - a `groupBounds` memo (union of selected `objectAABB`s) when `selectedObjectIds.length
    > 1` (non-locked, visible);
  - render 8 group handles (`data-testid="group-handle-<id>"`) on `groupBounds`;
  - `groupScaleRef` drag: pointer-down captures the group bbox + pivot + per-object
    origins (base/scale/anchorLocal); onMove computes `sx/sy`, previews each object via
    `buildTransform`; onUp commits via `setObjectsTransforms`;
  - gate the single-object overlay memos (`selectedScalable`/`selectedVector`/
    `selectedRotatable`/`selectedGradient`) on `selectedObjectIds.length === 1`.

## 6. Testing

**Pure (`snapping.test.ts`):** `groupBBox` unions several AABBs (min of mins, max of
maxes); empty → null.

**Store (`store.test.ts`):** `setObjectsTransforms` writes x/y/scaleX/scaleY for several
objects in ONE commit (one undo step); skips a locked member.

**Stage (`Stage.test.tsx`):** with two unrotated rects selected, a group bbox + handles
render; dragging the SE handle to double the group size doubles each object's scale and
moves each object's anchor so the group scales about the NW pivot (assert known values
with `stubIdentityCTM`); the single-object handles do NOT render in a 2-selection.

**e2e (`multi-scale.spec.ts`):** draw two rects, marquee/Shift-select both, drag a group
corner handle outward → both objects grow and the group bbox enlarges (compare each
object's bounding box before/after).

## 7. Risks

- **Anchor correctness:** `anchorLocal` must come from `resolveObjectAnchor` (fractional
  anchors resolve against geometry) — the same helper the move-preview uses.
- **Divide-by-zero:** clamp the group bbox extent; clamp per-object scale ≥ `MIN_SCALE`.
- **Rotated objects:** documented local-axis approximation; unrotated is exact (tests
  use unrotated rects for exact assertions).
- **Overlay conflict:** without the `length === 1` gate, the primary's single handles
  would overlap the group handles — the gate is load-bearing.
- **Stale closures:** the `groupScaleRef` onMove/onUp window listeners must read store
  state via `getState()` and per-object origins from the ref (slice 38 lesson).
