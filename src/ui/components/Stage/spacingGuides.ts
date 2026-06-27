// Equal-spacing ("distribution") guides for a move drag (slice spacing-guides). Pure. Detects when
// the moving object's bbox is (near) equidistant between its immediate left/right or top/bottom
// neighbors in the same row/column, returns the small delta to centre it exactly + the dimension
// segments to draw. Reuses the AABB shape from snapping. Edge-snap takes priority per axis; this
// fills an axis only when no edge guide claimed it (decided by the caller).
import type { AABB } from './snapping';

export interface SpacingGuide {
  /** Dimension-line endpoints (content coords). */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** The equal gap value (content px) shown as the label. */
  gap: number;
  orientation: 'h' | 'v';
}

export interface SpacingSnapResult {
  /** Shift to equalize the horizontal gaps (0 if not applicable / out of threshold). */
  dx: number;
  /** Shift to equalize the vertical gaps. */
  dy: number;
  guides: SpacingGuide[];
}

const overlapsV = (a: AABB, b: AABB): boolean => a.minY < b.maxY && a.maxY > b.minY;
const overlapsH = (a: AABB, b: AABB): boolean => a.minX < b.maxX && a.maxX > b.minX;

export function computeSpacingSnap(moving: AABB, others: AABB[], threshold: number): SpacingSnapResult {
  const guides: SpacingGuide[] = [];
  let dx = 0;
  let dy = 0;

  // --- Horizontal: equal gaps to the nearest flanking neighbors in the same horizontal band. ---
  const rowMates = others.filter((o) => overlapsV(moving, o));
  const lefts = rowMates.filter((o) => o.maxX <= moving.minX);
  const rights = rowMates.filter((o) => o.minX >= moving.maxX);
  if (lefts.length && rights.length) {
    const L = lefts.reduce((best, o) => (o.maxX > best.maxX ? o : best));
    const R = rights.reduce((best, o) => (o.minX < best.minX ? o : best));
    const gapL = moving.minX - L.maxX;
    const gapR = R.minX - moving.maxX;
    const delta = (gapR - gapL) / 2; // shift right by `delta` to equalize
    if (Math.abs(delta) <= threshold) {
      dx = delta;
      const gap = (gapL + gapR) / 2;
      const cy = (moving.minY + moving.maxY) / 2;
      guides.push({ x1: L.maxX, y1: cy, x2: moving.minX + delta, y2: cy, gap, orientation: 'h' });
      guides.push({ x1: moving.maxX + delta, y1: cy, x2: R.minX, y2: cy, gap, orientation: 'h' });
    }
  }

  // --- Vertical: equal gaps to the nearest flanking neighbors in the same vertical band. ---
  const colMates = others.filter((o) => overlapsH(moving, o));
  const tops = colMates.filter((o) => o.maxY <= moving.minY);
  const bottoms = colMates.filter((o) => o.minY >= moving.maxY);
  if (tops.length && bottoms.length) {
    const T = tops.reduce((best, o) => (o.maxY > best.maxY ? o : best));
    const B = bottoms.reduce((best, o) => (o.minY < best.minY ? o : best));
    const gapT = moving.minY - T.maxY;
    const gapB = B.minY - moving.maxY;
    const delta = (gapB - gapT) / 2;
    if (Math.abs(delta) <= threshold) {
      dy = delta;
      const gap = (gapT + gapB) / 2;
      const cx = (moving.minX + moving.maxX) / 2;
      guides.push({ x1: cx, y1: T.maxY, x2: cx, y2: moving.minY + delta, gap, orientation: 'v' });
      guides.push({ x1: cx, y1: moving.maxY + delta, x2: cx, y2: B.minY, gap, orientation: 'v' });
    }
  }

  return { dx, dy, guides };
}
