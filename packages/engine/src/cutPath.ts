import type { PathData, PathNode, PathPoint } from './types';
import { splitCubicRange, type Cubic } from './geom/boolean-curves';

/** Clamp floor/ceiling for the cut parameter: keeps de Casteljau split away from the
 *  segment's own endpoints and lets us reject boundary-adjacent cuts on an open path
 *  (see cutPath's degenerate-piece check). */
const EPS = 1e-6;

const lerpPoint = (a: PathPoint, b: PathPoint, t: number): PathPoint => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

/** A segment's control point, as an ABSOLUTE point: PathNode handles are anchor-relative
 *  offsets (see types.ts), so `anchor + offset` recovers the absolute cubic control point. */
const absHandle = (anchor: PathPoint, offset: PathPoint | undefined): PathPoint =>
  offset ? { x: anchor.x + offset.x, y: anchor.y + offset.y } : anchor;

/** Same L/C classification pathToD/flattenPath use: a segment is a cubic iff either
 *  adjoining handle is present, else it's a straight line (arcLength.ts:flattenPoints). */
const isCurvedSegment = (a: PathNode, b: PathNode): boolean => !!(a.out || b.in);

interface SegmentEndpoints {
  a: PathNode;
  b: PathNode;
  /** Index of `b` within `path.nodes` (wraps to 0 for a closed path's last segment). */
  bIdx: number;
}

/** Resolve segment `segmentIndex`'s two endpoint nodes. Returns null for an out-of-range
 *  index (negative, `>= segment count`) or a path with fewer than 2 nodes. Open paths have
 *  `nodes.length - 1` segments (0-indexed, no wrap); closed paths have `nodes.length`
 *  segments, with the last one wrapping from the final node back to nodes[0]. */
function segmentEndpoints(path: PathData, segmentIndex: number): SegmentEndpoints | null {
  const { nodes, closed } = path;
  const n = nodes.length;
  if (n < 2 || segmentIndex < 0) return null;
  if (closed) {
    if (segmentIndex >= n) return null;
    const bIdx = (segmentIndex + 1) % n;
    return { a: nodes[segmentIndex], b: nodes[bIdx], bIdx };
  }
  if (segmentIndex > n - 2) return null;
  return { a: nodes[segmentIndex], b: nodes[segmentIndex + 1], bIdx: segmentIndex + 1 };
}

/**
 * The cubic underlying segment `segmentIndex` of `path`, or `null` for a straight
 * (no-handle) segment. CONVENTION (documented per the task brief's either/or choice):
 * straight segments return `null`, not a degenerate 1/3-2/3 cubic. This mirrors how the
 * Stage is meant to use it (design spec "Chord-t → curve-t"): straight segments use the
 * click's chord-t directly, and only handled segments need `projectToCubic` re-projection
 * onto the cubic this function returns — a `null` return is the caller's signal to skip
 * projection entirely rather than run it against a synthetic straight cubic.
 */
export function segmentCubic(path: PathData, segmentIndex: number): Cubic | null {
  const seg = segmentEndpoints(path, segmentIndex);
  if (!seg) return null;
  const { a, b } = seg;
  if (!isCurvedSegment(a, b)) return null;
  return {
    p0: a.anchor,
    c1: absHandle(a.anchor, a.out),
    c2: absHandle(b.anchor, b.in),
    p3: b.anchor,
  };
}

/** `node` with its `out` handle replaced (or cleared, if undefined); `in` is preserved. */
function withOut(node: PathNode, out: PathPoint | undefined): PathNode {
  const next: PathNode = { anchor: node.anchor };
  if (node.in) next.in = node.in;
  if (out) next.out = out;
  return next;
}

/** `node` with its `in` handle replaced (or cleared, if undefined); `out` is preserved. */
function withIn(node: PathNode, inH: PathPoint | undefined): PathNode {
  const next: PathNode = { anchor: node.anchor };
  if (inH) next.in = inH;
  if (node.out) next.out = node.out;
  return next;
}

/** Builds one of the two cut-point anchor nodes (corner node — no cross-cut smoothing). */
function cutNode(anchor: PathPoint, inH: PathPoint | undefined, out: PathPoint | undefined): PathNode {
  const node: PathNode = { anchor };
  if (inH) node.in = inH;
  if (out) node.out = out;
  return node;
}

export type CutPathResult =
  | { kind: 'opened'; path: PathData }
  | { kind: 'split'; a: PathData; b: PathData }
  | { kind: 'noop' };

