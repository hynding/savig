import { describe, it, expect } from 'vitest';
import {
  evalCubic,
  reverseCubic,
  splitCubicRange,
  projectToCubic,
  isStraightCubic,
  cubicsToRing,
  classifyVertex,
  segmentsToPathData,
  type Cubic,
  type OperandCubics,
  type OutSeg,
} from './boolean-curves';

const near = (a: { x: number; y: number }, b: { x: number; y: number }, eps = 1e-6) =>
  Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;

// A quarter-circle-ish cubic from (1,0) to (0,1) with kappa handles.
const K = 0.5522847498;
const quarter: Cubic = { p0: { x: 1, y: 0 }, c1: { x: 1, y: K }, c2: { x: K, y: 1 }, p3: { x: 0, y: 1 } };
const line: Cubic = { p0: { x: 0, y: 0 }, c1: { x: 1, y: 1 }, c2: { x: 2, y: 2 }, p3: { x: 3, y: 3 } };

describe('cubic primitives', () => {
  it('evalCubic hits endpoints and midpoint', () => {
    expect(near(evalCubic(quarter, 0), { x: 1, y: 0 })).toBe(true);
    expect(near(evalCubic(quarter, 1), { x: 0, y: 1 })).toBe(true);
    const mid = evalCubic(quarter, 0.5);
    expect(mid.x).toBeGreaterThan(0.5);
    expect(mid.y).toBeGreaterThan(0.5);
  });

  it('reverseCubic swaps endpoints and handles', () => {
    const r = reverseCubic(quarter);
    expect(near(r.p0, quarter.p3)).toBe(true);
    expect(near(r.p3, quarter.p0)).toBe(true);
    expect(near(r.c1, quarter.c2)).toBe(true);
    expect(near(r.c2, quarter.c1)).toBe(true);
  });

  it('splitCubicRange [0,1] is identity geometry', () => {
    const s = splitCubicRange(quarter, 0, 1);
    expect(near(evalCubic(s, 0), { x: 1, y: 0 })).toBe(true);
    expect(near(evalCubic(s, 1), { x: 0, y: 1 })).toBe(true);
    expect(near(evalCubic(s, 0.5), evalCubic(quarter, 0.5))).toBe(true);
  });

  it('splitCubicRange sub-range matches the parent curve', () => {
    const s = splitCubicRange(quarter, 0.25, 0.75);
    expect(near(evalCubic(s, 0), evalCubic(quarter, 0.25))).toBe(true);
    expect(near(evalCubic(s, 1), evalCubic(quarter, 0.75))).toBe(true);
    expect(near(evalCubic(s, 0.5), evalCubic(quarter, 0.5))).toBe(true);
  });

  it('splitCubicRange reversed range yields a reversed sub-cubic', () => {
    const s = splitCubicRange(quarter, 0.75, 0.25);
    expect(near(evalCubic(s, 0), evalCubic(quarter, 0.75))).toBe(true);
    expect(near(evalCubic(s, 1), evalCubic(quarter, 0.25))).toBe(true);
    // interior geometry is preserved after reversal, not just endpoints
    expect(near(evalCubic(s, 0.5), evalCubic(quarter, 0.5))).toBe(true);
  });

  it('projectToCubic recovers the parameter of an on-curve point', () => {
    const target = evalCubic(quarter, 0.4);
    const { t, dist } = projectToCubic(quarter, target);
    expect(dist).toBeLessThan(1e-4);
    expect(Math.abs(t - 0.4)).toBeLessThan(1e-2);
  });

  it('projectToCubic reports a large distance for an off-curve point', () => {
    const { dist } = projectToCubic(quarter, { x: 5, y: 5 });
    expect(dist).toBeGreaterThan(1);
  });

  it('isStraightCubic detects collinear control points', () => {
    expect(isStraightCubic(line)).toBe(true);
    expect(isStraightCubic(quarter)).toBe(false);
  });

  it('isStraightCubic treats a degenerate zero-length cubic as straight', () => {
    const z: Cubic = { p0: { x: 2, y: 2 }, c1: { x: 2, y: 2 }, c2: { x: 2, y: 2 }, p3: { x: 2, y: 2 } };
    expect(isStraightCubic(z)).toBe(true);
  });
});

