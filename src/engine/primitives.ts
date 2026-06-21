import type { PathData, PathPoint } from './types';

// Generators emit corner-node PathData (no bezier handles). First vertex points
// straight up (angle −90°) so a freshly stamped shape reads upright; callers add
// `rotation` (radians) on top.
const TOP = -Math.PI / 2;

function vertex(cx: number, cy: number, radius: number, angle: number): PathPoint {
  return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
}

export function polygonPath(
  cx: number,
  cy: number,
  radius: number,
  sides: number,
  rotation = 0,
): PathData {
  const n = Math.max(3, Math.floor(sides));
  const nodes = Array.from({ length: n }, (_, i) => ({
    anchor: vertex(cx, cy, radius, TOP + rotation + (i * 2 * Math.PI) / n),
  }));
  return { nodes, closed: true };
}

export function starPath(
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius: number,
  points: number,
  rotation = 0,
): PathData {
  const p = Math.max(2, Math.floor(points));
  const count = p * 2;
  const step = (2 * Math.PI) / count;
  const nodes = Array.from({ length: count }, (_, i) => ({
    anchor: vertex(cx, cy, i % 2 === 0 ? outerRadius : innerRadius, TOP + rotation + i * step),
  }));
  return { nodes, closed: true };
}

export function linePath(p0: PathPoint, p1: PathPoint): PathData {
  return { nodes: [{ anchor: { ...p0 } }, { anchor: { ...p1 } }], closed: false };
}
