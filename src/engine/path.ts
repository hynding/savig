import { applyEasing } from './easing';
import { fmt } from './transform';
import { reconcile } from './morph/reconcile';
import type { PathData, PathNode, PathPoint, ShapeKeyframe } from './types';

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

const ZERO: PathPoint = { x: 0, y: 0 };

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpPoint(a: PathPoint, b: PathPoint, t: number): PathPoint {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

// Interpolate one node pair. An absent handle is treated as a zero offset; the
// interpolated handle is OMITTED (corner / straight segment) only when neither
// input had it, preserving pathToD's `L` shortcut.
function lerpNode(a: PathNode, b: PathNode, t: number): PathNode {
  const node: PathNode = { anchor: lerpPoint(a.anchor, b.anchor, t) };
  if (a.in || b.in) node.in = lerpPoint(a.in ?? ZERO, b.in ?? ZERO, t);
  if (a.out || b.out) node.out = lerpPoint(a.out ?? ZERO, b.out ?? ZERO, t);
  return node;
}

// Pure morph oracle: interpolate a shape track to a PathData at `time`. Mirrors
// `interpolate`'s bracketing/clamp; the SINGLE definition shared by the Stage and
// the export runtime so a morph is byte-identical preview == export. `closed` is
// held from the FROM keyframe (no midpoint flip).
export function samplePath(track: ShapeKeyframe[], time: number): PathData {
  if (track.length === 0) {
    throw new Error('samplePath: track must contain at least one keyframe');
  }
  const first = track[0];
  const last = track[track.length - 1];
  if (time <= first.time) return first.path;
  if (time >= last.time) return last.path;

  let a = first;
  let b = last;
  for (let i = 0; i < track.length - 1; i++) {
    if (time >= track[i].time && time < track[i + 1].time) {
      a = track[i];
      b = track[i + 1];
      break;
    }
  }

  const span = b.time - a.time;
  const rawProgress = span === 0 ? 0 : (time - a.time) / span;
  const t = applyEasing(a.easing, rawProgress);

  const { an, bn } = reconcile(a.path, b.path, a.morph ?? 'corresponded', a.correspondence);
  const nodes: PathNode[] = [];
  for (let i = 0; i < an.length; i++) nodes.push(lerpNode(an[i], bn[i], t));
  return { nodes, closed: a.path.closed };
}
