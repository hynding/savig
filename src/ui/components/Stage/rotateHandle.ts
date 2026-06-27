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

/** Rotation snap increment (deg) and magnetic threshold (deg). When the snap toggle is on, a
 *  rotate drag clicks to multiples of ANGLE_SNAP_STEP within ANGLE_SNAP_DEG of one. */
export const ANGLE_SNAP_STEP = 45;
export const ANGLE_SNAP_DEG = 5;

export interface AngleSnapResult {
  /** The (possibly snapped) angle in degrees. */
  angle: number;
  /** Whether the magnetic snap engaged (for feedback). */
  snapped: boolean;
}

/** Magnetic angle snap: if `deg` is within `thresholdDeg` of a multiple of `stepDeg`, return that
 *  multiple; else return `deg` unchanged. Works for any real `deg` (negative / >360) since the
 *  nearest multiple is found by rounding — e.g. 358° → 360°. */
export function snapAngle(deg: number, stepDeg: number, thresholdDeg: number): AngleSnapResult {
  const raw = Math.round(deg / stepDeg) * stepDeg;
  const nearest = raw === 0 ? 0 : raw; // normalize -0 → 0
  if (Math.abs(deg - nearest) <= thresholdDeg) return { angle: nearest, snapped: true };
  return { angle: deg, snapped: false };
}

/** Connector base (bbox top-center) + handle position (a stalk above it), object-local. */
export function rotateHandleLocal(
  bbox: { x: number; y: number; width: number; height: number },
  stalk: number,
): { base: Pt; handle: Pt } {
  const cx = bbox.x + bbox.width / 2;
  return { base: { x: cx, y: bbox.y }, handle: { x: cx, y: bbox.y - stalk } };
}
