import type { PathData, PathPoint } from '../types';
import { flattenPath } from './arcLength';
import { ringArea, pc } from './boolean';

// Local structural aliases for polygon-clipping geometry — mirrors geom/boolean.ts:10-17.
type Pair = [number, number];
type PcRing = Pair[];
type PcPolygon = PcRing[];
type PcMultiPolygon = PcPolygon[];

// The defensive ESM/CJS `pc` binding lives in geom/boolean.ts (geom/boolean.ts:19-26) and is
// imported (not re-derived) here: boolean.ts already has a live top-level `import * as ns from
// 'polygon-clipping'` (its own `pc` is used elsewhere), so importing its resolved `pc` adds NO
// second copy of that import. A second independent `import * as polygonClippingNs from
// 'polygon-clipping'` in THIS module would itself be a call-containing top-level statement that
// esbuild's tree-shaking won't prove side-effect-free — verified empirically: even wrapping the
// resolution lazily in an uncalled function still left it (and an unrelated constant) as dead
// residue in the generated packages/runtime bundle. Reusing boolean.ts's `pc` avoids the
// duplicate import entirely, so this module tree-shakes to nothing when unreferenced.

export type StrokeCap = 'butt' | 'square' | 'round';
export type StrokeJoin = 'bevel' | 'round' | 'miter';
export type StrokeWidth = number | ((t: number) => number);

// Interior-arc sample counts. "Interior" = excludes the two exact from/to points the caller
// already has, so the count below is how many EXTRA points a round join/cap contributes.
const ROUND_JOIN_STEPS = 6;
const ROUND_CAP_STEPS = 12;

function halfWidthAt(width: StrokeWidth, t: number): number {
  const w = typeof width === 'function' ? width(t) : width;
  return w / 2;
}

function safeNormalize(dx: number, dy: number, fallback: PathPoint): PathPoint {
  const len = Math.hypot(dx, dy);
  return len < 1e-9 ? fallback : { x: dx / len, y: dy / len };
}

/**
 * Per-vertex offset of a (possibly open) polyline by `width`/2 on each side, using a simple
 * neighbor-diff tangent (endpoint one-sided, interior = central difference pts[i+1]-pts[i-1]).
 * This is intentionally NOT edge-based miter offsetting: at a sharp corner it places a single
 * point along the bisector of the two adjacent (unit) tangents, at distance width/2 from the
 * vertex — which, for join='bevel'/'miter' (see outlineStroke), is the whole join: no extra
 * corner geometry is added, so the assembled ring is naturally "cut" at corners (a bevel-like
 * look) without any special-casing. join='round' post-processes this same base offset by
 * replacing that single corner point with an arc (see detectCorners/arcBetween below) — and
 * because the blended bisector point turns out to sit exactly on that arc's circle (proof in
 * outlineStroke's corner-handling comment), 'round' always has >= area and > points vs the
 * base ('bevel'/'miter') output, never fewer.
 *
 * `width` may be a constant or a function of normalized arc-length (cum[i]/total) — this is
 * the M6 outline-stroke "variable width" hook (feature-6).
 */
export function offsetPolyline(
  pts: PathPoint[],
  cum: number[],
  total: number,
  width: StrokeWidth,
): { left: PathPoint[]; right: PathPoint[] } {
  const n = pts.length;
  const left: PathPoint[] = [];
  const right: PathPoint[] = [];
  let lastTangent: PathPoint = { x: 1, y: 0 };
  for (let i = 0; i < n; i++) {
    let t: PathPoint;
    if (n < 2) {
      t = lastTangent;
    } else if (i === 0) {
      t = safeNormalize(pts[1].x - pts[0].x, pts[1].y - pts[0].y, lastTangent);
    } else if (i === n - 1) {
      t = safeNormalize(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, lastTangent);
    } else {
      t = safeNormalize(pts[i + 1].x - pts[i - 1].x, pts[i + 1].y - pts[i - 1].y, lastTangent);
    }
    lastTangent = t; // zero-length-segment fallback: reuse the last valid tangent (dup points)
    const nx = -t.y;
    const ny = t.x;
    const h = halfWidthAt(width, total > 0 ? cum[i] / total : 0);
    left.push({ x: pts[i].x + nx * h, y: pts[i].y + ny * h });
    right.push({ x: pts[i].x - nx * h, y: pts[i].y - ny * h });
  }
  return { left, right };
}

