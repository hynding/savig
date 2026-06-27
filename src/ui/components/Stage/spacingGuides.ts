// Equal-spacing ("distribution") guides for a move drag (slice spacing-guides). Pure. Detects when
// the moving object's bbox can be (near) equally spaced along an axis — either centred between its
// immediate flanking neighbors, OR its gap to a neighbor matched to an existing gap elsewhere in the
// same row/column — and returns the small delta to land it exactly + the dimension segments to draw.
// Edge-snap takes priority per axis; the caller fills an axis only when no edge guide claimed it.
import type { AABB } from './snapping';

export interface SpacingGuide {
  /** Dimension-line endpoints (content coords). */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** The gap value (content px) shown as the label. */
  gap: number;
  orientation: 'h' | 'v';
}

export interface SpacingSnapResult {
  /** Shift to equalize the horizontal gaps (0 if not applicable / out of threshold). */
  dx: number;
  /** Shift to equalize the vertical gaps. */
  dy: number;
  guides: SpacingGuide[];
}

interface AxisCandidate {
  delta: number;
  guides: SpacingGuide[];
}

const overlapsV = (a: AABB, b: AABB): boolean => a.minY < b.maxY && a.maxY > b.minY;
const overlapsH = (a: AABB, b: AABB): boolean => a.minX < b.maxX && a.maxX > b.minX;
const cyOf = (a: AABB): number => (a.minY + a.maxY) / 2;
const cxOf = (a: AABB): number => (a.minX + a.maxX) / 2;

// Generic per-axis solver. `lo/hi` read an object's low/high edge on the snap axis; `cross` reads
// the centre on the perpendicular axis (where the dimension line is drawn). `make` builds a guide
// segment from a low edge to a high edge at a cross position. The horizontal and vertical passes are
// the same algorithm with the axes swapped.
function axisSnap(
  moving: AABB,
  others: AABB[],
  threshold: number,
  overlaps: (a: AABB, b: AABB) => boolean,
  lo: (a: AABB) => number,
  hi: (a: AABB) => number,
  cross: (a: AABB) => number,
  make: (a: number, b: number, c: number, gap: number) => SpacingGuide,
): AxisCandidate | null {
  const mates = others.filter((o) => overlaps(moving, o));
  const lefts = mates.filter((o) => hi(o) <= lo(moving));
  const rights = mates.filter((o) => lo(o) >= hi(moving));
  const L = lefts.length ? lefts.reduce((best, o) => (hi(o) > hi(best) ? o : best)) : null;
  const R = rights.length ? rights.reduce((best, o) => (lo(o) < lo(best) ? o : best)) : null;
  const mc = cross(moving);

  // Existing adjacent gaps among the (mover-excluded) mates, sorted along the axis.
  const sorted = [...mates].sort((a, b) => lo(a) - lo(b));
  const existing: { gap: number; a: AABB; b: AABB }[] = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (lo(b) >= hi(a)) existing.push({ gap: lo(b) - hi(a), a, b });
  }

  const candidates: AxisCandidate[] = [];

  // (a) Centre the mover between its immediate L/R neighbors (equal gaps both sides).
  if (L && R) {
    const gapL = lo(moving) - hi(L);
    const gapR = lo(R) - hi(moving);
    const delta = (gapR - gapL) / 2;
    if (Math.abs(delta) <= threshold) {
      const gap = (gapL + gapR) / 2;
      candidates.push({
        delta,
        guides: [make(hi(L), lo(moving) + delta, mc, gap), make(hi(moving) + delta, lo(R), mc, gap)],
      });
    }
  }

  // (b) Match the mover's LEFT gap to an existing gap elsewhere.
  if (L) {
    const gapL = lo(moving) - hi(L);
    for (const e of existing) {
      const delta = e.gap - gapL; // shift so the L→mover gap becomes e.gap
      if (Math.abs(delta) <= threshold) {
        candidates.push({
          delta,
          guides: [make(hi(L), lo(moving) + delta, mc, e.gap), make(hi(e.a), lo(e.b), (cross(e.a) + cross(e.b)) / 2, e.gap)],
        });
      }
    }
  }

  // (c) Match the mover's RIGHT gap to an existing gap elsewhere.
  if (R) {
    const gapR = lo(R) - hi(moving);
    for (const e of existing) {
      const delta = gapR - e.gap; // shift so the mover→R gap becomes e.gap
      if (Math.abs(delta) <= threshold) {
        candidates.push({
          delta,
          guides: [make(hi(moving) + delta, lo(R), mc, e.gap), make(hi(e.a), lo(e.b), (cross(e.a) + cross(e.b)) / 2, e.gap)],
        });
      }
    }
  }

  if (!candidates.length) return null;
  candidates.sort((p, q) => Math.abs(p.delta) - Math.abs(q.delta)); // smallest shift wins
  return candidates[0];
}

export function computeSpacingSnap(moving: AABB, others: AABB[], threshold: number): SpacingSnapResult {
  const h = axisSnap(
    moving,
    others,
    threshold,
    overlapsV,
    (a) => a.minX,
    (a) => a.maxX,
    cyOf,
    (x1, x2, y, gap) => ({ x1, y1: y, x2, y2: y, gap, orientation: 'h' }),
  );
  const v = axisSnap(
    moving,
    others,
    threshold,
    overlapsH,
    (a) => a.minY,
    (a) => a.maxY,
    cxOf,
    (y1, y2, x, gap) => ({ x1: x, y1, x2: x, y2, gap, orientation: 'v' }),
  );
  return {
    dx: h ? h.delta : 0,
    dy: v ? v.delta : 0,
    guides: [...(h ? h.guides : []), ...(v ? v.guides : [])],
  };
}