describe('cubicsToRing', () => {
  it('produces a closed ring with the expected vertex count', () => {
    const c1: Cubic = { p0: { x: 0, y: 0 }, c1: { x: 0, y: 0 }, c2: { x: 10, y: 0 }, p3: { x: 10, y: 0 } };
    const c2: Cubic = { p0: { x: 10, y: 0 }, c1: { x: 10, y: 0 }, c2: { x: 0, y: 0 }, p3: { x: 0, y: 0 } };
    const ring = cubicsToRing([c1, c2], 4);
    // 2 cubics * 4 steps = 8 sampled points, plus closing duplicate.
    expect(ring.length).toBe(9);
    expect(ring[0]).toEqual(ring[ring.length - 1]); // closed
    expect(ring[0]).toEqual([0, 0]);
  });

  it('returns [] for empty input', () => {
    expect(cubicsToRing([])).toEqual([]);
  });
});

describe('classifyVertex', () => {
  const seg: Cubic = { p0: { x: 0, y: 0 }, c1: { x: 0, y: 0 }, c2: { x: 10, y: 0 }, p3: { x: 10, y: 0 } };
  const operands: OperandCubics[] = [{ opIdx: 0, segs: [seg] }];

  it('returns provenance for an on-curve point', () => {
    const pr = classifyVertex(operands, { x: 5, y: 0 }, 0.01);
    expect(pr).not.toBeNull();
    expect(pr!.opIdx).toBe(0);
    expect(pr!.segIdx).toBe(0);
    expect(Math.abs(pr!.t - 0.5)).toBeLessThan(0.02);
  });

  it('returns null for an off-curve (intersection) point', () => {
    expect(classifyVertex(operands, { x: 5, y: 5 }, 0.01)).toBeNull();
  });

  it('picks the nearest operand when BOTH are within tolerance', () => {
    const segB: Cubic = { p0: { x: 0, y: 1 }, c1: { x: 0, y: 1 }, c2: { x: 10, y: 1 }, p3: { x: 10, y: 1 } };
    const two: OperandCubics[] = [{ opIdx: 0, segs: [seg] }, { opIdx: 5, segs: [segB] }];
    // y=0.6: dist 0.6 to seg(y=0), 0.4 to segB(y=1); tol 1.0 admits both → nearest (segB) wins.
    const pr = classifyVertex(two, { x: 5, y: 0.6 }, 1.0);
    expect(pr!.opIdx).toBe(5);
  });
});

describe('segmentsToPathData', () => {
  it('all-line loop -> corner nodes, no handles', () => {
    const segs: OutSeg[] = [
      { kind: 'line', a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
      { kind: 'line', a: { x: 10, y: 0 }, b: { x: 10, y: 10 } },
      { kind: 'line', a: { x: 10, y: 10 }, b: { x: 0, y: 0 } },
    ];
    const pd = segmentsToPathData(segs);
    expect(pd.closed).toBe(true);
    expect(pd.nodes).toHaveLength(3);
    expect(pd.nodes.every((n) => !n.in && !n.out)).toBe(true);
    expect(pd.nodes[0].anchor).toEqual({ x: 0, y: 0 });
  });

  it('cubic segment contributes out to start node and in to end node', () => {
    const c: Cubic = { p0: { x: 0, y: 0 }, c1: { x: 0, y: 5 }, c2: { x: 5, y: 10 }, p3: { x: 10, y: 10 } };
    const segs: OutSeg[] = [
      { kind: 'cubic', c },
      { kind: 'line', a: { x: 10, y: 10 }, b: { x: 0, y: 0 } },
    ];
    const pd = segmentsToPathData(segs);
    expect(pd.nodes).toHaveLength(2);
    // start node at (0,0): out = c1 - p0 = (0,5)
    expect(pd.nodes[0].out).toEqual({ x: 0, y: 5 });
    expect(pd.nodes[0].in).toBeUndefined();
    // end node at (10,10): in = c2 - p3 = (-5,0)
    expect(pd.nodes[1].in).toEqual({ x: -5, y: 0 });
    expect(pd.nodes[1].out).toBeUndefined();
  });

  it('a straight cubic contributes no handles (treated like a line)', () => {
    const straight: Cubic = { p0: { x: 0, y: 0 }, c1: { x: 0, y: 0 }, c2: { x: 10, y: 0 }, p3: { x: 10, y: 0 } };
    const segs: OutSeg[] = [
      { kind: 'cubic', c: straight },
      { kind: 'line', a: { x: 10, y: 0 }, b: { x: 0, y: 0 } },
    ];
    const pd = segmentsToPathData(segs);
    expect(pd.nodes.every((n) => !n.in && !n.out)).toBe(true);
  });
});