function normalizeAngleDiff(a: number): number {
  let d = a % (2 * Math.PI);
  if (d <= -Math.PI) d += 2 * Math.PI;
  if (d > Math.PI) d -= 2 * Math.PI;
  return d;
}

// Interior points (excludes the from/to endpoints) of the arc of `radius` around `center`,
// sweeping from `angleFrom` to `angleTo`. A 180 deg sweep (round caps) is ambiguous between its
// two equal-length directions, so `bulgeDir` (a hint vector, need not be unit-length) picks
// whichever direction's angular midpoint points more toward it; for join arcs (< 180 deg) the
// "short way" and the bulge-preferred way always coincide (a convex corner's turn is < 180 deg).
function arcBetween(
  center: PathPoint,
  radius: number,
  angleFrom: number,
  angleTo: number,
  bulgeDir: PathPoint,
  steps: number,
): PathPoint[] {
  if (radius < 1e-9 || steps < 2) return [];
  const shortDelta = normalizeAngleDiff(angleTo - angleFrom);
  const longDelta = shortDelta >= 0 ? shortDelta - 2 * Math.PI : shortDelta + 2 * Math.PI;
  const dotAt = (delta: number) => {
    const mid = angleFrom + delta / 2;
    return Math.cos(mid) * bulgeDir.x + Math.sin(mid) * bulgeDir.y;
  };
  const delta = dotAt(shortDelta) >= dotAt(longDelta) ? shortDelta : longDelta;
  const out: PathPoint[] = [];
  for (let i = 1; i < steps; i++) {
    const a = angleFrom + (delta * i) / steps;
    out.push({ x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) });
  }
  return out;
}

interface Corner {
  index: number;
  outer: 'left' | 'right';
  angleIn: number;
  angleOut: number;
  bulgeDir: PathPoint;
  radius: number;
}

// Hard corners in the flattened centerline (turn angle beyond a threshold), with the data
// needed to draw a round-join arc on the OUTER (convex) side: the side away from the turn.
function detectCorners(pts: PathPoint[], cum: number[], total: number, width: StrokeWidth): Corner[] {
  const n = pts.length;
  const corners: Corner[] = [];
  // A flattened curve (FLATTEN_STEPS=16 in arcLength.ts) turns by roughly (arcAngle/16) per
  // sample point — e.g. ~5.6 deg/step around a 90 deg curve — so this must sit comfortably above
  // typical curve-sampling turn angles and only fire for genuine authored corners (hairpins,
  // L-corners, etc). Kept as a local (not module-scope) const: see the file-header comment on
  // why this module avoids top-level bindings entirely (tree-shaking when unreferenced).
  const cornerAngleThreshold = Math.PI / 6; // 30 deg
  for (let i = 1; i < n - 1; i++) {
    const inDx = pts[i].x - pts[i - 1].x;
    const inDy = pts[i].y - pts[i - 1].y;
    const outDx = pts[i + 1].x - pts[i].x;
    const outDy = pts[i + 1].y - pts[i].y;
    const inLen = Math.hypot(inDx, inDy);
    const outLen = Math.hypot(outDx, outDy);
    if (inLen < 1e-9 || outLen < 1e-9) continue; // zero-length neighbor segment: no reliable corner
    const tIn = { x: inDx / inLen, y: inDy / inLen };
    const tOut = { x: outDx / outLen, y: outDy / outLen };
    const cross = tIn.x * tOut.y - tIn.y * tOut.x;
    const dot = tIn.x * tOut.x + tIn.y * tOut.y;
    const turn = Math.atan2(cross, dot); // signed turn angle in (-pi, pi]
    if (Math.abs(turn) < cornerAngleThreshold) continue;
    const outer: 'left' | 'right' = cross > 0 ? 'right' : 'left';
    const sign = outer === 'left' ? 1 : -1;
    const normalIn = { x: -tIn.y * sign, y: tIn.x * sign };
    const normalOut = { x: -tOut.y * sign, y: tOut.x * sign };
    let bulgeDir = { x: normalIn.x + normalOut.x, y: normalIn.y + normalOut.y };
    const bulgeLen = Math.hypot(bulgeDir.x, bulgeDir.y);
    if (bulgeLen < 1e-9) bulgeDir = normalIn; // near-180 deg fold: sum cancels, fall back to one side
    const h = halfWidthAt(width, total > 0 ? cum[i] / total : 0);
    corners.push({
      index: i,
      outer,
      angleIn: Math.atan2(normalIn.y, normalIn.x),
      angleOut: Math.atan2(normalOut.y, normalOut.x),
      bulgeDir,
      radius: h,
    });
  }
  return corners;
}

