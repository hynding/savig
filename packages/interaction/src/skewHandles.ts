// Free Transform skew handles (spec 2026-11-18-skew-distort, slice 2). Pure math, editor-only.
// A skew handle sits just outside each edge midpoint of the object's local box. Dragging the top
// or bottom handle shears along X (skewX); the left or right handle shears along Y (skewY). The
// opposite edge stays fixed in content space, like the scale handles; Alt shears about the anchor.
import { MAX_SKEW } from '@savig/engine';
import { linearMaps } from './handleMath';

export type SkewHandleId = 'n' | 'e' | 's' | 'w';
export const SKEW_HANDLE_IDS: readonly SkewHandleId[] = ['n', 'e', 's', 'w'];
/** Snap step for Shift-constrained skew, in degrees. */
export const SKEW_SNAP_STEP = 15;


/** Local positions: each edge midpoint pushed `offset` outward (local units). */
export function skewHandleLocalPositions(
  bbox: { x: number; y: number; width: number; height: number },
  offset: number,
): Record<SkewHandleId, { x: number; y: number }> {
  const { x, y, width, height } = bbox;
  return {
    n: { x: x + width / 2, y: y - offset },
    s: { x: x + width / 2, y: y + height + offset },
    e: { x: x + width + offset, y: y + height / 2 },
    w: { x: x - offset, y: y + height / 2 },
  };
}

export interface SkewInput {
  handle: SkewHandleId;
  bbox: { x: number; y: number; width: number; height: number };
  anchorX: number;
  anchorY: number;
  scaleX: number;
  scaleY: number;
  rotationDeg: number;
  skewX: number;
  skewY: number;
  baseX: number;
  baseY: number;
  /** Pointer in content coords. */
  pointerX: number;
  pointerY: number;
  /** Shift: snap the changed angle to 15° steps. */
  snap?: boolean;
  /** Alt: shear about the anchor instead of the opposite edge. */
  fromAnchor?: boolean;
}

export interface SkewResult {
  skewX: number;
  skewY: number;
  x: number;
  y: number;
}

const deg = (r: number) => (r * 180) / Math.PI;

function clampDeg(d: number, snap: boolean | undefined): number {
  let v = Number.isFinite(d) ? d : 0;
  if (snap) v = Math.round(v / SKEW_SNAP_STEP) * SKEW_SNAP_STEP;
  return Math.max(-MAX_SKEW, Math.min(MAX_SKEW, v));
}

/** New skew + base so the dragged edge follows the pointer along its own direction while the
 *  fixed point (opposite edge midpoint, or the anchor with Alt) stays put in content space.
 *  content(p) = a + base + R·SkX·SkY·S·(p − a). */
export function applySkewHandleDrag(i: SkewInput): SkewResult {
  const { x, y, width, height } = i.bbox;
  const horizontal = i.handle === 'n' || i.handle === 's'; // shears along X
  const edge = {
    n: { x: x + width / 2, y },
    s: { x: x + width / 2, y: y + height },
    e: { x: x + width, y: y + height / 2 },
    w: { x, y: y + height / 2 },
  } as const;
  const opp = ({ n: 's', s: 'n', e: 'w', w: 'e' } as const)[i.handle];
  let fixed: { x: number; y: number } = edge[opp];
  if (i.fromAnchor) {
    const span = horizontal ? Math.abs(edge[i.handle].y - i.anchorY) : Math.abs(edge[i.handle].x - i.anchorX);
    if (span > 1e-9) fixed = { x: i.anchorX, y: i.anchorY };
  }
  const h = edge[i.handle];
  const L0 = linearMaps(i.rotationDeg, i.skewX, i.skewY);
  const S = (px: number, py: number) => ({ x: i.scaleX * (px - i.anchorX), y: i.scaleY * (py - i.anchorY) });
  const fs = S(fixed.x, fixed.y);
  const f0 = L0.fwd(fs.x, fs.y); // fixed point, relative to a + base
  // Pointer relative to the fixed point's content position, in the rotated (pre-rotation) frame.
  const rad = (i.rotationDeg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const qx = i.pointerX - i.anchorX - i.baseX - f0.x;
  const qy = i.pointerY - i.anchorY - i.baseY - f0.y;
  const wx = c * qx + s * qy;
  const wy = -s * qx + c * qy;
  let kx = i.skewX;
  let ky = i.skewY;
  if (horizontal) {
    // h − fixed is vertical: SkX·SkY·S·(0, d) = (tan(kx)·d', d') with d' = sy·d.
    const d = i.scaleY * (h.y - fixed.y);
    if (Math.abs(d) > 1e-9) kx = clampDeg(deg(Math.atan(wx / d)), i.snap);
  } else {
    // h − fixed is horizontal: SkX·SkY·S·(d, 0) = ((1 + tx·ty)·d', ty·d') with d' = sx·d.
    const d = i.scaleX * (h.x - fixed.x);
    if (Math.abs(d) > 1e-9) ky = clampDeg(deg(Math.atan(wy / d)), i.snap);
  }
  // Keep the fixed point put: base' = base + (L0 − L1)·S·(fixed − a).
  const f1 = linearMaps(i.rotationDeg, kx, ky).fwd(fs.x, fs.y);
  return { skewX: kx, skewY: ky, x: i.baseX + f0.x - f1.x, y: i.baseY + f0.y - f1.y };
}
