import type { PathData, PathNode, PathPoint } from './types';

// Generators emit corner-node PathData (no bezier handles). First vertex points
// straight up (angle −90°) so a freshly stamped shape reads upright; callers add
// `rotation` (radians) on top.
const TOP = -Math.PI / 2;
const ROUND_EPS = 1e-9;

function vertex(cx: number, cy: number, radius: number, angle: number): PathPoint {
  return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
}

function sub(a: PathPoint, b: PathPoint): PathPoint {
  return { x: a.x - b.x, y: a.y - b.y };
}

// Fillet every vertex of a closed corner-node path (no pre-existing handles) with a
// true circular-arc cubic: tangent points inset by `t = R/tan(θ/2)` along each edge
// (clamped to the half-edge so adjacent fillets never overlap), handles of length
// `(4/3)·R_eff·tan((π−θ)/4)` pointing back toward the original vertex. Reduces to the
// classic ~0.5523·R kappa at a 90° corner. radius<=0 or <3 nodes -> path unchanged.
//
// Authoring/edit-time only: applied when STAMPING a primitive (and reused by parametric
// re-editing), baking the result into the object's path `d`. The runtime never calls
// this — it just renders the baked path — so it stays out of the runtime bundle.
export function roundCorners(path: PathData, radius: number): PathData {
  const { nodes, closed } = path;
  if (radius <= 0 || nodes.length < 3) return path;
  const n = nodes.length;
  const out: PathNode[] = [];
  for (let i = 0; i < n; i++) {
    const V = nodes[i].anchor;
    const P = nodes[(i - 1 + n) % n].anchor;
    const N = nodes[(i + 1) % n].anchor;
    const eP = sub(P, V);
    const eN = sub(N, V);
    const lenP = Math.hypot(eP.x, eP.y);
    const lenN = Math.hypot(eN.x, eN.y);
    if (lenP < ROUND_EPS || lenN < ROUND_EPS) {
      out.push({ anchor: { ...V } });
      continue;
    }
    const u = { x: eP.x / lenP, y: eP.y / lenP };
    const w = { x: eN.x / lenN, y: eN.y / lenN };
    const theta = Math.acos(Math.max(-1, Math.min(1, u.x * w.x + u.y * w.y)));
    const t = Math.min(radius / Math.tan(theta / 2), 0.5 * lenP, 0.5 * lenN);
    if (!(t > ROUND_EPS)) {
      out.push({ anchor: { ...V } }); // collinear / degenerate -> keep the sharp vertex
      continue;
    }
    const rEff = t * Math.tan(theta / 2);
    const h = (4 / 3) * rEff * Math.tan((Math.PI - theta) / 4);
    out.push({ anchor: { x: V.x + u.x * t, y: V.y + u.y * t }, out: { x: -u.x * h, y: -u.y * h } });
    out.push({ anchor: { x: V.x + w.x * t, y: V.y + w.y * t }, in: { x: -w.x * h, y: -w.y * h } });
  }
  return { nodes: out, closed };
}

export function polygonPath(
  cx: number,
  cy: number,
  radius: number,
  sides: number,
  rotation = 0,
  cornerRadius = 0,
): PathData {
  const n = Math.max(3, Math.floor(sides));
  const nodes = Array.from({ length: n }, (_, i) => ({
    anchor: vertex(cx, cy, radius, TOP + rotation + (i * 2 * Math.PI) / n),
  }));
  const path: PathData = { nodes, closed: true };
  return cornerRadius > 0 ? roundCorners(path, cornerRadius) : path;
}

export function starPath(
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius: number,
  points: number,
  rotation = 0,
  cornerRadius = 0,
): PathData {
  const p = Math.max(2, Math.floor(points));
  const count = p * 2;
  const step = (2 * Math.PI) / count;
  const nodes = Array.from({ length: count }, (_, i) => ({
    anchor: vertex(cx, cy, i % 2 === 0 ? outerRadius : innerRadius, TOP + rotation + i * step),
  }));
  const path: PathData = { nodes, closed: true };
  return cornerRadius > 0 ? roundCorners(path, cornerRadius) : path;
}

export function linePath(p0: PathPoint, p1: PathPoint): PathData {
  return { nodes: [{ anchor: { ...p0 } }, { anchor: { ...p1 } }], closed: false };
}