function capPoints(
  center: PathPoint,
  outward: PathPoint,
  fromPt: PathPoint,
  toPt: PathPoint,
  cap: StrokeCap,
  radius: number,
): PathPoint[] {
  if (cap === 'butt') return [];
  if (cap === 'square') {
    return [
      { x: fromPt.x + outward.x * radius, y: fromPt.y + outward.y * radius },
      { x: toPt.x + outward.x * radius, y: toPt.y + outward.y * radius },
    ];
  }
  const angleFrom = Math.atan2(fromPt.y - center.y, fromPt.x - center.x);
  const angleTo = Math.atan2(toPt.y - center.y, toPt.x - center.x);
  return arcBetween(center, radius, angleFrom, angleTo, outward, ROUND_CAP_STEPS);
}

// Assembles the single (possibly self-crossing) ring for an OPEN centerline: left side
// start->end, the end cap, the right side end->start, the start cap — implicitly closed back
// to left[0]. join='round' replaces the single blended offsetPolyline point at each hard corner
// with a multi-point arc on the outer side; join='bevel'/'miter' leave offsetPolyline's output
// untouched (miter is NOT implemented as a true line-intersection miter — it is documented to
// equal bevel, see outlineStroke's doc comment).
function outlineOpenRing(
  pts: PathPoint[],
  cum: number[],
  total: number,
  width: StrokeWidth,
  cap: StrokeCap,
  join: StrokeJoin,
): PathPoint[] {
  const n = pts.length;
  const { left, right } = offsetPolyline(pts, cum, total, width);
  const leftOut = left.slice();
  const rightOut = right.slice();

  if (join === 'round' && n >= 3) {
    const corners = detectCorners(pts, cum, total, width);
    // Splice back-to-front so earlier (lower) indices remain valid as later splices shift length.
    for (let k = corners.length - 1; k >= 0; k--) {
      const c = corners[k];
      const center = pts[c.index];
      const fromPt = { x: center.x + c.radius * Math.cos(c.angleIn), y: center.y + c.radius * Math.sin(c.angleIn) };
      const toPt = { x: center.x + c.radius * Math.cos(c.angleOut), y: center.y + c.radius * Math.sin(c.angleOut) };
      const interior = arcBetween(center, c.radius, c.angleIn, c.angleOut, c.bulgeDir, ROUND_JOIN_STEPS);
      const replacement = [fromPt, ...interior, toPt];
      if (c.outer === 'left') leftOut.splice(c.index, 1, ...replacement);
      else rightOut.splice(c.index, 1, ...replacement);
    }
  }

  const startTangent = safeNormalize(pts[1].x - pts[0].x, pts[1].y - pts[0].y, { x: 1, y: 0 });
  const endTangent = safeNormalize(pts[n - 1].x - pts[n - 2].x, pts[n - 1].y - pts[n - 2].y, { x: 1, y: 0 });
  const h0 = halfWidthAt(width, 0);
  const h1 = halfWidthAt(width, 1);

  const endCap = capPoints(pts[n - 1], endTangent, leftOut[leftOut.length - 1], rightOut[rightOut.length - 1], cap, h1);
  const startCap = capPoints(pts[0], { x: -startTangent.x, y: -startTangent.y }, rightOut[0], leftOut[0], cap, h0);

  return [...leftOut, ...endCap, ...rightOut.slice().reverse(), ...startCap];
}

