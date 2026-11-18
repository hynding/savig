import { tiltOffset, untiltOffset } from '@savig/engine';
export interface Pt2 {
  x: number;
  y: number;
}

/** The parameter `t` of the orthogonal projection of `p` onto the line `a + t·(b − a)`
 *  (so the projected point is `a + t·(b − a)`). Returns 0 for a degenerate line (a===b).
 *  Exposed so callers can CLAMP `t` (e.g. to keep both axes ≥ a minimum) before
 *  reconstructing the point. */
export function projectParam(p: Pt2, a: Pt2, b: Pt2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return 0;
  return ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
}

/** Orthogonally project point `p` onto the infinite line through `a` and `b`.
 *  Returns `a` when `a` and `b` coincide (degenerate line). */
export function projectOntoLine(p: Pt2, a: Pt2, b: Pt2): Pt2 {
  const t = projectParam(p, a, b);
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
}

const tanDeg = (d: number | undefined) => (d ? Math.tan((d * Math.PI) / 180) : 0);

/** The object's linear part L = R(rot)·SkX·SkY·Tilt (without scale) and its inverse, as point
 *  maps. Tilt is the 3D rotation's orthographic projection (spec 2026-11-18-3d-rotation). */
export function linearMaps(rotationDeg: number, skewX?: number, skewY?: number, rotationX?: number, rotationY?: number) {
  const t = (rotationDeg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const tx = tanDeg(skewX);
  const ty = tanDeg(skewY);
  return {
    fwd(x0: number, y0: number) {
      const { x, y } = tiltOffset(rotationX, rotationY, x0, y0);
      const y1 = y + ty * x;
      const x1 = x + tx * y1;
      return { x: c * x1 - s * y1, y: s * x1 + c * y1 };
    },
    inv(x: number, y: number) {
      const x1 = c * x + s * y;
      const y1 = -s * x + c * y;
      const x0 = x1 - tx * y1;
      return untiltOffset(rotationX, rotationY, x0, y1 - ty * x0);
    },
  };
}
