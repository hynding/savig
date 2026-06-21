export interface Pt {
  x: number;
  y: number;
}

/** Screen-space angle (degrees) from pivot to point (y grows downward). */
export function angleDeg(pivot: Pt, p: Pt): number {
  return (Math.atan2(p.y - pivot.y, p.x - pivot.x) * 180) / Math.PI;
}

/** New rotation for a handle drag: the start rotation plus the angular delta the
 *  pointer swept around the pivot. Relative, so grabbing off-center doesn't jump. */
export function rotationFromDrag(pivot: Pt, start: Pt, cur: Pt, startRotationDeg: number): number {
  return startRotationDeg + angleDeg(pivot, cur) - angleDeg(pivot, start);
}

/** Connector base (bbox top-center) + handle position (a stalk above it), object-local. */
export function rotateHandleLocal(
  bbox: { x: number; y: number; width: number; height: number },
  stalk: number,
): { base: Pt; handle: Pt } {
  const cx = bbox.x + bbox.width / 2;
  return { base: { x: cx, y: bbox.y }, handle: { x: cx, y: bbox.y - stalk } };
}