function lineIntersect(p1: PathPoint, d1: PathPoint, p2: PathPoint, d2: PathPoint, fallback: PathPoint): PathPoint {
  // Solve p1 + t*d1 = p2 + s*d2 for t.
  const denom = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(denom) < 1e-9) return fallback; // parallel/collinear adjacent edges: no unique intersection
  const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / denom;
  return { x: p1.x + d1.x * t, y: p1.y + d1.y * t };
}

// Offsets a CLOSED polygonal centerline by projecting each EDGE outward along its own normal and
// intersecting each pair of adjacent offset-edge lines to find the vertex offset point (a true
// per-corner miter). This is deliberately a DIFFERENT algorithm from offsetPolyline's per-vertex
// blended-tangent approach: a coarse closed polygon (e.g. a 4-node square, test 4) has no
// intermediate points between its corners to average away the chamfering that the blended
// approach would otherwise introduce — edge-offset-and-intersect reproduces the exact
// wide/narrow rectangle bounds a round-trip through "each edge shifted outward by width/2"
// implies. `side` flips which normal direction is used (+1 / -1), producing the two "rails" of
// the annulus; outlineStroke decides after the fact which rail is the outer one via |ringArea|.
function offsetClosedRing(
  pts: PathPoint[],
  cum: number[],
  total: number,
  width: StrokeWidth,
  side: 1 | -1,
): PathPoint[] {
  const n = pts.length;
  const edgeTangent: PathPoint[] = [];
  const edgeLinePoint: PathPoint[] = []; // a point on edge i's OFFSET line (offset of pts[i])
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const t = safeNormalize(b.x - a.x, b.y - a.y, { x: 1, y: 0 });
    const nrm = { x: -t.y * side, y: t.x * side };
    const h = halfWidthAt(width, total > 0 ? cum[i] / total : 0);
    edgeTangent.push(t);
    edgeLinePoint.push({ x: a.x + nrm.x * h, y: a.y + nrm.y * h });
  }
  const ring: PathPoint[] = [];
  for (let i = 0; i < n; i++) {
    const prevEdge = (i - 1 + n) % n;
    const t = edgeTangent[i];
    const nrm = { x: -t.y * side, y: t.x * side };
    const h = halfWidthAt(width, total > 0 ? cum[i] / total : 0);
    const fallback = { x: pts[i].x + nrm.x * h, y: pts[i].y + nrm.y * h };
    ring.push(lineIntersect(edgeLinePoint[prevEdge], edgeTangent[prevEdge], edgeLinePoint[i], edgeTangent[i], fallback));
  }
  return ring;
}

function toPcRing(ring: PathPoint[]): PcRing {
  const out: PcRing = ring.map((p): Pair => [p.x, p.y]);
  if (ring.length > 0) out.push([ring[0].x, ring[0].y]); // close (matches boolean.ts's convention)
  return out;
}

function pcRingToPathData(ring: PcRing): PathData {
  const closed =
    ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
  const pts = closed ? ring.slice(0, -1) : ring;
  return { closed: true, nodes: pts.map(([x, y]) => ({ anchor: { x, y } })) };
}

