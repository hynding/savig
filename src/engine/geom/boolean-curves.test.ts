import { describe, it, expect } from 'vitest';
import {
  evalCubic,
  reverseCubic,
  splitCubicRange,
  projectToCubic,
  isStraightCubic,
  type Cubic,
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
