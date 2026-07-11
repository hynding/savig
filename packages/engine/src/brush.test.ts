import { describe, it, expect } from 'vitest';
import { brushParams, strokeToPath, buildBrushWidthFn, pressureLookup } from './brush';

describe('brushParams', () => {
  it('clamps to [0,1] and is monotonic in tolerance', () => {
    expect(brushParams(-1).tolerance).toBe(brushParams(0).tolerance);
    expect(brushParams(2).tolerance).toBe(brushParams(1).tolerance);
    expect(brushParams(1).tolerance).toBeGreaterThan(brushParams(0).tolerance);
    expect(brushParams(0).tolerance).toBeGreaterThan(0); // always some cleanup
  });
});

describe('strokeToPath', () => {
  const line = (n: number) => Array.from({ length: n }, (_, i) => ({ x: i, y: 0 }));

  it('returns an empty open path for fewer than 2 distinct points', () => {
    expect(strokeToPath([], brushParams(0.5))).toEqual({ nodes: [], closed: false });
    expect(strokeToPath([{ x: 1, y: 1 }, { x: 1, y: 1 }], brushParams(0.5)))
      .toEqual({ nodes: [], closed: false });
  });

  it('collapses a straight drag to a 2-node corner path', () => {
    const path = strokeToPath(line(10), brushParams(0.5));
    expect(path.closed).toBe(false);
    expect(path.nodes).toHaveLength(2);
    expect(path.nodes[0].in).toBeUndefined();
    expect(path.nodes[0].out).toBeUndefined();
  });

  it('produces smooth nodes (in == -out) on a curved stroke at default smoothing', () => {
    const pts = [
      { x: 0, y: 0 }, { x: 10, y: 20 }, { x: 20, y: 0 }, { x: 30, y: 20 }, { x: 40, y: 0 },
    ];
    const path = strokeToPath(pts, brushParams(0.5));
    expect(path.closed).toBe(false);
    expect(path.nodes.length).toBeGreaterThanOrEqual(3);
    const mid = path.nodes[1];
    expect(mid.in).toBeDefined();
    expect(mid.out).toBeDefined();
    expect(mid.in!.x).toBeCloseTo(0 - mid.out!.x);
    expect(mid.in!.y).toBeCloseTo(0 - mid.out!.y);
  });

  it('emits corner nodes (no handles) when smoothing is 0', () => {
    const pts = [
      { x: 0, y: 0 }, { x: 10, y: 20 }, { x: 20, y: 0 }, { x: 30, y: 20 }, { x: 40, y: 0 },
    ];
    const path = strokeToPath(pts, brushParams(0));
    for (const n of path.nodes) {
      expect(n.in).toBeUndefined();
      expect(n.out).toBeUndefined();
    }
  });

  it('is deterministic', () => {
    const pts = [{ x: 0, y: 0 }, { x: 5, y: 9 }, { x: 12, y: 3 }, { x: 20, y: 14 }];
    expect(strokeToPath(pts, brushParams(0.6))).toEqual(strokeToPath(pts, brushParams(0.6)));
  });
});

describe('buildBrushWidthFn', () => {
  it('ramps in linearly over [0, taperIn], clamped to a 0.1 floor at t=0', () => {
    const width = buildBrushWidthFn({ size: 10, taperIn: 0.2, taperOut: 0 });
    expect(width(0)).toBeCloseTo(0.1);
    expect(width(0.1)).toBeCloseTo(5);
    expect(width(0.2)).toBeCloseTo(10);
    expect(width(0.6)).toBeCloseTo(10);
  });

  it('is full width everywhere when taperIn is 0', () => {
    const width = buildBrushWidthFn({ size: 10, taperIn: 0, taperOut: 0 });
    expect(width(0)).toBeCloseTo(10);
    expect(width(0.5)).toBeCloseTo(10);
    expect(width(1)).toBeCloseTo(10);
  });

  it('ramps out linearly over [1-taperOut, 1], symmetric to taperIn, clamped at t=1', () => {
    const width = buildBrushWidthFn({ size: 10, taperIn: 0, taperOut: 0.2 });
    expect(width(0.8)).toBeCloseTo(10);
    expect(width(0.9)).toBeCloseTo(5);
    expect(width(1)).toBeCloseTo(0.1);
  });

  it('multiplies overlapping in/out ramps (bump profile), pinned at the t=0.5 midpoint', () => {
    const width = buildBrushWidthFn({ size: 10, taperIn: 0.8, taperOut: 0.8 });
    // rampIn(.5) = .5/.8 = .625; rampOut(.5) = (1-.5)/.8 = .625; 10 * .625 * .625 = 3.90625
    expect(width(0.5)).toBeCloseTo(3.90625);
    expect(width(0)).toBeCloseTo(0.1);
    expect(width(1)).toBeCloseTo(0.1);
  });

  it('applies pressureScale = clamp(2*pressureAtT(t), 0.1, 2) when a lookup is supplied', () => {
    const width = buildBrushWidthFn({ size: 10, taperIn: 0, taperOut: 0, pressureAtT: () => 0.5 });
    // constant 0.5 pressure (mouse) -> pressureScale 1x -> no change
    expect(width(0)).toBeCloseTo(10);
    expect(width(0.5)).toBeCloseTo(10);
    expect(width(1)).toBeCloseTo(10);
  });

  it('clamps pressureScale to its [0.1, 2] band', () => {
    const low = buildBrushWidthFn({ size: 10, taperIn: 0, taperOut: 0, pressureAtT: () => 0 });
    expect(low(0.5)).toBeCloseTo(1); // 10 * clamp(0, 0.1, 2) = 10 * 0.1
    const high = buildBrushWidthFn({ size: 10, taperIn: 0, taperOut: 0, pressureAtT: () => 2 });
    expect(high(0.5)).toBeCloseTo(20); // 10 * clamp(4, 0.1, 2) = 10 * 2
  });

  it('never returns below the 0.1 floor even when every factor is tiny', () => {
    const width = buildBrushWidthFn({ size: 1, taperIn: 0.5, taperOut: 0, pressureAtT: () => 0 });
    expect(width(0)).toBeGreaterThanOrEqual(0.1);
    expect(width(0)).toBeCloseTo(0.1);
  });
});

