import { describe, it, expect } from 'vitest';
import { reconcile } from './reconcile';
import { SAMPLE_COUNT } from './resample';
import type { PathData } from '../types';

const a: PathData = { nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 10, y: 10 } }], closed: false };
const b: PathData = { nodes: [{ anchor: { x: 0, y: 0 } }], closed: false };

describe('reconcile', () => {
  it('corresponded index-pads the shorter to the longer (byte-identical to padNodes)', () => {
    const { an, bn } = reconcile(a, b, 'corresponded');
    expect(an).toHaveLength(3);
    expect(bn).toHaveLength(3);
    // b padded with degenerate corner nodes at its last anchor (0,0)
    expect(bn).toEqual([
      { anchor: { x: 0, y: 0 } },
      { anchor: { x: 0, y: 0 } },
      { anchor: { x: 0, y: 0 } },
    ]);
    expect(an).toBe(a.nodes); // already long enough -> same reference (as old padNodes)
  });

  it('resampled returns SAMPLE_COUNT corner nodes on both sides', () => {
    const { an, bn } = reconcile(a, b, 'resampled');
    expect(an).toHaveLength(SAMPLE_COUNT);
    expect(bn).toHaveLength(SAMPLE_COUNT);
    expect(an[0].in).toBeUndefined();
    expect(bn[0].out).toBeUndefined();
  });
});

const corner = (x: number, y: number) => ({ anchor: { x, y } });
// A: 3-node open path; B: 5-node open path (counts differ).
const A: PathData = { nodes: [corner(0, 0), corner(10, 0), corner(10, 10)], closed: false };
const B: PathData = {
  nodes: [corner(0, 0), corner(5, 0), corner(10, 0), corner(10, 5), corner(10, 10)],
  closed: false,
};

describe('reconcile correspondence threading', () => {
  it('absent correspondence is byte-identical to index-pad (corresponded)', () => {
    const withParam = reconcile(A, B, 'corresponded', undefined);
    const without = reconcile(A, B, 'corresponded');
    expect(withParam).toEqual(without);
    // index-pad pads A to length 5; both arrays length 5.
    expect(withParam.an).toHaveLength(5);
    expect(withParam.bn).toHaveLength(5);
  });
});
