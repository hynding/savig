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

const lerp = (p: number, q: number, t: number) => p + (q - p) * t;
const at = (an: { anchor: { x: number; y: number } }[], bn: typeof an, t: number) =>
  an.map((n, i) => ({
    x: lerp(n.anchor.x, bn[i].anchor.x, t),
    y: lerp(n.anchor.y, bn[i].anchor.y, t),
  }));

describe('reconcile explicit map (walk-B)', () => {
  // Two equal-count closed triangles; B is A rotated by +1 in node order.
  const triA: PathData = { nodes: [corner(0, 0), corner(10, 0), corner(5, 10)], closed: true };
  const triB: PathData = { nodes: [corner(5, 10), corner(0, 0), corner(10, 0)], closed: true };

  it('identity map equals index-pad (byte-identical) for equal counts', () => {
    const mapped = reconcile(triA, triB, 'corresponded', [0, 1, 2]);
    const plain = reconcile(triA, triB, 'corresponded');
    expect(mapped).toEqual(plain);
  });

  it('rotation map makes a rotated-copy morph stationary (discriminates from index-pad)', () => {
    // triB IS triA in rotated node order; map [1,2,0] pairs each A node with the B node
    // sharing its coordinate, so every pair is coincident and the morph never moves.
    const map = [1, 2, 0]; // a0->b1, a1->b2, a2->b0
    const { an, bn } = reconcile(triA, triB, 'corresponded', map);
    // Every matched pair is coincident -> zero motion at every t (no roll).
    expect(an.map((n) => n.anchor)).toEqual(bn.map((n) => n.anchor));
    expect(at(an, bn, 0.5)).toEqual(bn.map((n) => n.anchor));
    // bn traces B exactly (ring order); the vertex SET equals A's (closed shape preserved).
    expect(bn.map((n) => n.anchor)).toEqual(triB.nodes.map((n) => n.anchor));
    // Discriminates: index-pad pairs by index, so its pairs are NOT coincident (it moves).
    const plain = reconcile(triA, triB, 'corresponded');
    expect(plain.an.map((n) => n.anchor)).not.toEqual(plain.bn.map((n) => n.anchor));
  });

  it('unreferenced B node in the MIDDLE grows from a point (middle-insert fix)', () => {
    // A 2 nodes, B 3 nodes, map a0->b0, a1->b2; b1 (the middle) is unreferenced.
    const a2: PathData = { nodes: [corner(0, 0), corner(10, 0)], closed: false };
    const b3: PathData = { nodes: [corner(0, 0), corner(5, 9), corner(10, 0)], closed: false };
    const { an, bn } = reconcile(a2, b3, 'corresponded', [0, 2]);
    expect(an).toHaveLength(3);
    expect(bn).toHaveLength(3);
    // bn is B in ring order; the middle b1 grows from the most-recently-emitted A anchor (a0 @ 0,0).
    expect(bn.map((n) => n.anchor)).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 9 },
      { x: 10, y: 0 },
    ]);
    expect(an[1].anchor).toEqual({ x: 0, y: 0 }); // degenerate spur at a0, NOT index-pad's a-last
    expect(an[2].anchor).toEqual({ x: 10, y: 0 }); // a1
    // Discriminates: index-pad would put a1 at index 1 and the spur at index 2.
    const plain = reconcile(a2, b3, 'corresponded');
    expect(plain.an[1].anchor).toEqual({ x: 10, y: 0 });
  });

  it('adjacent merge: two A nodes onto one B node (discriminates from index-pad)', () => {
    // A 3 nodes, B 2 nodes, map a0->b0, a1->b0, a2->b1. b0 is fed twice (merge).
    const a3: PathData = { nodes: [corner(0, 0), corner(4, 0), corner(10, 0)], closed: false };
    const b2: PathData = { nodes: [corner(0, 5), corner(10, 5)], closed: false };
    const { an, bn } = reconcile(a3, b2, 'corresponded', [0, 0, 1]);
    expect(an).toHaveLength(3);
    expect(bn).toHaveLength(3);
    // walk-B: bn = [b0, b0, b1]; index-pad would be [b0, b1, degenerate].
    expect(bn.map((n) => n.anchor)).toEqual([
      { x: 0, y: 5 },
      { x: 0, y: 5 },
      { x: 10, y: 5 },
    ]);
    const plain = reconcile(a3, b2, 'corresponded');
    expect(plain.bn.map((n) => n.anchor)).not.toEqual(bn.map((n) => n.anchor));
  });

  it('invalid map (wrong length) falls back to index-pad', () => {
    expect(reconcile(triA, triB, 'corresponded', [0, 1])).toEqual(
      reconcile(triA, triB, 'corresponded'),
    );
  });

  it('invalid map (entry out of range) falls back to index-pad', () => {
    expect(reconcile(triA, triB, 'corresponded', [0, 1, 9])).toEqual(
      reconcile(triA, triB, 'corresponded'),
    );
  });
});
