export interface Pt2 {
  x: number;
  y: number;
}

/** Orthogonally project point `p` onto the infinite line through `a` and `b`.
 *  Returns `a` when `a` and `b` coincide (degenerate line). */
export function projectOntoLine(p: Pt2, a: Pt2, b: Pt2): Pt2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { x: a.x, y: a.y };
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  return { x: a.x + t * dx, y: a.y + t * dy };
}
