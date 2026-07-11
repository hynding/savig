import { describe, it, expect } from 'vitest';
import { outlineStroke, offsetPolyline } from './strokeOutline';
import { ringArea } from './boolean';
import { flattenPath } from './arcLength';
import type { PathData, PathPoint } from '../types';

function line(): PathData {
  return { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }] };
}

function square(s: number): PathData {
  return {
    closed: true,
    nodes: [
      { anchor: { x: 0, y: 0 } },
      { anchor: { x: s, y: 0 } },
      { anchor: { x: s, y: s } },
      { anchor: { x: 0, y: s } },
    ],
  };
}

function lCorner(): PathData {
  return {
    closed: false,
    nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }, { anchor: { x: 100, y: 100 } }],
  };
}

function bounds(pts: PathPoint[]): { minX: number; maxX: number; minY: number; maxY: number } {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

describe('offsetPolyline', () => {
  it('offsets a straight flattened line by half the (constant) width on each side', () => {
    const flat = flattenPath(line());
    const { left, right } = offsetPolyline(flat.pts, flat.cum, flat.total, 10);
    expect(left.length).toBe(flat.pts.length);
    for (let i = 0; i < left.length; i++) {
      expect(left[i].y - right[i].y).toBeCloseTo(10, 6); // full width apart
      expect(left[i].y).toBeCloseTo(5, 6);
      expect(right[i].y).toBeCloseTo(-5, 6);
    }
  });

  it('honors a width function of normalized arc-length', () => {
    const flat = flattenPath(line());
    const { left, right } = offsetPolyline(flat.pts, flat.cum, flat.total, (t) => 10 - 8 * t);
    const first = 0;
    const last = left.length - 1;
    expect(left[first].y - right[first].y).toBeCloseTo(10, 6);
    expect(left[last].y - right[last].y).toBeCloseTo(2, 6);
  });
});

describe('outlineStroke', () => {
  it('1. straight 2-node line, butt cap, bevel join -> one rectangle ring', () => {
    const rings = outlineStroke(line(), 10, 'butt', 'bevel');
    expect(rings.length).toBe(1);
    const pts = rings[0].nodes.map((n) => n.anchor);
    const b = bounds(pts);
    expect(b.minX).toBeCloseTo(0, 6);
    expect(b.maxX).toBeCloseTo(100, 6);
    expect(b.minY).toBeCloseTo(-5, 6);
    expect(b.maxY).toBeCloseTo(5, 6);
    expect(Math.abs(ringArea(pts))).toBeCloseTo(1000, 3);
  });

  it('2. same line, square cap -> bounds extend to [-5,105], area ~1100', () => {
    const rings = outlineStroke(line(), 10, 'square', 'bevel');
    expect(rings.length).toBe(1);
    const pts = rings[0].nodes.map((n) => n.anchor);
    const b = bounds(pts);
    expect(b.minX).toBeCloseTo(-5, 6);
    expect(b.maxX).toBeCloseTo(105, 6);
    expect(Math.abs(ringArea(pts))).toBeCloseTo(1100, 3);
  });

  it('3. same line, round cap -> x-bounds ~[-5,105], area between butt and square, extra points', () => {
    const buttRings = outlineStroke(line(), 10, 'butt', 'bevel');
    const squareRings = outlineStroke(line(), 10, 'square', 'bevel');
    const roundRings = outlineStroke(line(), 10, 'round', 'bevel');
    expect(roundRings.length).toBe(1);
    const buttPts = buttRings[0].nodes.map((n) => n.anchor);
    const squarePts = squareRings[0].nodes.map((n) => n.anchor);
    const roundPts = roundRings[0].nodes.map((n) => n.anchor);
    const b = bounds(roundPts);
    expect(b.minX).toBeCloseTo(-5, 3);
    expect(b.maxX).toBeCloseTo(105, 3);

    const buttArea = Math.abs(ringArea(buttPts));
    const squareArea = Math.abs(ringArea(squarePts));
    const roundArea = Math.abs(ringArea(roundPts));
    expect(roundArea).toBeGreaterThan(buttArea);
    expect(roundArea).toBeLessThan(squareArea);
    // area should approximate butt + two semicircle end-caps (pi * r^2 total for r=5), close to
    // but slightly under the ideal circle (polygon-chord approximation of the arc undershoots).
    expect(roundArea).toBeCloseTo(1000 + Math.PI * 25, -1);

    expect(roundPts.length).toBeGreaterThanOrEqual(buttPts.length + 6);
  });

  it('4. closed 100x100 square centerline, width 10 -> annulus rings with opposite-signed areas', () => {
    const rings = outlineStroke(square(100), 10, 'butt', 'bevel');
    expect(rings.length).toBe(2);
    const areas = rings.map((r) => ringArea(r.nodes.map((n) => n.anchor)));
    // largest-|area|-first ordering
    expect(Math.abs(areas[0])).toBeGreaterThan(Math.abs(areas[1]));
    // opposite signs (pc convention: outer CCW, hole CW)
    expect(Math.sign(areas[0])).not.toBe(Math.sign(areas[1]));

    const outerPts = rings[0].nodes.map((n) => n.anchor);
    const innerPts = rings[1].nodes.map((n) => n.anchor);
    const outerB = bounds(outerPts);
    const innerB = bounds(innerPts);
    // OUTER rail (the offset-outward side of every corner): under 'bevel' each corner is cut to
    // the chord between its two adjacent per-edge offset endpoints instead of their line
    // intersection — e.g. at vertex (0,0) the two endpoints are (-5,0) (end-offset of the edge
    // arriving from (0,100)) and (0,-5) (start-offset of the edge leaving to (100,0)). Those
    // chord endpoints themselves already sit at the same axis-aligned extremes the old true-miter
    // corner (-5,-5) did (x=-5 from one endpoint, y=-5 from the other), so the bounding box is
    // numerically UNCHANGED from the old (miter-corner) literals even though the shape is now an
    // octagon, not a square — this is a coincidence of the 90 deg corner, not a general rule.
    expect(outerB.minX).toBeCloseTo(-5, 4);
    expect(outerB.maxX).toBeCloseTo(105, 4);
    expect(outerB.minY).toBeCloseTo(-5, 4);
    expect(outerB.maxY).toBeCloseTo(105, 4);
    // INNER rail (the offset-inward/concave side of every corner): this side is NOT beveled —
    // per the outer/inner-per-vertex split (mirrors detectCorners' outer-side selection), it gets
    // the same bounded angle-bisector point offsetPolyline's open-path corners use, at distance
    // h=5 along the 45 deg bisector, i.e. inset by 5/sqrt(2) on each axis. This is a genuine
    // behavior change from the old true-miter inner corner (5,5): the old literals (5..95)
    // encoded a true line-line miter intersection, which this fix deliberately no longer computes
    // anywhere in this function (that computation is exactly the removed spike-risk source).
    const inset = 5 / Math.SQRT2;
    expect(innerB.minX).toBeCloseTo(inset, 6);
    expect(innerB.maxX).toBeCloseTo(100 - inset, 6);
    expect(innerB.minY).toBeCloseTo(inset, 6);
    expect(innerB.maxY).toBeCloseTo(100 - inset, 6);
  });

  it("4b. closed square: join 'round' vs 'bevel' differ (outer ring area/point count); 'miter' === 'bevel'", () => {
    const bevel = outlineStroke(square(100), 10, 'butt', 'bevel');
    const round = outlineStroke(square(100), 10, 'butt', 'round');
    const miter = outlineStroke(square(100), 10, 'butt', 'miter');

    expect(bevel.length).toBe(2);
    expect(round.length).toBe(2);
    expect(miter).toEqual(bevel); // miter is unimplemented for closed paths too -> falls back to bevel

    // Round only affects the OUTER (convex) side of each corner (mirrors the open-path behavior
    // where only the outer side gets arced) — so it's rings[0] (largest |area| = outer) that
    // differs; the inner hole ring (rings[1]) is join-independent (bisector construction, same
    // for both).
    const bevelOuter = bevel[0].nodes.map((n) => n.anchor);
    const roundOuter = round[0].nodes.map((n) => n.anchor);
    expect(roundOuter.length).toBeGreaterThan(bevelOuter.length);
    expect(Math.abs(ringArea(roundOuter))).toBeGreaterThan(Math.abs(ringArea(bevelOuter)));

    const bevelInner = bevel[1].nodes.map((n) => n.anchor);
    const roundInner = round[1].nodes.map((n) => n.anchor);
    expect(roundInner).toEqual(bevelInner);
  });

  it('4c. closed reflex-fold path: no outline point strays farther than maxWidth/2 + epsilon from the centerline', () => {
    // A tight, near-180 deg fold closed by the implicit third edge back to the start — this is
    // exactly the shape (open-path hairpin, test 5) that the true-miter closed-ring code used to
    // turn into an unbounded-looking spike on whichever rail was locally convex at the fold.
    const path: PathData = {
      closed: true,
      nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }, { anchor: { x: 0, y: 1 } }],
    };
    const flat = flattenPath(path);
    const centerline = flat.pts;
    const width = 20;
    const maxDist = width / 2 + 1e-6;

    const distToSegment = (p: PathPoint, a: PathPoint, b: PathPoint): number => {
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const len2 = abx * abx + aby * aby;
      const t = len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
      const cx = a.x + abx * t;
      const cy = a.y + aby * t;
      return Math.hypot(p.x - cx, p.y - cy);
    };
    const distToCenterline = (p: PathPoint): number => {
      let best = Infinity;
      const n = centerline.length;
      for (let i = 0; i < n; i++) {
        const a = centerline[i];
        const b = centerline[(i + 1) % n]; // closed: wraps back to index 0
        best = Math.min(best, distToSegment(p, a, b));
      }
      return best;
    };

    for (const join of ['bevel', 'round', 'miter'] as const) {
      const rings = outlineStroke(path, width, 'butt', join);
      expect(rings.length).toBeGreaterThan(0);
      for (const ring of rings) {
        for (const node of ring.nodes.map((n) => n.anchor)) {
          expect(distToCenterline(node)).toBeLessThanOrEqual(maxDist);
        }
      }
    }
  });

  it('5. hairpin fold self-overlap resolves via nonzero-rule union without throwing', () => {
    const path: PathData = {
      closed: false,
      nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }, { anchor: { x: 0, y: 1 } }],
    };
    const flat = flattenPath(path);
    const naiveArea = 20 * flat.total; // unfolded straight-ribbon reference (width * length)

    let rings: PathData[] = [];
    expect(() => {
      rings = outlineStroke(path, 20, 'butt', 'bevel');
    }).not.toThrow();
    expect(rings.length).toBeGreaterThan(0);

    const areas = rings.map((r) => Math.abs(ringArea(r.nodes.map((n) => n.anchor))));
    const largest = Math.max(...areas);
    expect(largest).toBeLessThan(naiveArea);
  });

  it('6. width function t -> 10-8t: ribbon ~10 wide near x=0, ~2 wide near x=100', () => {
    const rings = outlineStroke(line(), (t) => 10 - 8 * t, 'butt', 'bevel');
    expect(rings.length).toBe(1);
    const pts = rings[0].nodes.map((n) => n.anchor);
    const near0 = pts.filter((p) => p.x <= 2);
    const near100 = pts.filter((p) => p.x >= 98);
    const extent = (ps: PathPoint[]) => Math.max(...ps.map((p) => p.y)) - Math.min(...ps.map((p) => p.y));
    expect(extent(near0)).toBeCloseTo(10, 0);
    expect(extent(near100)).toBeCloseTo(2, 0);
  });

  it("7. join 'round' vs 'bevel' on an L corner: round has more points + larger area; 'miter' equals 'bevel'", () => {
    const bevel = outlineStroke(lCorner(), 10, 'butt', 'bevel');
    const round = outlineStroke(lCorner(), 10, 'butt', 'round');
    const miter = outlineStroke(lCorner(), 10, 'butt', 'miter');

    expect(bevel.length).toBe(1);
    expect(round.length).toBe(1);
    expect(miter).toEqual(bevel); // miter is unimplemented -> falls back to bevel, byte-identical

    const bevelPts = bevel[0].nodes.map((n) => n.anchor);
    const roundPts = round[0].nodes.map((n) => n.anchor);
    expect(roundPts.length).toBeGreaterThan(bevelPts.length);
    expect(Math.abs(ringArea(roundPts))).toBeGreaterThan(Math.abs(ringArea(bevelPts)));
  });
});
