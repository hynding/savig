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
