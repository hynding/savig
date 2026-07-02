import type { PathPoint, PathData, PathNode } from '../types';

export interface Cubic {
  p0: PathPoint;
  c1: PathPoint;
  c2: PathPoint;
  p3: PathPoint;
}

const lerp = (a: PathPoint, b: PathPoint, t: number): PathPoint => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

export function evalCubic(c: Cubic, t: number): PathPoint {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const d = 3 * u * t * t;
  const e = t * t * t;
  return {
    x: a * c.p0.x + b * c.c1.x + d * c.c2.x + e * c.p3.x,
    y: a * c.p0.y + b * c.c1.y + d * c.c2.y + e * c.p3.y,
  };
}

export function reverseCubic(c: Cubic): Cubic {
  return { p0: c.p3, c1: c.c2, c2: c.c1, p3: c.p0 };
}

/** De Casteljau split at `t`, returning the LEFT [0,t] sub-cubic. */
function splitLeft(c: Cubic, t: number): Cubic {
  const ab = lerp(c.p0, c.c1, t);
  const bc = lerp(c.c1, c.c2, t);
  const cd = lerp(c.c2, c.p3, t);
  const abc = lerp(ab, bc, t);
  const bcd = lerp(bc, cd, t);
  const p = lerp(abc, bcd, t);
  return { p0: c.p0, c1: ab, c2: abc, p3: p };
}

/** De Casteljau split at `t`, returning the RIGHT [t,1] sub-cubic. */
function splitRight(c: Cubic, t: number): Cubic {
  const ab = lerp(c.p0, c.c1, t);
  const bc = lerp(c.c1, c.c2, t);
  const cd = lerp(c.c2, c.p3, t);
  const abc = lerp(ab, bc, t);
  const bcd = lerp(bc, cd, t);
  const p = lerp(abc, bcd, t);
  return { p0: p, c1: bcd, c2: cd, p3: c.p3 };
}

/** Sub-cubic over [t0,t1]; if t0 > t1 the result is reversed (traversal-ordered). */
export function splitCubicRange(c: Cubic, t0: number, t1: number): Cubic {
  const lo = Math.min(t0, t1);
  const hi = Math.max(t0, t1);
  // Take the right [lo,1] piece, then the left of the remapped hi within it.
  const right = splitRight(c, lo);
  const remapped = lo >= 1 ? 1 : (hi - lo) / (1 - lo);
  const sub = splitLeft(right, Math.min(1, Math.max(0, remapped)));
  return t0 <= t1 ? sub : reverseCubic(sub);
}

/**
 * Nearest point on a cubic to `p`, returned as its parameter `t` and distance.
 * Assumes the squared-distance function is unimodal within ±1 seed interval of the
 * coarse minimum — true for the simple arc / line / path segments boolean operands
 * produce. A self-intersecting cubic could yield a local rather than global minimum.
 */