/**
 * Converts a stroked centerline `path` into filled ink ring(s) — the geometric fill equivalent
 * of an SVG stroke. `width` is a constant or a function of normalized arc-length in [0,1]
 * (feature-6 hook: variable-width strokes). Output rings are ordered largest-|area| first (via
 * boolean.ts's `ringArea`), each a plain closed PathData polygon (no in/out handles — flattened).
 *
 * OPEN path: the ribbon (left offset + end cap + right offset reversed + start cap) is one
 * (possibly self-crossing, e.g. a tight hairpin fold) ring, pushed through `pc.union` as a
 * single-ring Polygon. polygon-clipping's README documents: "rings may be self-touching and/or
 * self-crossing. Self-crossing rings will be interpreted using the non-zero rule" — so an
 * overlapping fold is resolved into its de-duplicated covered area rather than throwing or
 * double-counting, which is exactly the self-union this needs.
 *
 * CLOSED path: the stroke of a closed centerline is an annulus — a ring with a hole. The two
 * offset rails (offsetClosedRing at side=+1/-1) are each closed polygons; the ink is the area of
 * the "outer" rail MINUS the area of the "inner" rail. Per polygon-clipping's README, a Polygon
 * is `[outerRing, ...holeRings]` and "winding order of rings does not matter" for input — hole
 * membership is decided by ARRAY POSITION, not by which rail is geometrically wider. So which
 * rail is outer isn't assumed by construction (side=+1 isn't always "outward" — it depends on
 * the centerline's winding); instead the rail with the larger |ringArea| is placed first
 * (outer), the other second (hole): `pc.union([bigger, smaller])`. This also self-normalizes
 * self-crossing rails (a width larger than the loop's local geometry) via the same non-zero
 * rule, and the *output* is documented as "outer rings ... counter-clockwise, and inner rings
 * clockwise" — i.e. opposite-signed `ringArea`, which is exactly test 4's assertion.
 */
export function outlineStroke(
  path: PathData,
  width: StrokeWidth,
  cap: StrokeCap = 'butt',
  join: StrokeJoin = 'bevel',
): PathData[] {
  const flat = flattenPath(path);
  let pts = flat.pts;
  let cum = flat.cum;
  const total = flat.total;
  if (pts.length < 2) return [];

  let polygonInput: PcPolygon;

  if (path.closed) {
    // flattenPath's closed pass re-closes back to nodes[0]; drop that duplicate for a clean ring.
    if (pts.length > 1) {
      const f = pts[0];
      const l = pts[pts.length - 1];
      if (Math.abs(f.x - l.x) < 1e-9 && Math.abs(f.y - l.y) < 1e-9) {
        pts = pts.slice(0, -1);
        cum = cum.slice(0, -1);
      }
    }
    if (pts.length < 3) return [];
    const railA = offsetClosedRing(pts, cum, total, width, 1);
    const railB = offsetClosedRing(pts, cum, total, width, -1);
    const areaA = Math.abs(ringArea(railA));
    const areaB = Math.abs(ringArea(railB));
    const outer = areaA >= areaB ? railA : railB;
    const inner = areaA >= areaB ? railB : railA;
    polygonInput = [toPcRing(outer), toPcRing(inner)];
  } else {
    const ring = outlineOpenRing(pts, cum, total, width, cap, join);
    polygonInput = [toPcRing(ring)];
  }

  const result: PcMultiPolygon = pc.union(polygonInput);
  const rings: { area: number; data: PathData }[] = [];
  for (const poly of result) {
    for (const r of poly) {
      const data = pcRingToPathData(r);
      if (data.nodes.length < 3) continue;
      rings.push({ area: Math.abs(ringArea(data.nodes.map((n) => n.anchor))), data });
    }
  }
  rings.sort((a, b) => b.area - a.area);
  return rings.map((r) => r.data);
}
