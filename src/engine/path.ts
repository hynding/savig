import { fmt } from './transform';
import type { PathData, PathNode, PathPoint } from './types';

function add(anchor: PathPoint, offset: PathPoint | undefined): PathPoint {
  return offset ? { x: anchor.x + offset.x, y: anchor.y + offset.y } : anchor;
}

// Emits one segment from `prev` to `cur`. A cubic C is used when EITHER endpoint
// has a handle on the relevant side; otherwise the segment is a straight L.
function segment(prev: PathNode, cur: PathNode): string {
  if (prev.out || cur.in) {
    const c1 = add(prev.anchor, prev.out);
    const c2 = add(cur.anchor, cur.in);
    return `C ${fmt(c1.x)} ${fmt(c1.y)} ${fmt(c2.x)} ${fmt(c2.y)} ${fmt(cur.anchor.x)} ${fmt(cur.anchor.y)}`;
  }
  return `L ${fmt(cur.anchor.x)} ${fmt(cur.anchor.y)}`;
}

// Pure serializer: PathData -> SVG path `d`. The SINGLE definition of path markup,
// shared by the editor Stage and the export runtime so preview == export.
export function pathToD(path: PathData): string {
  const { nodes, closed } = path;
  if (nodes.length === 0) return '';
  const parts: string[] = [`M ${fmt(nodes[0].anchor.x)} ${fmt(nodes[0].anchor.y)}`];
  for (let i = 1; i < nodes.length; i++) {
    parts.push(segment(nodes[i - 1], nodes[i]));
  }
  if (closed && nodes.length > 1) {
    const last = nodes[nodes.length - 1];
    // A straight closing segment is drawn by Z itself; only a curved closing
    // segment (handles present) must be emitted explicitly before Z.
    if (last.out || nodes[0].in) {
      parts.push(segment(last, nodes[0]));
    }
    parts.push('Z');
  }
  return parts.join(' ');
}

// Anchor-extent bounding box. Sufficient for the fractional-anchor pivot and the
// selection bbox this slice; curve-tight bounds are a cheap later refinement.
export function pathBounds(path: PathData): { x: number; y: number; width: number; height: number } {
  if (path.nodes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of path.nodes) {
    if (n.anchor.x < minX) minX = n.anchor.x;
    if (n.anchor.y < minY) minY = n.anchor.y;
    if (n.anchor.x > maxX) maxX = n.anchor.x;
    if (n.anchor.y > maxY) maxY = n.anchor.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
