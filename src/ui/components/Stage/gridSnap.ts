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
