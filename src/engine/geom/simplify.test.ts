import { describe, it, expect } from 'vitest';
import { simplify } from './simplify';

describe('simplify (RDP)', () => {
  it('drops a collinear midpoint', () => {
    const pts = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }];
    expect(simplify(pts, 1)).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
  });

  it('keeps a point that deviates beyond epsilon', () => {
    const pts = [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }];
    expect(simplify(pts, 1)).toEqual(pts);
  });

  it('always preserves the endpoints', () => {
    const pts = [{ x: 0, y: 0 }, { x: 1, y: 0.1 }, { x: 2, y: 0 }];
    const out = simplify(pts, 1);
    expect(out[0]).toEqual({ x: 0, y: 0 });
    expect(out[out.length - 1]).toEqual({ x: 2, y: 0 });
  });

  it('larger epsilon yields no more points than a smaller one', () => {
    const pts = [
      { x: 0, y: 0 }, { x: 1, y: 0.4 }, { x: 2, y: -0.3 }, { x: 3, y: 0.6 },
      { x: 4, y: 0.1 }, { x: 5, y: 0 },
    ];
    expect(simplify(pts, 2).length).toBeLessThanOrEqual(simplify(pts, 0.2).length);
  });

  it('returns a copy unchanged for <= 2 points or epsilon <= 0', () => {
    const two = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    expect(simplify(two, 5)).toEqual(two);
    const many = [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }];
    expect(simplify(many, 0)).toEqual(many);
    expect(simplify(many, 0)).not.toBe(many); // copy, not the same array
  });
});
