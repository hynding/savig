import { describe, it, expect } from 'vitest';
import { decomposeRegions } from './regions';
import { pc, ringArea } from './boolean';
import type { PathData } from '../types';

// A closed axis-aligned square ring (GeoJSON-style: first==last), as a polygon-clipping
// PcPolygon (single outer ring, no holes) at world coords (x0,y0)..(x0+s,y0+s).
function squarePoly(x0: number, y0: number, s: number): [number, number][][] {
  return [
    [
      [x0, y0],
      [x0 + s, y0],
      [x0 + s, y0 + s],
      [x0, y0 + s],
      [x0, y0],
    ],
  ];
}

function ringSetArea(rings: PathData[]): number {
  // Net signed area across all rings (outer + holes) — matches even-odd fill area.
  return rings.reduce((sum, r) => sum + ringArea(r.nodes.map((n) => n.anchor)), 0);
}

function contributorSets(regions: { contributors: number[] }[]): string[] {
  return regions.map((r) => r.contributors.join(',')).sort();
}

describe('decomposeRegions', () => {
  it('returns [] for zero polygons', () => {
    expect(decomposeRegions([])).toEqual([]);
  });

  it('returns the single polygon as one region for N=1', () => {
    const regions = decomposeRegions([squarePoly(0, 0, 100)]);
    expect(regions.length).toBe(1);
    expect(regions[0].contributors).toEqual([0]);
    expect(Math.abs(ringSetArea(regions[0].rings))).toBeCloseTo(10000, 6);
    expect(regions[0].bbox).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it('two overlapping squares -> 3 regions with hand-computed areas', () => {
    // Square A: (0,0)-(100,100). Square B: (50,0)-(150,100). Overlap: (50,0)-(100,100) = 50x100=5000.
    const A = squarePoly(0, 0, 100);
    const B = squarePoly(50, 0, 100);
    const regions = decomposeRegions([A, B]);
    expect(regions.length).toBe(3);
    expect(contributorSets(regions)).toEqual(['0', '0,1', '1']);

    const byKey = new Map(regions.map((r) => [r.contributors.join(','), r]));
    expect(Math.abs(ringSetArea(byKey.get('0')!.rings))).toBeCloseTo(5000, 6); // A exclusive
    expect(Math.abs(ringSetArea(byKey.get('1')!.rings))).toBeCloseTo(5000, 6); // B exclusive
    expect(Math.abs(ringSetArea(byKey.get('0,1')!.rings))).toBeCloseTo(5000, 6); // overlap

    // Ordered by descending |area| — all three are equal here, so just confirm non-increasing.
    for (let i = 1; i < regions.length; i++) {
      expect(Math.abs(ringSetArea(regions[i - 1].rings))).toBeGreaterThanOrEqual(
        Math.abs(ringSetArea(regions[i].rings)) - 1e-6,
      );
    }
  });

  it('three offset squares in a row (no triple overlap) -> 5 regions', () => {
    // A:(0,0)-(100,100) B:(70,0)-(170,100) C:(140,0)-(240,100). A/C don't overlap (gap of 40 in
    // x between A's right edge at 100 and C's left edge at 140), but each overlaps B by 30.
    const A = squarePoly(0, 0, 100);
    const B = squarePoly(70, 0, 100);
    const C = squarePoly(140, 0, 100);
    const regions = decomposeRegions([A, B, C]);
    expect(contributorSets(regions)).toEqual(['0', '0,1', '1', '1,2', '2']);
    expect(regions.length).toBe(5);

    const byKey = new Map(regions.map((r) => [r.contributors.join(','), r]));
    expect(Math.abs(ringSetArea(byKey.get('0')!.rings))).toBeCloseTo(7000, 6); // A exclusive
    expect(Math.abs(ringSetArea(byKey.get('0,1')!.rings))).toBeCloseTo(3000, 6); // A∩B
    expect(Math.abs(ringSetArea(byKey.get('1')!.rings))).toBeCloseTo(4000, 6); // B exclusive
    expect(Math.abs(ringSetArea(byKey.get('1,2')!.rings))).toBeCloseTo(3000, 6); // B∩C
    expect(Math.abs(ringSetArea(byKey.get('2')!.rings))).toBeCloseTo(7000, 6); // C exclusive
  });

  it('three squares with a common triple-overlap area -> 7 regions incl. {0,1,2}', () => {
    // A:(0,0)-(100,100) B:(60,0)-(160,100) C:(30,60)-(130,160) — a triangular arrangement where
    // every pairwise overlap has a part not covered by the third, AND all three overlap in the
    // middle (x60-100,y60-100).
    const A = squarePoly(0, 0, 100);
    const B = squarePoly(60, 0, 100);
    const C = squarePoly(30, 60, 100);
    const regions = decomposeRegions([A, B, C]);
    expect(contributorSets(regions)).toEqual(['0', '0,1', '0,1,2', '0,2', '1', '1,2', '2']);
    expect(regions.length).toBe(7);

    const byKey = new Map(regions.map((r) => [r.contributors.join(','), r]));
    expect(Math.abs(ringSetArea(byKey.get('0')!.rings))).toBeCloseTo(4800, 6);
    expect(Math.abs(ringSetArea(byKey.get('1')!.rings))).toBeCloseTo(4800, 6);
    expect(Math.abs(ringSetArea(byKey.get('2')!.rings))).toBeCloseTo(6000, 6);
    expect(Math.abs(ringSetArea(byKey.get('0,1')!.rings))).toBeCloseTo(2400, 6);
    expect(Math.abs(ringSetArea(byKey.get('0,2')!.rings))).toBeCloseTo(1200, 6);
    expect(Math.abs(ringSetArea(byKey.get('1,2')!.rings))).toBeCloseTo(1200, 6);
    expect(Math.abs(ringSetArea(byKey.get('0,1,2')!.rings))).toBeCloseTo(1600, 6);
  });

  it('disjoint N=3 -> 3 regions, each a singleton contributor', () => {
    const A = squarePoly(0, 0, 10);
    const B = squarePoly(100, 0, 10);
    const C = squarePoly(200, 0, 10);
    const regions = decomposeRegions([A, B, C]);
    expect(contributorSets(regions)).toEqual(['0', '1', '2']);
    expect(regions.length).toBe(3);
    for (const r of regions) expect(Math.abs(ringSetArea(r.rings))).toBeCloseTo(100, 6);
  });

  it('area-sum pin: sum of region areas equals the union area within 1e-6', () => {
    const A = squarePoly(0, 0, 100);
    const B = squarePoly(30, 30, 100);
    const C = squarePoly(60, 60, 100);
    const regions = decomposeRegions([A, B, C]);
    const sum = regions.reduce((s, r) => s + Math.abs(ringSetArea(r.rings)), 0);

    const unionResult = pc.union(A, B, C);
    let unionArea = 0;
    for (const poly of unionResult) for (const ring of poly) unionArea += ringArea(ring.map(([x, y]) => ({ x, y })));

    expect(sum).toBeCloseTo(Math.abs(unionArea), 6);
  });

  it('a region can be a compound shape with holes (net area nets outer minus holes)', () => {
    // A big square with two small squares fully interior and disjoint from each other. The
    // {A-only} region is A minus both -> ONE ring set: an outer boundary plus two hole rings
    // (polygon-clipping emits interior holes with opposite winding, so the signed sum nets the
    // subtraction automatically). {A,B}-only = B (fully contained, doesn't touch C). Likewise {A,C}.
    const A = squarePoly(0, 0, 100);
    const B = squarePoly(20, 20, 20); // interior, area 400
    const C = squarePoly(60, 60, 20); // interior, area 400, disjoint from B
    const regions = decomposeRegions([A, B, C]);
    expect(contributorSets(regions)).toEqual(['0', '0,1', '0,2']);

    const byKey = new Map(regions.map((r) => [r.contributors.join(','), r]));
    const aOnly = byKey.get('0')!;
    expect(aOnly.rings.length).toBe(3); // outer + 2 holes
    expect(ringSetArea(aOnly.rings)).toBeCloseTo(9200, 6); // 10000 - 400 - 400, net signed
    expect(Math.abs(ringSetArea(byKey.get('0,1')!.rings))).toBeCloseTo(400, 6);
    expect(Math.abs(ringSetArea(byKey.get('0,2')!.rings))).toBeCloseTo(400, 6);
  });

  it('bbox is the union bounds of a region\'s rings', () => {
    const A = squarePoly(0, 0, 100);
    const B = squarePoly(50, 0, 100);
    const regions = decomposeRegions([A, B]);
    const overlap = regions.find((r) => r.contributors.join(',') === '0,1')!;
    expect(overlap.bbox).toEqual({ x: 50, y: 0, width: 50, height: 100 });
  });
});
