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
