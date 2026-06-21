import { describe, it, expect } from 'vitest';
import { resample, SAMPLE_COUNT } from './resample';
import type { PathData } from '../types';

const line: PathData = { nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 9, y: 0 } }], closed: false };
const square: PathData = {
  nodes: [
    { anchor: { x: 0, y: 0 } },
    { anchor: { x: 10, y: 0 } },
    { anchor: { x: 10, y: 10 } },
    { anchor: { x: 0, y: 10 } },
  ],
  closed: true,
};

describe('resample', () => {
  it('returns SAMPLE_COUNT corner nodes by default', () => {
    const out = resample(square);
    expect(out).toHaveLength(SAMPLE_COUNT);
    expect(out[0].in).toBeUndefined();
    expect(out[0].out).toBeUndefined();
  });

  it('samples an open path evenly by arc length, endpoints exact', () => {
    const out = resample(line, 4); // fractions 0, 1/3, 2/3, 1 of length 9
    expect(out.map((nd) => nd.anchor.x)).toEqual([0, 3, 6, 9]);
    expect(out[0].anchor.y).toBe(0);
  });

  it('samples a closed path at i/N (no duplicate close point)', () => {
    const out = resample(square, 4); // perimeter 40, fractions 0,1/4,1/2,3/4 -> lengths 0,10,20,30
    expect(out.map((nd) => [nd.anchor.x, nd.anchor.y])).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
  });

  it('guards a zero-length / coincident path (no divide-by-zero)', () => {
    const dot: PathData = { nodes: [{ anchor: { x: 5, y: 5 } }, { anchor: { x: 5, y: 5 } }], closed: false };
    const out = resample(dot, 3);
    expect(out).toEqual([
      { anchor: { x: 5, y: 5 } },
      { anchor: { x: 5, y: 5 } },
      { anchor: { x: 5, y: 5 } },
    ]);
  });

  it('n=1 on an open path samples the start point (no NaN from 0/0)', () => {
    const out = resample(line, 1);
    expect(out).toEqual([{ anchor: { x: 0, y: 0 } }]);
  });

  it('does not mutate the input path', () => {
    const before = JSON.stringify(square);
    resample(square);
    expect(JSON.stringify(square)).toBe(before);
  });
});
