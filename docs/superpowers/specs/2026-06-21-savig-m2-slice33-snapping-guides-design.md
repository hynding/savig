# Savig M2 Slice 33 — Stage snapping / alignment guides

**Date:** 2026-06-21
**Status:** Approved (autonomous slice cycle — true-M2-polish program 3/5)
**Depends on:** M1 move-drag, Slice 23/26 handle math (content() transform), Slice 31 (curve-tight bounds)

## 1. Goal

While **dragging an object** with the select tool, snap its bounding box to nearby
alignment lines — other objects' box edges/centers and the artboard edges/center —
and draw the matched **alignment guide** lines. This is the "C-list" snapping/guides
item deferred since M1.

## 2. Approach

**Pure editor UX, zero engine impact.** Snapping is a transform of the drag *input*
(it nudges `x/y` before commit) and a chrome overlay; it never touches geometry data,
export, the runtime, or persistence. All new code lives in the Stage layer
(`src/ui/components/Stage/`), mirroring `scaleHandles.ts`/`handleMath.ts`.

Two pure pieces + Stage wiring:

1. `transformedAABB(localRect, t)` — the axis-aligned stage-space box of a shape:
   transform the local bbox's 4 corners by the same `content(p) = anchor +
   R(rot)·diag(sx,sy)·(p−anchor) + base` used by the handle math, take min/max.
   (AABB-of-corners → correct for rotated objects too.)
2. `computeSnap(moving, targets, threshold)` — per axis independently, find the
   nearest (movingLine, targetLine) pair within `threshold` among the box's three
   lines (min / center / max). Returns `{dx, dy, guideX, guideY}` — the offset to
   apply and the guide-line coordinates (null when no snap on that axis).
3. Stage: at drag start compute the dragged object's base AABB + the target AABBs
   (every OTHER object + the artboard `{0,0,metaW,metaH}`); each pointer-move shift
   the moving AABB by the drag delta, `computeSnap`, add `dx/dy` to the previewed
   `x/y`, and render the guides; clear guides on pointer-up. Commit the snapped `x/y`.

## 3. Snap model

- **Lines per box, per axis:** `min`, `center=(min+max)/2`, `max`. X lines are vertical
  (snapping aligns the object horizontally → a **vertical** guide at `x=guideX`); Y
  lines horizontal (→ a horizontal guide at `y=guideY`).
- **Threshold:** `SNAP_PX = 6` screen px, converted to content space as `6 / zoom`
  so the feel is constant across zoom.
- **Selection per axis:** the candidate with the smallest `|targetLine − movingLine|`
  ≤ threshold wins (ties → first; deterministic). Axes are independent (can snap X
  only, Y only, both, or neither).
- **Targets:** all objects except the dragged one (their current sampled AABBs) plus
  the artboard rect. Locked/hidden objects: include as targets (you still align to
  them) — matches common editors.
- **Toggle:** a store `snapEnabled` boolean (default `true`), flipped by a toolbar
  control; when off, the drag is unsnapped and no guides draw. (A temporary
  hold-to-bypass modifier is deferred — Shift/Alt are already taken by scale/resize.)

## 4. Scope (YAGNI)

**In:** object **move-drag** snapping + alignment guides; snap to other objects +
artboard; edges + centers; `snapEnabled` toggle; pure `transformedAABB` + `computeSnap`.

**Out (deferred, tracked):** snapping the resize/scale/rotate handles or node drags;
distance/spacing (equal-gap) guides; snap-to-grid; snapping during multi-select move
(no multi-select yet — M4); hold-to-bypass modifier; persisting the toggle across
sessions (it is in-memory).

**Editor-only:** no engine/export/runtime/persistence/migration change (v4); no bundle
regen.

## 5. Implementation surface

- `src/ui/components/Stage/snapping.ts` (new): `AABB`, `transformedAABB`, `computeSnap`,
  `SNAP_PX`.
- `src/ui/store/store.ts`: `snapEnabled: boolean` (default true, OUTSIDE
  `TRANSIENT_DEFAULTS` so it survives `newProject` like a preference) + `toggleSnap()`
  / `setSnapEnabled(b)`.
- `src/ui/components/Stage/Stage.tsx`: in the move-drag `onPointerDown` snapshot the
  base AABB + targets; in `onMove` apply `computeSnap` (gated on `snapEnabled`) and set
  guide state; render a guide overlay (`<line data-testid="snap-guide-x|y">`); clear on
  `onUp`.
- A toolbar toggle (existing toolbar/`FileToolbar` or `ToolPalette` area): a "Snap"
  checkbox/button bound to `snapEnabled`/`toggleSnap`.

## 6. Testing

**Pure (`snapping.test.ts`):**
- `transformedAABB` of an unrotated rect (base+scale) → exact AABB; of a 90°-rotated
  rect → swapped extents (corner AABB correct).
- `computeSnap`: moving box whose left edge is 3px from a target's left edge (within
  threshold 6) → `dx` aligns them, `guideX` = that edge; no Y snap → `dy=0, guideY=null`.
- center-to-center snap; max(right)-edge snap; nearest-wins among several candidates;
  beyond-threshold → no snap; both-axes snap.

**Stage integration (`Stage.test.tsx`):** drag an object so its edge lands ~3px from
another object's edge → committed `x` equals the aligned value (snapped), and a
`snap-guide-x` line is present mid-drag; with `snapEnabled=false` the same drag does
NOT snap.

**e2e (`snapping.spec.ts`):** two rects; drag one near the other's left edge; assert a
visible snap guide and that the dragged object's transform aligns (its x snaps to the
target edge).

## 7. Risks

- **Rotated objects:** AABB-of-corners is correct; snapping a rotated box aligns its
  AABB extents (expected).
- **Performance:** targets recomputed once at drag start (geometry is static during a
  move); per-move cost is O(targets) line comparisons — trivial.
- **Determinism:** ties resolved by first-wins so the guide doesn't flicker between
  equal candidates.