export function projectToCubic(c: Cubic, p: PathPoint): { t: number; dist: number } {
  const d2 = (q: PathPoint) => (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
  // Coarse seed across the parameter range.
  const SEED = 24;
  let bestT = 0;
  let bestD = Infinity;
  for (let i = 0; i <= SEED; i++) {
    const t = i / SEED;
    const dd = d2(evalCubic(c, t));
    if (dd < bestD) {
      bestD = dd;
      bestT = t;
    }
  }
  // Ternary-search refine around the seed.
  let lo = Math.max(0, bestT - 1 / SEED);
  let hi = Math.min(1, bestT + 1 / SEED);
  for (let i = 0; i < 40; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (d2(evalCubic(c, m1)) < d2(evalCubic(c, m2))) hi = m2;
    else lo = m1;
  }
  const t = (lo + hi) / 2;
  return { t, dist: Math.sqrt(d2(evalCubic(c, t))) };
}

export interface OperandCubics {
  opIdx: number;
  segs: Cubic[];
}

export interface VertProvenance {
  opIdx: number;
  segIdx: number;
  t: number;
}

/**
 * Classify a clipped output vertex by projecting it onto every operand's source cubics.
 * Returns the nearest segment's provenance if within `tol`, else null (a genuine
 * intersection vertex → corner). `tol` should exceed polygon-clipping's coordinate
 * rounding and stay below operand feature size.
 */
export function classifyVertex(
  operands: OperandCubics[],
  p: PathPoint,
  tol: number,
): VertProvenance | null {
  let best: VertProvenance | null = null;
  let bestDist = tol;
  for (const op of operands) {
    for (let segIdx = 0; segIdx < op.segs.length; segIdx++) {
      const { t, dist } = projectToCubic(op.segs[segIdx], p);
      if (dist < bestDist) {
        bestDist = dist;
        best = { opIdx: op.opIdx, segIdx, t };
      }
    }
  }
  return best;
}

const DEFAULT_STEPS = 16;

/**
 * Flatten a closed loop of cubic segments into a polygon-clipping ring (first point
 * repeated at the end). Provenance is NOT carried on the samples — it is recovered later
 * by projecting clipped vertices back onto the source cubics. `steps` mirrors FLATTEN_STEPS.
 */
export function cubicsToRing(cubics: Cubic[], steps = DEFAULT_STEPS): [number, number][] {
  if (cubics.length === 0) return [];
  const n = Math.max(1, Math.floor(steps)); // at least one sample per segment
  const ring: [number, number][] = [];
  for (const c of cubics) {
    // sample t in [0,1) per segment; the next segment's t=0 supplies the shared node.
    for (let s = 0; s < n; s++) {
      const p = evalCubic(c, s / n);
      ring.push([p.x, p.y]);
    }
  }
  ring.push([ring[0][0], ring[0][1]]); // close
  return ring;
}

export function isStraightCubic(c: Cubic, eps = 1e-6): boolean {
  const vx = c.p3.x - c.p0.x;
  const vy = c.p3.y - c.p0.y;
  const len = Math.hypot(vx, vy);
  if (len < eps) return true; // degenerate point
  // Perpendicular distance of each control point from the p0->p3 line.
  const cross = (q: PathPoint) => Math.abs((q.x - c.p0.x) * vy - (q.y - c.p0.y) * vx) / len;
  return cross(c.c1) < eps && cross(c.c2) < eps;
}

/** One reconstructed output segment of a result ring: a straight line or a cubic. */
export type OutSeg =
  | { kind: 'line'; a: PathPoint; b: PathPoint }
  | { kind: 'cubic'; c: Cubic };

const segStart = (s: OutSeg): PathPoint => (s.kind === 'line' ? s.a : s.c.p0);
const segEnd = (s: OutSeg): PathPoint => (s.kind === 'line' ? s.b : s.c.p3);

/**
 * Assemble a closed loop of output segments into a PathData. Each node sits at the joint
 * where one segment ends and the next begins: it takes `out` from the outgoing segment and
 * `in` from the incoming one (anchor-relative offsets). Lines and straight cubics
 * contribute no handle, yielding corner nodes.
 */
export function segmentsToPathData(segs: OutSeg[]): PathData {
  const n = segs.length;
  const nodes: PathNode[] = [];
  for (let i = 0; i < n; i++) {
    const outgoing = segs[i];
    const incoming = segs[(i - 1 + n) % n]; // the segment ending at this node
    const anchor = segStart(outgoing);
    const node: PathNode = { anchor };

    if (outgoing.kind === 'cubic' && !isStraightCubic(outgoing.c)) {
      node.out = { x: outgoing.c.c1.x - anchor.x, y: outgoing.c.c1.y - anchor.y };
    }
    if (incoming.kind === 'cubic' && !isStraightCubic(incoming.c)) {
      const end = segEnd(incoming);
      node.in = { x: incoming.c.c2.x - end.x, y: incoming.c.c2.y - end.y };
    }
    nodes.push(node);
  }
  return { closed: true, nodes };
}

function stripClose(ring: [number, number][]): [number, number][] {
  if (ring.length > 1) {
    const f = ring[0];
    const l = ring[ring.length - 1];
    if (f[0] === l[0] && f[1] === l[1]) return ring.slice(0, -1);
  }
  return ring;
}

function cornersOnly(verts: [number, number][]): PathData {
  return { closed: true, nodes: verts.map(([x, y]) => ({ anchor: { x, y } })) };
}

/**
 * Reconstruct one clipped, closed ring into curved PathData by recovering each vertex's
 * provenance (projection onto operand cubics) and rebuilding untouched runs as sub-curves.
 * Returns null only when the result would be degenerate (< 3 nodes) so the caller can fall
 * back to the faceted ring.
 */
export function reconstructRing(
  ring: [number, number][],
  operands: OperandCubics[],
  tol: number,
): PathData | null {
  const verts = stripClose(ring);
  if (verts.length < 3) return null;

  const pt = (i: number): PathPoint => ({ x: verts[i][0], y: verts[i][1] });
  const prov = verts.map((v) => classifyVertex(operands, { x: v[0], y: v[1] }, tol));

  // Verbatim: every vertex matched the SAME operand with no intersection corner -> the
  // operand survives untouched; rebuild from its ORIGINAL segments (ignore clip ordering).
  const firstOp = prov[0]?.opIdx;
  const verbatim = firstOp !== undefined && prov.every((p) => p !== null && p.opIdx === firstOp);
  if (verbatim) {
    const operand = operands.find((o) => o.opIdx === firstOp);
    if (operand && operand.segs.length >= 2) {
      const pd = segmentsToPathData(operand.segs.map((c) => ({ kind: 'cubic', c })));
      if (pd.nodes.length >= 3) return pd;
    }
  }

  const n = verts.length;
  const sameRun = (i: number, j: number): boolean => {
    const a = prov[i];
    const b = prov[j];
    return !!a && !!b && a.opIdx === b.opIdx && a.segIdx === b.segIdx;
  };
  const segOfProv = (p: VertProvenance): Cubic =>
    operands.find((o) => o.opIdx === p.opIdx)!.segs[p.segIdx];
  // A vertex's geometric position: its ON-CURVE projection when it has provenance (more
  // accurate than the flattened polygon vertex, and identical to the split cubic's
  // endpoints so adjacent segments share endpoints exactly), else the raw corner vertex.
  const ptOf = (idx: number): PathPoint => {
    const p = prov[idx];
    return p ? evalCubic(segOfProv(p), p.t) : pt(idx);
  };

  // Rotate the walk to start at a run boundary (a vertex whose predecessor differs).
  let start = 0;
  for (let i = 0; i < n; i++) {
    if (!sameRun((i - 1 + n) % n, i)) {
      start = i;
      break;
    }
  }

  const segs: OutSeg[] = [];
  let i = 0;
  while (i < n) {
    const idx = (start + i) % n;
    const p = prov[idx];
    if (!p) {
      // intersection corner -> straight line to the next vertex
      segs.push({ kind: 'line', a: ptOf(idx), b: ptOf((start + i + 1) % n) });
      i += 1;
      continue;
    }
    // extend the run while consecutive vertices share the same (opIdx, segIdx)
    let j = i;
    while (j + 1 < n && sameRun((start + j) % n, (start + j + 1) % n)) j += 1;
    const aIdx = (start + i) % n;
    const bIdx = (start + j) % n;
    const cubic = segOfProv(p);
    if (isStraightCubic(cubic)) {
      segs.push({ kind: 'line', a: ptOf(aIdx), b: ptOf(bIdx) });
    } else {
      segs.push({ kind: 'cubic', c: splitCubicRange(cubic, p.t, prov[bIdx]!.t) });
    }
    // Stitch a short line to the next vertex when the run doesn't reach it. A curved run
    // ends at its last in-run sample's t, a sample-step short of the true seam, so at an
    // intersection the curvature is exact away from the seam and minutely straight right
    // at it (v1 approximation). ptOf keeps the stitch endpoints coincident with the
    // curve's actual endpoints, so the path stays continuous.
    if (j + 1 < n) {
      const e = ptOf(bIdx);
      const s = ptOf((start + j + 1) % n);
      if (Math.hypot(s.x - e.x, s.y - e.y) > 1e-9) segs.push({ kind: 'line', a: e, b: s });
    }
    i = j + 1;
  }

  // close the loop: ensure the last segment's end meets the first segment's start
  if (segs.length >= 2) {
    const lastEnd = segEnd(segs[segs.length - 1]);
    const firstStart = segStart(segs[0]);
    if (Math.hypot(firstStart.x - lastEnd.x, firstStart.y - lastEnd.y) > 1e-9) {
      segs.push({ kind: 'line', a: lastEnd, b: firstStart });
    }
  }

  const pd = segmentsToPathData(segs);
  // verts.length >= 3 is guaranteed above, so the corner fallback is always valid geometry.
  return pd.nodes.length >= 3 ? pd : cornersOnly(verts);
}
