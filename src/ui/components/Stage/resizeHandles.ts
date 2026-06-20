export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export const HANDLE_IDS: readonly HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export function handleLocalPositions(width: number, height: number): Record<HandleId, { x: number; y: number }> {
  return {
    nw: { x: 0, y: 0 },
    n: { x: width / 2, y: 0 },
    ne: { x: width, y: 0 },
    e: { x: width, y: height / 2 },
    se: { x: width, y: height },
    s: { x: width / 2, y: height },
    sw: { x: 0, y: height },
    w: { x: 0, y: height / 2 },
  };
}

export interface ResizeInput {
  handle: HandleId;
  /** Pointer in the object's OLD local coordinates. */
  localX: number;
  localY: number;
  /** Current bbox extent (rect: width/height; ellipse: 2*radiusX/2*radiusY). */
  width: number;
  height: number;
  anchorFracX: number;
  anchorFracY: number;
  baseX: number;
  baseY: number;
  scaleX: number;
  scaleY: number;
  rotationDeg: number;
  minSize: number;
}

export interface ResizeResult {
  width: number;
  height: number;
  baseX: number;
  baseY: number;
}

// Resizes the bbox so the edge/corner OPPOSITE the dragged handle stays fixed in
// stage space. Because the rotate/scale pivot (anchor) moves with the geometry,
// base is compensated:  base' = base + (A - A') + RS * [ (Fo - Fn) + (A' - A) ]
// where A/A' are old/new absolute anchors, Fo/Fn the fixed edge in old/new local
// coords, and RS = R(deg) * diag(scaleX, scaleY).
export function applyHandleResize(i: ResizeInput): ResizeResult {
  const movesLeft = i.handle === 'nw' || i.handle === 'w' || i.handle === 'sw';
  const movesRight = i.handle === 'ne' || i.handle === 'e' || i.handle === 'se';
  const movesTop = i.handle === 'nw' || i.handle === 'n' || i.handle === 'ne';
  const movesBottom = i.handle === 'sw' || i.handle === 's' || i.handle === 'se';

  let w2 = i.width;
  if (movesRight) w2 = Math.max(i.minSize, i.localX);
  else if (movesLeft) w2 = Math.max(i.minSize, i.width - i.localX);

  let h2 = i.height;
  if (movesBottom) h2 = Math.max(i.minSize, i.localY);
  else if (movesTop) h2 = Math.max(i.minSize, i.height - i.localY);

  const foX = movesLeft ? i.width : 0;
  const foY = movesTop ? i.height : 0;
  const fnX = movesLeft ? w2 : 0;
  const fnY = movesTop ? h2 : 0;

  const ax = i.anchorFracX * i.width;
  const ay = i.anchorFracY * i.height;
  const a2x = i.anchorFracX * w2;
  const a2y = i.anchorFracY * h2;

  const t = (i.rotationDeg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const vx = foX - fnX + (a2x - ax);
  const vy = foY - fnY + (a2y - ay);
  const rsx = c * i.scaleX * vx - s * i.scaleY * vy;
  const rsy = s * i.scaleX * vx + c * i.scaleY * vy;

  return {
    width: w2,
    height: h2,
    baseX: i.baseX + (ax - a2x) + rsx,
    baseY: i.baseY + (ay - a2y) + rsy,
  };
}
