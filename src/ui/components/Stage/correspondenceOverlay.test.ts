import { describe, it, expect } from 'vitest';
import { isOrderPreserving, unreferencedTargets, linkSegments } from './correspondenceOverlay';
import type { PathData } from '../../../engine';

const corner = (x: number, y: number) => ({ anchor: { x, y } });
const from: PathData = { nodes: [corner(0, 0), corner(10, 0), corner(5, 9)], closed: true };
const to: PathData = { nodes: [corner(0, 1), corner(10, 1), corner(5, 8)], closed: true };

describe('correspondenceOverlay helpers', () => {
  it('isOrderPreserving accepts rotations (closed)', () => {
    expect(isOrderPreserving([0, 1, 2], 3, true)).toBe(true);
    expect(isOrderPreserving([1, 2, 0], 3, true)).toBe(true); // cyclic shift
    expect(isOrderPreserving([2, 0, 1], 3, true)).toBe(true);
  });

  it('isOrderPreserving rejects a crossing (closed)', () => {
    // n=3 has no crossings (S_3 == the triangle's full dihedral group); need n>=4.
    // [0,2,1,3] is neither a rotation of [0,1,2,3] nor of its reverse -> genuine crossing.
    expect(isOrderPreserving([0, 2, 1, 3], 4, true)).toBe(false);
    // sanity: a pure reflection at n=4 IS order-preserving.
    expect(isOrderPreserving([0, 3, 2, 1], 4, true)).toBe(true);
  });

  it('isOrderPreserving open requires non-decreasing', () => {
    expect(isOrderPreserving([0, 1, 2], 3, false)).toBe(true);
    expect(isOrderPreserving([0, 0, 1], 3, false)).toBe(true); // merge, still monotone
    expect(isOrderPreserving([1, 0, 2], 3, false)).toBe(false);
  });

  it('unreferencedTargets lists B nodes with no source', () => {
    expect(unreferencedTargets([0, 1], 3)).toEqual([2]);
    expect(unreferencedTargets([0, 1, 2], 3)).toEqual([]);
  });

  it('linkSegments maps anchor coordinates', () => {
    const segs = linkSegments(from, to, [1, 2, 0]);
    expect(segs).toHaveLength(3);
    expect(segs[0]).toMatchObject({ ai: 0, bi: 1, ax: 0, ay: 0, bx: 10, by: 1 });
  });
});
