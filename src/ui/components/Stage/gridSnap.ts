// Snap-to-grid for move drags (slice snap-to-grid). Pure. Returns the shift that lands the moving
// bbox's TOP-LEFT corner on the nearest grid intersection. Unlike object-snap this has no distance
// threshold — when the grid is on, positions snap to the lattice (the caller still lets object/
// spacing snap claim an axis first, and Cmd/Ctrl bypasses both).
import type { AABB } from './snapping';

export function snapAABBToGrid(moving: AABB, gridSize: number): { dx: number; dy: number } {
  if (!(gridSize > 0)) return { dx: 0, dy: 0 }; // guard: also catches NaN
  const dx = Math.round(moving.minX / gridSize) * gridSize - moving.minX;
  const dy = Math.round(moving.minY / gridSize) * gridSize - moving.minY;
  return { dx, dy };
}

/** Snap a dragged corner/edge POINT (content coords) to the grid on each axis that is being
 *  dragged (sxAxis/syAxis) AND not already claimed by object-snap. Used by the scale/resize handle
 *  drags in their FREE (per-axis) case; the constrained uniform/from-centre cases skip grid since a
 *  per-axis nudge would leave the diagonal. */
export function snapPointToGridAxes(
  p: { x: number; y: number },
  sxAxis: boolean,
  syAxis: boolean,
  claimedX: boolean,
  claimedY: boolean,
  gridSize: number,
): { x: number; y: number } {
  if (!(gridSize > 0)) return p;
  return {
    x: sxAxis && !claimedX ? Math.round(p.x / gridSize) * gridSize : p.x,
    y: syAxis && !claimedY ? Math.round(p.y / gridSize) * gridSize : p.y,
  };
}
