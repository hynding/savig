import type { PathData, PathNode, PathPoint } from '../../../engine';

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Inserts a corner node at parameter t along segment `segmentIndex`
// (node segmentIndex -> segmentIndex+1, wrapping to node 0 for the closing segment).
export function insertNodeAt(path: PathData, segmentIndex: number, t: number): PathData {
  const n = path.nodes.length;
  const a = path.nodes[segmentIndex];
  const b = path.nodes[(segmentIndex + 1) % n];
  if (!a || !b) return path;
  const anchor: PathPoint = {
    x: lerp(a.anchor.x, b.anchor.x, t),
    y: lerp(a.anchor.y, b.anchor.y, t),
  };
  const node: PathNode = { anchor };
  const nodes = [...path.nodes];
  nodes.splice(segmentIndex + 1, 0, node);
  return { ...path, nodes };
}

// Removes node `index`; keeps at least 2 nodes (a path needs >= 2 to render).
export function deleteNodeAt(path: PathData, index: number): PathData {
  if (path.nodes.length <= 2) return path;
  return { ...path, nodes: path.nodes.filter((_, i) => i !== index) };
}
