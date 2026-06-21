import { describe, it, expect } from 'vitest';
import { align } from './align';
import type { PathNode } from '../types';

const nodes = (pts: Array<[number, number]>): PathNode[] => pts.map(([x, y]) => ({ anchor: { x, y } }));

describe('align', () => {
  it('recovers a cyclic rotation of a closed shape (zero cost)', () => {
    const a = nodes([[0, 0], [10, 0], [10, 10], [0, 10]]);
    const b = nodes([[10, 10], [0, 10], [0, 0], [10, 0]]); // a rotated by +2
    expect(align(b, a, true)).toEqual(a);
  });

  it('recovers a reversed-winding closed shape', () => {
    const a = nodes([[0, 0], [10, 0], [10, 10], [0, 10]]);
    const b = nodes([[0, 0], [0, 10], [10, 10], [10, 0]]); // a reversed
    expect(align(b, a, true)).toEqual(a);
  });

  it('picks the cheaper winding for an open path', () => {
    const a = nodes([[0, 0], [5, 0], [10, 0]]);
    const b = nodes([[10, 0], [5, 0], [0, 0]]); // reversed -> matches a
    expect(align(b, a, false)).toEqual(a);
  });

  it('breaks ties toward the forward, offset-0 ordering', () => {
    const a = nodes([[0, 0], [1, 1], [2, 2], [3, 3]]);
    const b = a.map((nd) => ({ anchor: { ...nd.anchor } }));
    expect(align(b, a, true)).toEqual(a); // all offsets cost 0 -> keep forward offset 0
  });
});
