import type { Easing, PathData, PathNode, PathPoint } from '@savig/engine';

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

function neg(p: PathPoint): PathPoint {
  // `0 - x` (not `-x`) so a zero coordinate yields +0, never -0, keeping the
  // stored path data clean and serialization stable.
  return { x: 0 - p.x, y: 0 - p.y };
}

function setNode(path: PathData, index: number, next: PathNode): PathData {
  return { ...path, nodes: path.nodes.map((n, i) => (i === index ? next : n)) };
}

export function moveAnchor(path: PathData, index: number, anchor: PathPoint): PathData {
  const node = path.nodes[index];
  if (!node) return path;
  return setNode(path, index, { ...node, anchor });
}

export function moveHandle(
  path: PathData,
  index: number,
  side: 'in' | 'out',
  offset: PathPoint,
  mirror: boolean,
): PathData {
  const node = path.nodes[index];
  if (!node) return path;
  const next: PathNode = { ...node, [side]: offset };
  if (mirror) {
    const other = side === 'in' ? 'out' : 'in';
    if (node[other]) next[other] = neg(offset);
  }
  return setNode(path, index, next);
}

// Corner (no handles) -> smooth (mirrored handles along the neighbor chord);
// any node with handles -> corner (handles dropped).
export function toggleSmooth(path: PathData, index: number): PathData {
  const node = path.nodes[index];
  if (!node) return path;
  if (node.in || node.out) {
    return setNode(path, index, { anchor: node.anchor });
  }
  const n = path.nodes.length;
  // On an OPEN path, endpoints have only one neighbor; use the node itself for the
  // missing side so the tangent follows the real chord instead of wrapping across
  // the whole path. Closed paths wrap normally.
  const atStart = !path.closed && index === 0;
  const atEnd = !path.closed && index === n - 1;
  const prev = atStart ? node : path.nodes[(index - 1 + n) % n];
  const nxt = atEnd ? node : path.nodes[(index + 1) % n];
  // Tangent ~ direction from prev to next; handle length = 1/4 of that chord.
  const dx = (nxt.anchor.x - prev.anchor.x) / 4;
  const dy = (nxt.anchor.y - prev.anchor.y) / 4;
  // `0 - v` (not `-v`) avoids -0 in the stored offsets.
  return setNode(path, index, { anchor: node.anchor, in: { x: 0 - dx, y: 0 - dy }, out: { x: dx, y: dy } });
}

// Enforces mirrored handles (in == -out). If only one exists, mirror it across.
// The inverse ("break" — independent handles) needs no data mutation: handles are
// already independent offsets, so a broken node is just one whose drag does not
// mirror (decided at drag time by handle collinearity in usePathTools).
export function joinHandle(path: PathData, index: number): PathData {
  const node = path.nodes[index];
  if (!node) return path;
  if (node.out) return setNode(path, index, { ...node, in: neg(node.out) });
  if (node.in) return setNode(path, index, { ...node, out: neg(node.in) });
  return path;
}

// Keep a sparse per-node-easing array aligned with path.nodes across a node insert/delete.
// Insert: a hole at `index`. Delete: drop `index`. Collapses to undefined when empty.
export function spliceNodeEasings(
  easings: Easing[] | undefined,
  index: number,
  op: 'insert' | 'delete',
): Easing[] | undefined {
  if (!easings) return easings;
  const next = easings.slice();
  if (op === 'insert') next.splice(index, 0, undefined as unknown as Easing);
  else next.splice(index, 1);
  return next.some((e) => e != null) ? next : undefined;
}

// Keep a correspondence map (a-index -> b-index, length === node count) aligned across a
// node insert/delete. Insert: the new node inherits its predecessor's b-target (an adjacent
// merge), so the map stays valid AND cyclic-order-preserving. Delete: drop the entry.
export function spliceCorrespondence(
  correspondence: number[] | undefined,
  index: number,
  op: 'insert' | 'delete',
): number[] | undefined {
  if (!correspondence) return correspondence;
  const next = correspondence.slice();
  if (op === 'insert') {
    const inherit = index > 0 ? next[index - 1] : (next[0] ?? 0);
    next.splice(index, 0, inherit);
  } else {
    next.splice(index, 1);
  }
  return next;
}
