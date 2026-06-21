import type { PathData, PathNode, PathPoint } from './types';
import { simplify } from './geom/simplify';

export interface BrushParams {
  /** RDP epsilon (px). */
  tolerance: number;
  /** Catmull-Rom handle scale (0 = corner polyline, 0.5 = default, 1 = strong). */
  smoothing: number;
}

// Map the 0..1 `brushSmoothing` UI control to concrete pipeline params. Monotonic:
// higher smoothing => larger RDP tolerance (fewer points) and longer CR handles.
export function brushParams(smoothing: number): BrushParams {
  const s = Math.min(1, Math.max(0, smoothing));
  return { tolerance: 1 + s * 7, smoothing: s };
}

const DEDUPE_EPS = 0.01;

function dedupe(points: PathPoint[]): PathPoint[] {
  const out: PathPoint[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > DEDUPE_EPS) out.push(p);
  }
  return out;
}

// Build an open, smooth vector stroke from raw drag samples (stage-space). The
// single source of stroke geometry: the same PathData previews, commits, and exports.
export function strokeToPath(points: PathPoint[], opts: BrushParams): PathData {
  const pts = simplify(dedupe(points), opts.tolerance);
  if (pts.length < 2) return { nodes: [], closed: false };
  if (pts.length === 2) {
    return { nodes: [{ anchor: pts[0] }, { anchor: pts[1] }], closed: false };
  }
  // Catmull-Rom tangent at P[i] is (P[i+1] - P[i-1]) / 6 for the cubic-bezier
  // conversion; scale by k so default smoothing (0.5) reproduces standard CR.
  const k = opts.smoothing * 2;
  const nodes: PathNode[] = pts.map((p, i) => {
    const node: PathNode = { anchor: { x: p.x, y: p.y } };
    if (k > 0) {
      const prev = pts[i - 1] ?? p; // one-sided tangent at the ends
      const next = pts[i + 1] ?? p;
      const tx = ((next.x - prev.x) / 6) * k;
      const ty = ((next.y - prev.y) / 6) * k;
      node.out = { x: tx, y: ty };
      node.in = { x: 0 - tx, y: 0 - ty };
    }
    return node;
  });
  return { nodes, closed: false };
}