/**
 * Cut `path` at parameter `t` along `segmentIndex` (CURVE t, not chord t — see
 * `segmentCubic`/`projectToCubic` for chord-t re-projection). Geometry-exact: curved
 * segments split via de Casteljau (`splitCubicRange`), straight segments split by lerp
 * with no handles on the cut anchors (matching `splitCubicRange`'s own straight-line
 * behavior, so both segment kinds meet at the same cut point with the correct tangents).
 *
 * - Closed path → `{ kind: 'opened' }`: the cut point becomes `nodes[0]` (carrying the
 *   `out` handle toward the rest of the loop) AND is duplicated as the last node
 *   (carrying the `in` handle arriving from the loop); node order walks the original
 *   winding starting just after the cut; `closed: false`. Total node count is the
 *   original count + 2.
 * - Open path → `{ kind: 'split' }`: piece `a` = nodes[0..segmentIndex] + cut point,
 *   piece `b` = cut point + nodes[segmentIndex+1..end], both `closed: false`. `t` is
 *   clamped into `(EPS, 1-EPS)` first; if that clamp pins `t` to its floor on the path's
 *   very first segment (or its ceiling on the very last segment) the corresponding piece
 *   would be reduced to a single meaningful node (the cut essentially lands on the path's
 *   own start/end anchor) — that case returns `{ kind: 'noop' }` instead.
 */
export function cutPath(path: PathData, segmentIndex: number, t: number): CutPathResult {
  const { nodes, closed } = path;
  const n = nodes.length;
  const seg = segmentEndpoints(path, segmentIndex);
  if (!seg) return { kind: 'noop' };
  const { a: nodeA, b: nodeB, bIdx } = seg;

  const tc = Math.min(Math.max(t, EPS), 1 - EPS);

  if (!closed) {
    const lastSegIdx = n - 2;
    if (segmentIndex === 0 && tc <= EPS) return { kind: 'noop' };
    if (segmentIndex === lastSegIdx && tc >= 1 - EPS) return { kind: 'noop' };
  }

  const curved = isCurvedSegment(nodeA, nodeB);

  let cutAnchor: PathPoint;
  let outFromA: PathPoint | undefined; // nodeA's subdivided out (toward the cut)
  let inToB: PathPoint | undefined; // nodeB's subdivided in (from the cut)
  let cutOut: PathPoint | undefined; // cut point's out (toward nodeB side)
  let cutIn: PathPoint | undefined; // cut point's in (from nodeA side)

  if (curved) {
    const c: Cubic = {
      p0: nodeA.anchor,
      c1: absHandle(nodeA.anchor, nodeA.out),
      c2: absHandle(nodeB.anchor, nodeB.in),
      p3: nodeB.anchor,
    };
    const left = splitCubicRange(c, 0, tc);
    const right = splitCubicRange(c, tc, 1);
    cutAnchor = left.p3;
    outFromA = { x: left.c1.x - nodeA.anchor.x, y: left.c1.y - nodeA.anchor.y };
    inToB = { x: right.c2.x - nodeB.anchor.x, y: right.c2.y - nodeB.anchor.y };
    cutOut = { x: right.c1.x - cutAnchor.x, y: right.c1.y - cutAnchor.y };
    cutIn = { x: left.c2.x - cutAnchor.x, y: left.c2.y - cutAnchor.y };
  } else {
    cutAnchor = lerpPoint(nodeA.anchor, nodeB.anchor, tc);
  }

  if (closed) {
    const order: PathNode[] = [cutNode(cutAnchor, undefined, cutOut)];
    for (let k = 1; k <= n; k++) {
      const idx = (segmentIndex + k) % n;
      if (idx === bIdx) order.push(withIn(nodes[idx], inToB));
      else if (idx === segmentIndex) order.push(withOut(nodes[idx], outFromA));
      else order.push({ ...nodes[idx] });
    }
    order.push(cutNode(cutAnchor, cutIn, undefined));
    return { kind: 'opened', path: { closed: false, nodes: order } };
  }

  const aNodes: PathNode[] = [];
  for (let i = 0; i < segmentIndex; i++) aNodes.push({ ...nodes[i] });
  aNodes.push(withOut(nodeA, outFromA));
  aNodes.push(cutNode(cutAnchor, cutIn, undefined));

  const bNodes: PathNode[] = [cutNode(cutAnchor, undefined, cutOut), withIn(nodeB, inToB)];
  for (let i = bIdx + 1; i < n; i++) bNodes.push({ ...nodes[i] });

  return {
    kind: 'split',
    a: { closed: false, nodes: aNodes },
    b: { closed: false, nodes: bNodes },
  };
}
