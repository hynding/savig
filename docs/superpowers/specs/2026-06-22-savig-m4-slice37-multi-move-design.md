# Savig M4 Slice 37 — Multi-object move

**Date:** 2026-06-22
**Status:** Approved (autonomous slice cycle — M4)
**Depends on:** Slice 36 (multi-select), Slice 33 (move-drag snapping + objectAABB)

## 1. Goal

Move a whole multi-selection together: dragging an object that is part of the current
multi-selection moves ALL selected objects by the same delta (one undo step), and the
arrow keys nudge all selected. Completes slice 36's deferral. Dragging an object that is
NOT in the selection still collapses to single-select + move (unchanged).

## 2. Behavior

- **Arrow-nudge:** `nudgeSelected(dx, dy)` becomes BULK — it moves every selected
  non-locked object by `(dx, dy)`, auto-keyed at the playhead, in ONE commit. (Single
  selection → moves the one object, unchanged.)
- **Drag:**
  - Shift/Cmd-click → toggle selection (no drag) — unchanged (slice 36).
  - Plain pointer-down on an object IN the current multi-selection (`length > 1`) →
    keep the selection and start a MULTI-drag: every selected object previews by the
    same raw delta; on release, `nudgeSelected(dx, dy)` commits them all. **No snapping**
    in multi-drag (single-object snap is unchanged).
  - Plain pointer-down on any other object → `selectObject(id)` (collapse to single) +
    the existing single-object move-drag (with snapping).
- **Selection outlines follow the drag:** a shared `dragOffset` shifts every selection
  outline rect by the live drag delta during ANY move-drag — fixing the slice-36 lag
  where the outline stayed put while the object moved imperatively.

## 3. Scope (YAGNI)

**In:** bulk `nudgeSelected`; Stage multi-drag (preview + one-commit move via
`nudgeSelected`); outline-follow `dragOffset` (single + multi).

**Out (deferred → next M4 slices):** marquee/rubber-band; multi-object TRANSFORM (group
resize/rotate/scale handles); snapping a multi-selection (suppressed for >1); grouping;
boolean ops. Locked objects in a selection don't move (skipped by `nudgeSelected`).

**Editor-only:** no engine/export/runtime/persistence change (v4).

## 4. The commit trick

The drag previews imperatively (no commit until release), so each object's SAMPLED x/y
stays at its origin throughout the drag. Therefore one `nudgeSelected(totalDx, totalDy)`
on release reads `origin + delta` for every selected object — no per-object absolute
bookkeeping in the store, and one undo step for the whole multi-move.

## 5. Implementation surface

- `src/ui/store/store.ts`: `nudgeSelected(dx, dy)` rewritten to fold x/y keyframe upserts
  over `selectedObjectIds` (skip locked, guard `!autoKey` and the `dx===0 && dy===0`
  no-op) into ONE commit. (Used by both the keyboard arrows and the multi-drag release.)
- `src/ui/components/Stage/Stage.tsx`:
  - `DragState` gains a multi mode (`items: {id, ox, oy}[]` + `dx`/`dy`).
  - `onObjectPointerDown`: detect `multi = selectedObjectIds.includes(id) && length > 1`;
    if multi, keep the selection + capture all origins (no snap targets); else the
    existing single path.
  - `onMove`: multi branch previews each item at `(ox+dx, oy+dy)` (resolved anchor, like
    the single path) and sets `dragOffset`; single branch also sets `dragOffset`.
  - `onUp`: multi branch commits via `nudgeSelected(d.dx, d.dy)`; both clear `dragOffset`.
  - The selection-outline rects render at `objectAABB + dragOffset`.

## 6. Testing

**Store (`store.test.ts`):**
- `nudgeSelected` moves ALL selected by the delta in ONE commit (two objects → both x/y
  advance; one undo step restores both); skips a locked member; single selection
  unchanged (existing diagonal-nudge test stays green).

**Stage (`Stage.test.tsx`):**
- With A+B selected, pointer-down on A (no shift) + drag → BOTH A and B commit a moved
  position by the same delta (one undo step); the selection outlines reflect the offset
  mid-drag. Dragging an UNSELECTED object collapses to single (only it moves).

**e2e (`multi-move.spec.ts`):** draw two rects, Shift-click to select both, drag one →
both shift by the same amount (compare each object's transform/bbox before vs after).

## 7. Risks

- **nudgeSelected single-case parity:** the rewrite must produce the same result as the
  old `setProperties`-based nudge for a single selection (one undo step, same keyframes).
- **Motion-path objects:** x/y is overridden by the progress track at sample time, so
  nudging them is inert (pre-existing; unchanged).
- **dragOffset coordinate space:** it is an artboard-space delta (same space as
  `objectAABB`/the content `<g>`), applied to the outline rect x/y directly.
