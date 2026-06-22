export type ScaleHandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const SCALE_HANDLE_IDS: readonly ScaleHandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
export const MIN_SCALE = 0.05;

export function scaleHandleLocalPositions(
  bbox: { x: number; y: number; width: number; height: number },
): Record<ScaleHandleId, { x: number; y: number }> {
  const { x, y, width, height } = bbox;
  return {
    nw: { x, y },
    n: { x: x + width / 2, y },
    ne: { x: x + width, y },
    e: { x: x + width, y: y + height / 2 },
    se: { x: x + width, y: y + height },
    s: { x: x + width / 2, y: y + height },
    sw: { x, y: y + height },
    w: { x, y: y + height / 2 },
  };
}

// The handle held fixed while dragging `id` (its diagonal opposite for a corner, its
// across-the-box partner for an edge).
export function oppositeHandle(id: ScaleHandleId): ScaleHandleId {
  return ({ nw: 'se', se: 'nw', ne: 'sw', sw: 'ne', n: 's', s: 'n', e: 'w', w: 'e' } as const)[id];
}

export interface ScaleInput {
  corner: { x: number; y: number };
  opposite: { x: number; y: number };
  anchorX: number;
  anchorY: number;
  startScaleX: number;
  startScaleY: number;
  baseX: number;
  baseY: number;
  rotationDeg: number;
  pointerX: number;
  pointerY: number;
}
export interface ScaleResult {
  scaleX: number;
  scaleY: number;
  x: number;
  y: number;
}

/** Scale the object so the dragged `corner` follows the pointer while the diagonal
 *  `opposite` corner stays fixed in content space (rotation-aware). See the spec §2.
 *  Corner/opposite/anchor are object-local; pointer/base are content coords. */
export function applyScaleHandleDrag(i: ScaleInput): ScaleResult {
  const t = (i.rotationDeg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  // u = R(-rot) · (P - a - base) - S0 · (o - a)
  const dx = i.pointerX - i.anchorX - i.baseX;
  const dy = i.pointerY - i.anchorY - i.baseY;
  const rx = c * dx + s * dy; // R(-t) row 1
  const ry = -s * dx + c * dy; // R(-t) row 2
  const ux = rx - i.startScaleX * (i.opposite.x - i.anchorX);
  const uy = ry - i.startScaleY * (i.opposite.y - i.anchorY);
  const dcx = i.corner.x - i.opposite.x;
  const dcy = i.corner.y - i.opposite.y;
  let sx = dcx === 0 ? i.startScaleX : ux / dcx;
  let sy = dcy === 0 ? i.startScaleY : uy / dcy;
  if (!(sx >= MIN_SCALE)) sx = MIN_SCALE; // also catches NaN / negative
  if (!(sy >= MIN_SCALE)) sy = MIN_SCALE;
  // (x,y) = base + R(rot) · (S0 - S1) · (o - a)
  const vx = (i.startScaleX - sx) * (i.opposite.x - i.anchorX);
  const vy = (i.startScaleY - sy) * (i.opposite.y - i.anchorY);
  const x = i.baseX + (c * vx - s * vy);
  const y = i.baseY + (s * vx + c * vy);
  return { scaleX: sx, scaleY: sy, x, y };
}
