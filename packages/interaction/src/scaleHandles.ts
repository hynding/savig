import { projectParam } from './handleMath';

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
  uniform?: boolean;
  fromCenter?: boolean;
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
  // Alt = scale from centre: hold the anchor fixed (content(anchor)=anchor+base for any
  // S, so base stays) and scale symmetrically about it. See spec §3.1.
  if (i.fromCenter) {
    let px = i.pointerX;
    let py = i.pointerY;
    const tr = (i.rotationDeg * Math.PI) / 180;
    const cr = Math.cos(tr);
    const sr = Math.sin(tr);
    const isCorner = i.corner.x !== i.opposite.x && i.corner.y !== i.opposite.y;
    if (i.uniform && isCorner) {
      // Project onto the anchor-content -> corner-content line so sx/sy keep the start aspect.
      const aC = { x: i.anchorX + i.baseX, y: i.anchorY + i.baseY };
      const ex = i.startScaleX * (i.corner.x - i.anchorX);
      const ey = i.startScaleY * (i.corner.y - i.anchorY);
      const cC = { x: i.anchorX + (cr * ex - sr * ey) + i.baseX, y: i.anchorY + (sr * ex + cr * ey) + i.baseY };
      let tp = projectParam({ x: px, y: py }, aC, cC);
      const tMin = Math.max(MIN_SCALE / i.startScaleX, MIN_SCALE / i.startScaleY);
      if (!(tp >= tMin)) tp = tMin; // also catches NaN / negative (past the anchor)
      px = aC.x + tp * (cC.x - aC.x);
      py = aC.y + tp * (cC.y - aC.y);
    }
    const dx = px - i.anchorX - i.baseX;
    const dy = py - i.anchorY - i.baseY;
    const ux = cr * dx + sr * dy; // R(-rot)
    const uy = -sr * dx + cr * dy;
    const ex2 = i.corner.x - i.anchorX;
    const ey2 = i.corner.y - i.anchorY;
    let sx = ex2 === 0 ? i.startScaleX : ux / ex2;
    let sy = ey2 === 0 ? i.startScaleY : uy / ey2;
    if (!(sx >= MIN_SCALE)) sx = MIN_SCALE; // also catches NaN / negative
    if (!(sy >= MIN_SCALE)) sy = MIN_SCALE;
    return { scaleX: sx, scaleY: sy, x: i.baseX, y: i.baseY };
  }
  let px = i.pointerX;
  let py = i.pointerY;
  // Shift = keep aspect: project the pointer onto the dragged corner's start diagonal.
  // Corners only (an edge's corner & opposite share a coordinate -> skip).
  const isCorner = i.corner.x !== i.opposite.x && i.corner.y !== i.opposite.y;
  if (i.uniform && isCorner) {
    const tr = (i.rotationDeg * Math.PI) / 180;
    const cr = Math.cos(tr);
    const sr = Math.sin(tr);
    const contentOf = (lx: number, ly: number) => {
      const ex = i.startScaleX * (lx - i.anchorX);
      const ey = i.startScaleY * (ly - i.anchorY);
      return { x: i.anchorX + (cr * ex - sr * ey) + i.baseX, y: i.anchorY + (sr * ex + cr * ey) + i.baseY };
    };
    const oC = contentOf(i.opposite.x, i.opposite.y);
    const cC = contentOf(i.corner.x, i.corner.y);
    let tp = projectParam({ x: px, y: py }, oC, cC);
    // Floor t so BOTH axes stay >= MIN_SCALE (sx = t·S0x, sy = t·S0y) — otherwise the
    // independent MIN_SCALE clamps below would fire asymmetrically and break the aspect.
    const tMin = Math.max(MIN_SCALE / i.startScaleX, MIN_SCALE / i.startScaleY);
    if (!(tp >= tMin)) tp = tMin; // also catches NaN / negative (past the opposite corner)
    px = oC.x + tp * (cC.x - oC.x);
    py = oC.y + tp * (cC.y - oC.y);
  }
  const t = (i.rotationDeg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  // u = R(-rot) · (P - a - base) - S0 · (o - a)
  const dx = px - i.anchorX - i.baseX;
  const dy = py - i.anchorY - i.baseY;
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
