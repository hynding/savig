import type { PathData, PathPoint } from '../../../engine';

function dist2(a: PathPoint, b: PathPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function hitTestAnchor(path: PathData, local: PathPoint, tol: number): number | null {
  const t2 = tol * tol;
  for (let i = 0; i < path.nodes.length; i++) {
    if (dist2(path.nodes[i].anchor, local) <= t2) return i;
  }
  return null;
}

export function hitTestHandle(
  path: PathData,
  local: PathPoint,
  tol: number,
): { index: number; side: 'in' | 'out' } | null {
  const t2 = tol * tol;
  let best: { index: number; side: 'in' | 'out'; d2: number } | null = null;
  const consider = (index: number, side: 'in' | 'out', h: PathPoint, anchor: PathPoint) => {
    const d2 = dist2({ x: anchor.x + h.x, y: anchor.y + h.y }, local);
    if (d2 <= t2 && (!best || d2 < best.d2)) best = { index, side, d2 };
  };
  for (let i = 0; i < path.nodes.length; i++) {
    const n = path.nodes[i];
    if (n.in) consider(i, 'in', n.in, n.anchor);
    if (n.out) consider(i, 'out', n.out, n.anchor);
  }
  return best ? { index: best.index, side: best.side } : null;
}

// Nearest point on each segment's straight chord (linear approximation, adequate
// for click-to-insert this slice). Returns the closest segment within tol and the
// clamped parameter t in [0,1].
export function hitTestSegment(
  path: PathData,
  local: PathPoint,
  tol: number,
): { segmentIndex: number; t: number } | null {
  const n = path.nodes.length;
  const last = path.closed ? n : n - 1;
  let best: { segmentIndex: number; t: number; d2: number } | null = null;
  for (let i = 0; i < last; i++) {
    const a = path.nodes[i].anchor;
    const b = path.nodes[(i + 1) % n].anchor;
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const len2 = vx * vx + vy * vy || 1;
    let t = ((local.x - a.x) * vx + (local.y - a.y) * vy) / len2;
    t = Math.max(0, Math.min(1, t));
    const proj = { x: a.x + vx * t, y: a.y + vy * t };
    const d2 = dist2(proj, local);
    if (!best || d2 < best.d2) best = { segmentIndex: i, t, d2 };
  }
  if (best && best.d2 <= tol * tol) return { segmentIndex: best.segmentIndex, t: best.t };
  return null;
}

export function nearFirstAnchor(path: PathData, local: PathPoint, tol: number): boolean {
  return path.nodes.length > 0 && dist2(path.nodes[0].anchor, local) <= tol * tol;
}
