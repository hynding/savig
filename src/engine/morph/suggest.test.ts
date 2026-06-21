import { describe, it, expect } from 'vitest';
import {
  suggestCorrespondence,
  identityCorrespondence,
  shiftCorrespondence,
  reverseCorrespondence,
} from './suggest';
import type { PathData } from '../types';

const corner = (x: number, y: number) => ({ anchor: { x, y } });
// Square, closed, 4 nodes.
const sq = (pts: [number, number][]): PathData => ({
  nodes: pts.map(([x, y]) => corner(x, y)),
  closed: true,
});
const A = sq([
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
]);
// B is A rotated by +1 (cut point shifted): node 0 of A sits at index 3 of B.
const Brot = sq([
  [10, 0],
  [10, 10],
  [0, 10],
  [0, 0],
]);

describe('suggestCorrespondence', () => {
  it('recovers the cut-point rotation (closed, equal counts)', () => {
    // A[0]=(0,0) lives at B index 3 -> c[0]=3, then +1 each (mod 4).
    expect(suggestCorrespondence(A, Brot)).toEqual([3, 0, 1, 2]);
  });

  it('identity on an exact copy (offset 0, forward winding tie-break)', () => {
    expect(suggestCorrespondence(A, A)).toEqual([0, 1, 2, 3]);
  });

  it('recovers reversed winding', () => {
    // B is A traversed in reverse order, but keeps (0,0) at index 0. The zero-cost
    // alignment is reversed winding with a0->b0 held: a1=(10,0)->b3, a2=(10,10)->b2,
    // a3=(0,10)->b1, i.e. c = [0,3,2,1] (each pair coincident).
    const Brev = sq([
      [0, 0],
      [0, 10],
      [10, 10],
      [10, 0],
    ]);
    const c = suggestCorrespondence(A, Brev);
    expect(c).toEqual([0, 3, 2, 1]);
    // Verify it is genuinely zero-cost (each A node maps onto its coincident B node).
    c.forEach((j, i) => expect(Brev.nodes[j].anchor).toEqual(A.nodes[i].anchor));
  });

  it('open paths never cyclically shift (offset 0; winding only)', () => {
    const oa: PathData = { nodes: [corner(0, 0), corner(10, 0), corner(20, 0)], closed: false };
    const ob: PathData = { nodes: [corner(0, 0), corner(10, 0), corner(20, 0)], closed: false };
    expect(suggestCorrespondence(oa, ob)).toEqual([0, 1, 2]);
  });

  it('unequal counts -> clamped identity', () => {
    const a2: PathData = { nodes: [corner(0, 0), corner(10, 0)], closed: false };
    const b4: PathData = {
      nodes: [corner(0, 0), corner(5, 0), corner(10, 0), corner(15, 0)],
      closed: false,
    };
    expect(suggestCorrespondence(a2, b4)).toEqual([0, 1]);
    const b1: PathData = { nodes: [corner(0, 0)], closed: false };
    expect(suggestCorrespondence(a2, b1)).toEqual([0, 0]); // min(i, n-1)
  });

  it('does not mutate inputs', () => {
    const before = JSON.stringify(A);
    suggestCorrespondence(A, Brot);
    expect(JSON.stringify(A)).toBe(before);
  });
});

describe('map helpers', () => {
  it('identityCorrespondence clamps to b range', () => {
    expect(identityCorrespondence(3, 5)).toEqual([0, 1, 2]);
    expect(identityCorrespondence(4, 2)).toEqual([0, 1, 1, 1]);
  });

  it('shiftCorrespondence rotates targets modulo n', () => {
    expect(shiftCorrespondence([0, 1, 2, 3], 4, 1)).toEqual([1, 2, 3, 0]);
    expect(shiftCorrespondence([0, 1, 2, 3], 4, -1)).toEqual([3, 0, 1, 2]);
  });

  it('reverseCorrespondence flips winding', () => {
    expect(reverseCorrespondence([0, 1, 2, 3], 4)).toEqual([3, 2, 1, 0]);
  });
});
