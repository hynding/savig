// Shape hints (spec 2026-11-14-shape-hints-design.md): Flash's manual correspondence points for a
// shape tween. Hint i pins a point on the START outline (`a`) to a point on the END outline (`b`):
// the morph carries a's spot to b's spot. Both outlines are cut at their hints and each matching
// pair of stretches is resampled with the same number of points, so a corresponded morph can't
// twist or slide past the hints.

import { flattenPath, pointAtLength, type Flattened } from '../geom/arcLength';
import type { PathData, PathNode, PathPoint, ShapeHint } from '../types';

/** Total points in a hinted pair (spread over the stretches by length). */
export const HINT_SAMPLES = 96;

/** Arc length along `flat` of the point closest to `p`, and its distance. */
export function closestArcLength(flat: Flattened, p: PathPoint): { s: number; d: number } {
  const { pts, cum } = flat;
  let best = { s: 0, d: Infinity };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    const d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    if (d < best.d) best = { s: cum[i - 1] + t * (cum[i] - cum[i - 1]), d };
  }
  if (pts.length === 1) best = { s: 0, d: Math.hypot(p.x - pts[0].x, p.y - pts[0].y) };
  return best;
}

/** Distance from `p` to the outline of `path`. */
export function distanceToOutline(path: PathData, p: PathPoint): number {
  return closestArcLength(flattenPath(path), p).d;
}

type Cut = { sa: number; sb: number };

/** Indices of the longest run of (a, b) pairs with both strictly increasing. Inputs are in
 *  increasing-a order already. O(n²); n ≤ 26. */
function longestIncreasing(a: number[], b: number[]): number[] {
  const n = a.length;
  const len = new Array<number>(n).fill(1);
  const prev = new Array<number>(n).fill(-1);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      if (a[j] + 1e-9 < a[i] && b[j] + 1e-9 < b[i] && len[j] + 1 > len[i]) {
        len[i] = len[j] + 1;
        prev[i] = j;
      }
    }
  }
  let best = 0;
  for (let i = 1; i < n; i++) if (len[i] > len[best]) best = i;
  const out: number[] = [];
  for (let i = best; i >= 0; i = prev[i]) out.unshift(i);
  return out;
}

/** The largest set of hints whose order agrees on both outlines (a hint that would make the
 *  morph cross itself is dropped), as arc-length pairs sorted along A. Open outline: longest
 *  increasing run of B positions. Closed outline: the same measured cyclically, trying each hint
 *  as the starting point and keeping the largest set. */
function consistentCuts(fa: Flattened, fb: Flattened, hints: ShapeHint[], closed: boolean): Cut[] {
  const cuts = hints
    .map((h) => ({ sa: closestArcLength(fa, h.a).s, sb: closestArcLength(fb, h.b).s }))
    .sort((x, y) => x.sa - y.sa);
  if (cuts.length === 0) return [];
  if (!closed) return longestIncreasing(cuts.map((c) => c.sa), cuts.map((c) => c.sb)).map((i) => cuts[i]);
  const mod = (v: number, m: number) => ((v % m) + m) % m;
  let best: Cut[] = [];
  for (let r = 0; r < cuts.length; r++) {
    // Rotate so cut r comes first; it is forced into the run by giving it (-1, -1).
    const rot = [...cuts.slice(r), ...cuts.slice(0, r)];
    const a = rot.map((c, i) => (i === 0 ? -1 : mod(c.sa - rot[0].sa, fa.total)));
    const b = rot.map((c, i) => (i === 0 ? -1 : mod(c.sb - rot[0].sb, fb.total)));
    const run = longestIncreasing(a, b);
    if (run[0] === 0 && run.length > best.length) best = run.map((i) => rot[i]);
  }
  return best.sort((x, y) => x.sa - y.sa);
}

/** The start and end outlines resampled so their hints line up (equal node counts, straight
 *  segments), or null when hints can't apply (no hints, one outline open and the other closed,
 *  an empty outline). */
export function hintedPair(a: PathData, b: PathData, hints: ShapeHint[], total = HINT_SAMPLES): { a: PathData; b: PathData } | null {
  if (hints.length === 0 || a.closed !== b.closed) return null;
  const fa = flattenPath(a);
  const fb = flattenPath(b);
  if (!(fa.total > 0) || !(fb.total > 0)) return null;
  const closed = a.closed;
  const cuts = consistentCuts(fa, fb, hints, closed);
  if (cuts.length === 0) return null;
  // Stretches between consecutive cuts: closed = cyclic; open = also from the start / to the end.
  const stops = closed ? cuts : [{ sa: 0, sb: 0 }, ...cuts, { sa: fa.total, sb: fb.total }];
  const spans: Array<{ sa: number; la: number; sb: number; lb: number }> = [];
  const count = closed ? stops.length : stops.length - 1;
  for (let i = 0; i < count; i++) {
    const s = stops[i];
    const e = stops[(i + 1) % stops.length];
    const la = closed ? (((e.sa - s.sa) % fa.total) + fa.total) % fa.total || fa.total : e.sa - s.sa;
    const lb = closed ? (((e.sb - s.sb) % fb.total) + fb.total) % fb.total || fb.total : e.sb - s.sb;
    spans.push({ sa: s.sa, la, sb: s.sb, lb });
  }
  const weights = spans.map((sp) => Math.max(sp.la / fa.total, sp.lb / fb.total));
  const wsum = weights.reduce((x, y) => x + y, 0);
  const budget = closed ? total : total - 1;
  const counts = weights.map((w) => Math.max(1, Math.round((w / wsum) * budget)));
  const at = (flat: Flattened, s: number) => pointAtLength(flat, closed ? ((s % flat.total) + flat.total) % flat.total : s);
  const an: PathNode[] = [];
  const bn: PathNode[] = [];
  spans.forEach((sp, i) => {
    for (let j = 0; j < counts[i]; j++) {
      const f = j / counts[i];
      an.push({ anchor: at(fa, sp.sa + f * sp.la) });
      bn.push({ anchor: at(fb, sp.sb + f * sp.lb) });
    }
  });
  if (!closed) {
    an.push({ anchor: at(fa, fa.total) });
    bn.push({ anchor: at(fb, fb.total) });
  }
  return { a: { closed, nodes: an }, b: { closed, nodes: bn } };
}

/** Flash's limit: hints are lettered a–z. */
export const MAX_SHAPE_HINTS = 26;
