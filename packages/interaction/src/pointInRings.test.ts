import { describe, it, expect } from 'vitest';
import { pointInRings } from './pointInRings';
import type { PathData } from '@savig/engine';

// Axis-aligned square ring, corner nodes only, no closing duplicate (matches decomposeRegions
// output convention).
function square(x0: number, y0: number, s: number): PathData {
  return {
    closed: true,
    nodes: [
      { anchor: { x: x0, y: y0 } },
      { anchor: { x: x0 + s, y: y0 } },
      { anchor: { x: x0 + s, y: y0 + s } },
      { anchor: { x: x0, y: y0 + s } },
    ],
  };
}

describe('pointInRings', () => {
  it('a plain square: inside true, outside false', () => {
    const rings = [square(0, 0, 100)];
    expect(pointInRings(rings, { x: 50, y: 50 })).toBe(true);
    expect(pointInRings(rings, { x: 150, y: 150 })).toBe(false);
    expect(pointInRings(rings, { x: -10, y: 50 })).toBe(false);
  });

  it('square with a square hole: inside ring true, inside hole false, outside false', () => {
    const outer = square(0, 0, 100);
    const hole = square(25, 25, 50); // (25,25)-(75,75); winding doesn't matter for even-odd
    const rings = [outer, hole];
    expect(pointInRings(rings, { x: 10, y: 10 })).toBe(true); // inside outer, outside hole
    expect(pointInRings(rings, { x: 50, y: 50 })).toBe(false); // inside the hole
    expect(pointInRings(rings, { x: 150, y: 150 })).toBe(false); // outside everything
  });

  it('boundary (half-open rule): left/bottom edges are inside, right/top edges are outside', () => {
    const rings = [square(0, 0, 100)];
    expect(pointInRings(rings, { x: 0, y: 50 })).toBe(true); // left edge
    expect(pointInRings(rings, { x: 50, y: 0 })).toBe(true); // bottom edge
    expect(pointInRings(rings, { x: 100, y: 50 })).toBe(false); // right edge
    expect(pointInRings(rings, { x: 50, y: 100 })).toBe(false); // top edge
    expect(pointInRings(rings, { x: 0, y: 0 })).toBe(true); // bottom-left corner
    expect(pointInRings(rings, { x: 100, y: 100 })).toBe(false); // top-right corner
  });
});
