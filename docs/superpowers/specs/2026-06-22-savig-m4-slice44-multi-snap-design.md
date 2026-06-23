# Savig M4 Slice 44 — Multi-object move snapping

**Date:** 2026-06-22
**Status:** Approved (autonomous slice cycle — M4 multi-object toolkit)
**Depends on:** Slice 33 (snapping/guides), 37 (multi-move), 40 (`groupBBox`), 43 (`objectAABB` in `snapping.ts`)

## 1. Goal

When dragging a multi-selection, snap the GROUP's bounding box to other objects' edges/
centers and the artboard — exactly like single-object drag (slice 33). Today the multi
move-drag explicitly suppresses snapping (a slice-37 deferral), so moving several objects
feels less precise than moving one. This closes that gap.

## 2. Why this is small & low-risk

The `DragState` already carries `baseAABB` + `targets` (the single-drag snap fields),
currently left null/empty by the multi branch. The fix populates them at multi-drag start
(group bbox + the non-selected objects' AABBs + the artboard) and runs the SAME
`computeSnap` in the multi `onMove`, storing the corrected delta in `d.multi.dx/dy`. The
existing `onUp` already commits `d.multi.dx/dy` via `nudgeSelected` and clears the guides,
and the `snapGuides` overlay already renders. No store/engine/export/persistence change;
the change is two spots in `Stage.tsx`.

## 3. Behavior

- At multi-drag start: `baseAABB = groupBBox(` each moving (non-locked) member's
  `objectAABB )`; `targets = ` every object NOT in the drag set, by `objectAABB`, plus the
  artboard rect `{0,0,width,height}` (mirrors single-drag targets).
- During the drag (when `snapEnabled`): build the group's moving AABB = `baseAABB` shifted
  by the raw pointer delta, `computeSnap(moving, targets, SNAP_PX / zoom)`, add the snap
  correction to the delta, apply the corrected `(dx,dy)` to every member's live preview,
  and show the snap guide line(s). Store the corrected delta in `d.multi.dx/dy`.
- On release: `nudgeSelected(d.multi.dx, d.multi.dy)` (unchanged) commits the snapped move
  in one undo step; guides clear (unchanged).
- `snapEnabled` off → raw delta, no guides (today's behavior).

## 4. Scope (YAGNI)

**In:** snap the multi-selection group bbox during move-drag (edges + centers, reusing
`computeSnap`); guides; respect `snapEnabled`.

**Out (deferred):** snapping group SCALE/ROTATE handles (slice 40/41 still unsnapped);
distance/spacing guides; snapping individual members to each other within the group;
snap-to-grid; a hold-to-bypass modifier.

**Editor-only:** no store/engine/export/runtime/persistence change.

## 5. Implementation surface

- `src/ui/components/Stage/Stage.tsx`, multi branch of `onObjectPointerDown` (~lines
  619–632): compute `baseAABB` + `targets`, store them in `dragRef.current` alongside
  `multi`.
- `src/ui/components/Stage/Stage.tsx`, multi branch of the window `onMove` (~lines
  948–970): snap the group bbox, store corrected `d.multi.dx/dy`, set `snapGuides`.
- Reuses (already imported): `computeSnap`, `groupBBox`, `objectAABB`, `SNAP_PX`, `AABB`,
  `snapEnabled` (store), the `snapGuides` overlay, `nudgeSelected`.

## 6. Testing

- **`Stage.test.tsx`:** with an UNSELECTED target object whose left edge sits a few px
  beyond the dragged group's, drag a 2-object selection so the group's left edge lands
  within `SNAP_PX` of the target's left edge → the committed positions snap to exact
  alignment (group left edge == target left edge), not the raw pointer delta. A second
  assertion: with `snapEnabled` false, the same drag lands at the raw (un-snapped) delta.
- **e2e (`multi-snap.spec.ts`):** draw 3 rects; select 2; drag them so the group edge
  approaches the 3rd rect's edge; assert the dragged objects' edge aligns with the 3rd
  within ~1px (snapped).

## 7. Risks

- **Stale closure:** the `onMove`/`onUp` window listeners must read `baseAABB`/`targets`
  from `dragRef.current` (fresh ref) and live state via `useEditor.getState()` — never a
  render-closure memo. (Pointer-down is a React handler, so reading `assetsById` there is
  fine, matching single-drag.)
- **Bbox/preview parity:** the snap bbox must be built from the SAME member set that the
  preview moves (the non-locked `items`), so the snapped edge matches what the user sees.
