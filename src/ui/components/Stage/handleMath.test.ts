import { describe, it, expect } from 'vitest';
import { projectOntoLine } from './handleMath';

describe('projectOntoLine', () => {
  it('projects a point orthogonally onto the line', () => {
    const p = projectOntoLine({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 });
    expect(p.x).toBeCloseTo(0.5);
    expect(p.y).toBeCloseTo(0.5);
  });
  it('returns a point already on the line unchanged', () => {
    const p = projectOntoLine({ x: 3, y: 3 }, { x: 0, y: 0 }, { x: 1, y: 1 });
    expect(p.x).toBeCloseTo(3);
    expect(p.y).toBeCloseTo(3);
  });
  it('returns `a` for a degenerate line (a === b)', () => {
    const p = projectOntoLine({ x: 5, y: 9 }, { x: 2, y: 2 }, { x: 2, y: 2 });
    expect(p).toEqual({ x: 2, y: 2 });
  });
});
