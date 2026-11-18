# Lasso tool — design

Roadmap 8, item 3. Flash's lasso selects with a loop, and on a raw drawing selects (and so can
lift out) just the part of the shape inside the loop. SaViG only had the rectangular marquee.

## Tool
- Lasso (Q, toolbar "Lasso", first after Select). Tool options: **Freehand** (drag a loop; letting
  go closes it) or **Polygon** (click corners; click the first corner again, double-click on one
  spot, or Enter to close; Esc cancels). A dashed loop previews on the Stage (`useLassoTool`).
  A press on a drawing starts / extends the loop exactly like a press on the background.
- Closing the loop calls the store's `lassoSelect(points, additive)`:
  1. One drawing selected (no Shift) and the loop covers **part** of it: the looped part is cut
     into a drawing of its own (one undo step) and that piece is selected.
  2. Otherwise everything the loop touches is selected, by the marquee's rules (hidden, locked
     and off-key drawings skipped; a hit in a group selects the group) with the loop in place of
     the rectangle (`lassoTouchesBox` against each object's box); Shift adds.
  Refusals for the cut (locked, live boolean, shape keys, animated size) toast and change nothing;
  a loop that misses the drawing or holds all of it falls through to selecting.

## Engine (`geom/lasso.ts`)
- `lassoArea(points)`: the loop as a polygon-clipping area (nonzero for a self-crossing loop);
  [] with fewer than 3 distinct points or no area.
- `applyLassoCut(project, id, points, time)`: the drawing's ink in its own coordinates (fill
  area with compound holes, or a stroke-only drawing's stroke outline, the eraser's rules), the
  loop mapped into those coordinates, then `intersection` → the new piece and `difference` → what
  the original keeps. Rects / ellipses become paths, both pivots are pinned absolute at the
  original's pivot (nothing moves), a stroke-only cut turns the stroke paint into the fill. The
  piece copies the original object (transform, transform tracks, group, frame key, mask, filters,
  blend) minus behaviors and shape tracks, is named "<name> piece", and is drawn right above the
  original (zOrder renumbered densely). A shared asset is copied rather than changed.
- The eraser and lasso share their ring plumbing through the internal `geom/shapeCut.ts`.

## Agent surfaces
Core `cutRegion(project, id, points, { time?, newId? })` → `{ project, id }`, MCP `cut_region`.
