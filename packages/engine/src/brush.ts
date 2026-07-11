import type { PathData, PathNode, PathPoint } from './types';
import { simplify } from './geom/simplify';

export interface BrushParams {
  /** RDP epsilon (px). */
  tolerance: number;
  /** Catmull-Rom handle scale (0 = corner polyline, 0.5 = default, 1 = strong). */
  smoothing: number;
}

// Map the 0..1 `brushSmoothing` UI control to concrete pipeline params. Monotonic:
// higher smoothing => larger RDP tolerance (fewer points) and longer CR handles.
export function brushParams(smoothing: number): BrushParams {
  const s = Math.min(1, Math.max(0, smoothing));
  return { tolerance: 1 + s * 7, smoothing: s };
}

const DEDUPE_EPS = 0.01;

function dedupe(points: PathPoint[]): PathPoint[] {
  const out: PathPoint[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > DEDUPE_EPS) out.push(p);
  }
  return out;
}

// Build an open, smooth vector stroke from raw drag samples (stage-space). The
// single source of stroke geometry: the same PathData previews, commits, and exports.
export function strokeToPath(points: PathPoint[], opts: BrushParams): PathData {
  const pts = simplify(dedupe(points), opts.tolerance);
  if (pts.length < 2) return { nodes: [], closed: false };
  if (pts.length === 2) {
    return { nodes: [{ anchor: pts[0] }, { anchor: pts[1] }], closed: false };
  }
  // Catmull-Rom tangent at P[i] is (P[i+1] - P[i-1]) / 6 for the cubic-bezier
  // conversion; scale by k so default smoothing (0.5) reproduces standard CR.
  const k = opts.smoothing * 2;
  const nodes: PathNode[] = pts.map((p, i) => {
    const node: PathNode = { anchor: { x: p.x, y: p.y } };
    if (k > 0) {
      const prev = pts[i - 1] ?? p; // one-sided tangent at the ends
      const next = pts[i + 1] ?? p;
      const tx = ((next.x - prev.x) / 6) * k;
      const ty = ((next.y - prev.y) / 6) * k;
      node.out = { x: tx, y: ty };
      node.in = { x: 0 - tx, y: 0 - ty };
    }
    return node;
  });
  return { nodes, closed: false };
}

export interface BrushWidthOpts {
  /** Base stroke width (px). */
  size: number;
  /** Fraction of stroke length [0, 0.5] over which width ramps 0->1 from the start; 0 = no taper. */
  taperIn: number;
  /** Fraction of stroke length [0, 0.5] over which width ramps 1->0 into the end; 0 = no taper. */
  taperOut: number;
  /** Optional pressure lookup, normalized-t -> pressure [0,1]; absent = no pressure influence (1x). */
  pressureAtT?: (t: number) => number;
}

/** Width floor: outlineStroke's rails need non-zero width, and taper endpoints visually
 *  converge here rather than at exactly 0. */
const WIDTH_FLOOR = 0.1;
const PRESSURE_SCALE_MIN = 0.1;
const PRESSURE_SCALE_MAX = 2;

// Linear 0->1 over [0, taperIn]; identically 1 when taperIn is 0 (no taper).
function rampIn(t: number, taperIn: number): number {
  if (taperIn <= 0) return 1;
  if (t <= 0) return 0;
  if (t >= taperIn) return 1;
  return t / taperIn;
}

// Linear 1->0 over [1-taperOut, 1]; identically 1 when taperOut is 0 (no taper).
function rampOut(t: number, taperOut: number): number {
  if (taperOut <= 0) return 1;
  const start = 1 - taperOut;
  if (t <= start) return 1;
  if (t >= 1) return 0;
  return (1 - t) / taperOut;
}

// Build the stroke's width-along-t function for outlineStroke's variable-width hook:
// width(t) = max(FLOOR, size * rampIn(t) * rampOut(t) * pressureScale(t)). rampIn/rampOut
// multiply (not just take the min) so overlapping taper windows produce a smooth bump profile
// rather than a plateau. pressureScale maps a Pointer Events pressure sample (mouse constant
// 0.5, pen 0..1) to a symmetric-around-1x multiplier, clamped to [0.1, 2].
export function buildBrushWidthFn(opts: BrushWidthOpts): (t: number) => number {
  const { size, taperIn, taperOut, pressureAtT } = opts;
  return (t: number): number => {
    const pressureScale = pressureAtT
      ? Math.min(PRESSURE_SCALE_MAX, Math.max(PRESSURE_SCALE_MIN, 2 * pressureAtT(t)))
      : 1;
    const width = size * rampIn(t, taperIn) * rampOut(t, taperOut) * pressureScale;
    return Math.max(WIDTH_FLOOR, width);
  };
}

// Build a piecewise-linear pressure lookup over the RAW captured polyline's own cumulative arc
// length (index-aligned with `pressures`), independent of what simplify/dedupe later drop from
// the smoothed path. Stations are placed at each raw point's normalized arc-length position;
// a query t is clamped to the end stations, or linearly interpolated between the two bracketing
// ones. A degenerate (zero-length) polyline falls back to even spacing by index so the lookup
// still returns a usable, non-throwing function.
export function pressureLookup(
  points: PathPoint[],
  pressures: number[],
): (t: number) => number {
  if (points.length === 0) return () => 0.5;
  if (points.length === 1) {
    const p = pressures[0] ?? 0.5;
    return () => p;
  }

  const cum: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    cum.push(cum[i - 1] + Math.hypot(cur.x - prev.x, cur.y - prev.y));
  }
  const total = cum[cum.length - 1];
  const stations = total > 0
    ? cum.map((c) => c / total)
    : points.map((_, i) => i / (points.length - 1));
  const vals = points.map((_, i) => pressures[i] ?? 0.5);

  return (t: number): number => {
    if (t <= stations[0]) return vals[0];
    const last = stations.length - 1;
    if (t >= stations[last]) return vals[last];
    for (let i = 1; i <= last; i++) {
      if (t <= stations[i]) {
        const t0 = stations[i - 1];
        const t1 = stations[i];
        const v0 = vals[i - 1];
        const v1 = vals[i];
        const frac = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
        return v0 + (v1 - v0) * frac;
      }
    }
    return vals[last];
  };
}
