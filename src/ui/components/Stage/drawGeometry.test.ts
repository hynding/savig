import { describe, expect, it } from 'vitest';
import { rectFromDrag } from './drawGeometry';

describe('rectFromDrag', () => {
  it('builds bounds from a top-left to bottom-right drag', () => {
    expect(rectFromDrag({ x: 10, y: 20 }, { x: 110, y: 70 }, 3)).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it('normalizes a bottom-right to top-left (negative) drag', () => {
    expect(rectFromDrag({ x: 110, y: 70 }, { x: 10, y: 20 }, 3)).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it('returns null for a sub-threshold drag', () => {
    expect(rectFromDrag({ x: 10, y: 10 }, { x: 11, y: 11 }, 3)).toBeNull();
  });
});
