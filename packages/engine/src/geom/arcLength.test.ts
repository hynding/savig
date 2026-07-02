import { describe, it, expect } from 'vitest';
import { flattenPath, pointAtLength } from './arcLength';
import type { PathData } from '../types';

const line: PathData = { nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }], closed: false };
const square: PathData = {
  nodes: [
    { anchor: { x: 0, y: 0 } },
    { anchor: { x: 10, y: 0 } },
    { anchor: { x: 10, y: 10 } },
    { anchor: { x: 0, y: 10 } },
  ],
  closed: true,
};

describe('flattenPath', () => {
  it('reports total arc length and a monotone cumulative array', () => {
    const f = flattenPath(line);
    expect(f.total).toBeCloseTo(10, 9);
    expect(f.cum[0]).toBe(0);
    expect(f.cum[f.cum.length - 1]).toBeCloseTo(10, 9);
    expect(f.pts[0]).toEqual({ x: 0, y: 0 });
  });
  it('includes the closing segment for a closed path', () => {
    const f = flattenPath(square);
    expect(f.total).toBeCloseTo(40, 9); // perimeter incl. close
  });
  it('empty path -> zero-length flatten', () => {
    const f = flattenPath({ nodes: [], closed: false });
    expect(f.pts).toEqual([]);
    expect(f.total).toBe(0);
  });
});

describe('pointAtLength', () => {
  it('clamps below 0 and above total', () => {
    const f = flattenPath(line);
    expect(pointAtLength(f, -5)).toEqual({ x: 0, y: 0 });
    expect(pointAtLength(f, 999)).toEqual({ x: 10, y: 0 });
  });
  it('interpolates within a segment by arc length', () => {
    const f = flattenPath(line);
    expect(pointAtLength(f, 2.5)).toEqual({ x: 2.5, y: 0 });
  });
});
