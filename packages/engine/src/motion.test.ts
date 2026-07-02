import { describe, it, expect } from 'vitest';
import { pointAtFraction, tangentAngleDeg } from './motion';
import type { PathData } from './types';

const horiz: PathData = { nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }], closed: false };
const vert: PathData = { nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 0, y: 100 } }], closed: false };

describe('pointAtFraction', () => {
  it('maps frac 0 / 0.5 / 1 to start / middle / end by arc length', () => {
    expect(pointAtFraction(horiz, 0)).toEqual({ x: 0, y: 0 });
    expect(pointAtFraction(horiz, 0.5)).toEqual({ x: 50, y: 0 });
    expect(pointAtFraction(horiz, 1)).toEqual({ x: 100, y: 0 });
  });
  it('clamps frac outside [0,1]', () => {
    expect(pointAtFraction(horiz, -2)).toEqual({ x: 0, y: 0 });
    expect(pointAtFraction(horiz, 9)).toEqual({ x: 100, y: 0 });
  });
  it('guards empty / zero-length paths', () => {
    expect(pointAtFraction({ nodes: [], closed: false }, 0.5)).toEqual({ x: 0, y: 0 });
    const dot: PathData = { nodes: [{ anchor: { x: 5, y: 5 } }, { anchor: { x: 5, y: 5 } }], closed: false };
    expect(pointAtFraction(dot, 0.5)).toEqual({ x: 5, y: 5 });
  });
  it('does not mutate the input', () => {
    const before = JSON.stringify(horiz);
    pointAtFraction(horiz, 0.5);
    expect(JSON.stringify(horiz)).toBe(before);
  });
});

describe('tangentAngleDeg', () => {
  it('is 0 along +x and 90 along +y', () => {
    expect(tangentAngleDeg(horiz, 0.5)).toBeCloseTo(0, 6);
    expect(tangentAngleDeg(vert, 0.5)).toBeCloseTo(90, 6);
  });
  it('uses a one-sided difference at the endpoints (still 0 on a straight path)', () => {
    expect(tangentAngleDeg(horiz, 0)).toBeCloseTo(0, 6);
    expect(tangentAngleDeg(horiz, 1)).toBeCloseTo(0, 6);
  });
  it('degenerate path -> 0', () => {
    expect(tangentAngleDeg({ nodes: [], closed: false }, 0.5)).toBe(0);
  });
});