describe('pressureLookup', () => {
  it('returns a constant 0.5 for an empty polyline', () => {
    const p = pressureLookup([], []);
    expect(p(0)).toBe(0.5);
    expect(p(0.5)).toBe(0.5);
    expect(p(1)).toBe(0.5);
  });

  it('returns a constant fn for a single sample', () => {
    const p = pressureLookup([{ x: 3, y: 4 }], [0.7]);
    expect(p(0)).toBe(0.7);
    expect(p(0.5)).toBe(0.7);
    expect(p(1)).toBe(0.7);
  });

  it('resamples piecewise-linear over the raw polyline cumulative arc length', () => {
    // segment lengths: (0,0)->(3,0) = 3; (3,0)->(3,4) = 4; total = 7
    // station t's: 0, 3/7, 1
    const points = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }];
    const pressures = [0.2, 0.8, 0.4];
    const p = pressureLookup(points, pressures);
    const midT = 3 / 7;
    expect(p(0)).toBeCloseTo(0.2);
    expect(p(midT)).toBeCloseTo(0.8);
    expect(p(1)).toBeCloseTo(0.4);
    // halfway between station 0 and station 1 (by t, not index): interpolate linearly
    const quarterT = midT / 2;
    expect(p(quarterT)).toBeCloseTo(0.2 + (0.8 - 0.2) * 0.5);
    // halfway between station 1 and station 2
    const threeQuarterT = midT + (1 - midT) / 2;
    expect(p(threeQuarterT)).toBeCloseTo(0.8 + (0.4 - 0.8) * 0.5);
  });

  it('clamps to the end stations outside [0,1]', () => {
    const points = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
    const pressures = [0.3, 0.9];
    const p = pressureLookup(points, pressures);
    expect(p(-1)).toBeCloseTo(0.3);
    expect(p(2)).toBeCloseTo(0.9);
  });

  it('treats missing pressures as 0.5 when arrays are mismatched (defensive)', () => {
    const points = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }];
    const pressures = [0.3]; // missing entries for indices 1, 2
    const p = pressureLookup(points, pressures);
    expect(p(0)).toBeCloseTo(0.3);
    expect(p(1)).toBeCloseTo(0.5);
  });

  it('composes with buildBrushWidthFn to drive pressureScale from real samples', () => {
    const points = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }];
    const pressures = [0.2, 0.8, 0.4];
    const p = pressureLookup(points, pressures);
    const width = buildBrushWidthFn({ size: 10, taperIn: 0, taperOut: 0, pressureAtT: p });
    // t=0: pressure 0.2 -> scale clamp(0.4, .1, 2) = 0.4 -> width 4
    expect(width(0)).toBeCloseTo(4);
    // t=1: pressure 0.4 -> scale clamp(0.8, .1, 2) = 0.8 -> width 8
    expect(width(1)).toBeCloseTo(8);
  });

  it('degenerate polyline (all coincident points) still returns a usable, non-throwing fn', () => {
    const points = [{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }];
    const pressures = [0.1, 0.6, 0.9];
    const p = pressureLookup(points, pressures);
    expect(() => p(0.5)).not.toThrow();
    expect(p(0)).toBeCloseTo(0.1);
    expect(p(1)).toBeCloseTo(0.9);
  });
});
