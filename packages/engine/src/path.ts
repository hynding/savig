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

// Serialize a primary path plus optional extra closed rings (boolean-op compound
// results) as one `d` — each ring an independent M…Z subpath. Render with
// fill-rule:evenodd so interior rings cut holes. The SINGLE definition shared by
// the editor Stage and the export runtime (preview == export).
export function pathToDRings(primary: PathData, rings?: PathData[]): string {
  const base = pathToD(primary);
  if (!rings || rings.length === 0) return base;
  return [base, ...rings.map(pathToD)].filter((d) => d.length > 0).join(' ');
}

const BOUNDS_EPS = 1e-9;

// Real roots in the OPEN interval (0,1) of a*t^2 + b*t + c. Endpoints (t=0,1) are
// covered by the anchor pass, so only interior extrema matter here.
function quadRootsInUnit(a: number, b: number, c: number): number[] {
  const out: number[] = [];
  if (Math.abs(a) < BOUNDS_EPS) {
    if (Math.abs(b) >= BOUNDS_EPS) out.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      out.push((-b + s) / (2 * a), (-b - s) / (2 * a));
    }
  }
  return out.filter((t) => t > BOUNDS_EPS && t < 1 - BOUNDS_EPS);
}

// Axis-wise interior extrema parameters of a cubic with control values p0,c1,c2,p3.
// B'(t)=0 => (d0-2d1+d2)t^2 + 2(d1-d0)t + d0 = 0, with d0=c1-p0, d1=c2-c1, d2=p3-c2.
function cubicExtremaParams(p0: number, c1: number, c2: number, p3: number): number[] {
  const d0 = c1 - p0;
  const d1 = c2 - c1;
  const d2 = p3 - c2;
  return quadRootsInUnit(d0 - 2 * d1 + d2, 2 * (d1 - d0), d0);
}

function cubicAt(p0: number, c1: number, c2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * c1 + 3 * u * t * t * c2 + t * t * t * p3;
}

// Visual (curve-tight) bounding box: every anchor plus the interior extrema of each
// cubic segment (segment is a cubic iff `prev.out || cur.in`, mirroring pathToD).
export function pathBounds(path: PathData): { x: number; y: number; width: number; height: number } {
  const { nodes, closed } = path;
  if (nodes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const fold = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const n of nodes) fold(n.anchor.x, n.anchor.y);

  const curve = (prev: PathNode, cur: PathNode) => {
    // `!prev.out && !cur.in` is the De Morgan dual of pathToD's segment() rule
    // (`prev.out || cur.in` => cubic); keep the two in sync. A straight segment's
    // endpoints are already folded by the anchor pass, so bail out.
    if (!prev.out && !cur.in) return;
    const c1 = add(prev.anchor, prev.out);
    const c2 = add(cur.anchor, cur.in);
    const ax = [prev.anchor.x, c1.x, c2.x, cur.anchor.x] as const;
    const ay = [prev.anchor.y, c1.y, c2.y, cur.anchor.y] as const;
    const ts = [...cubicExtremaParams(...ax), ...cubicExtremaParams(...ay)];
    for (const t of ts) fold(cubicAt(...ax, t), cubicAt(...ay, t));
  };
  for (let i = 1; i < nodes.length; i++) curve(nodes[i - 1], nodes[i]);
  // Closing segment: called unconditionally but `curve` early-returns for a straight
  // close, matching pathToD which only emits the explicit closing C when handled.
  if (closed && nodes.length > 1) curve(nodes[nodes.length - 1], nodes[0]);

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// Bounds spanning a primary path and any compound rings (boolean-op results).
export function pathBoundsRings(
  primary: PathData,
  rings?: PathData[],
): { x: number; y: number; width: number; height: number } {
  const boxes = [pathBounds(primary), ...(rings ?? []).map(pathBounds)].filter((b) => b.width > 0 || b.height > 0);
  if (boxes.length === 0) return pathBounds(primary);
  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.width));
  const maxY = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

const ZERO: PathPoint = { x: 0, y: 0 };

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpPoint(a: PathPoint, b: PathPoint, t: number): PathPoint {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

// Interpolate one node pair. An absent handle is treated as a zero offset; the
// interpolated handle is OMITTED (corner / straight segment) only when neither
// input had it, preserving pathToD's `L` shortcut.
export function lerpNode(a: PathNode, b: PathNode, t: number): PathNode {
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

  const { an, bn, aIndex } = reconcile(a.path, b.path, a.morph ?? 'corresponded', a.correspondence);
  const nodes: PathNode[] = [];
  for (let k = 0; k < an.length; k++) {
    // Per-node easing follows its source node via aIndex; a -1 pair (spur / padding /
    // resampled) or a hole/null falls back to the keyframe's easing.
    const e = (aIndex[k] >= 0 ? a.nodeEasings?.[aIndex[k]] : undefined) ?? a.easing;
    nodes.push(lerpNode(an[k], bn[k], applyEasing(e, rawProgress)));
  }
  return { nodes, closed: a.path.closed };
}
