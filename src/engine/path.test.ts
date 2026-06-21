import { describe, it, expect } from 'vitest';
import { pathToD, pathBounds } from './path';
import type { PathData } from './types';

describe('pathToD', () => {
  it('serializes a straight open path (corners) as M/L', () => {
    const p: PathData = {
      nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }],
      closed: false,
    };
    expect(pathToD(p)).toBe('M 0 0 L 10 0');
  });

  it('closes a path with Z', () => {
    const p: PathData = {
      nodes: [
        { anchor: { x: 0, y: 0 } },
        { anchor: { x: 10, y: 0 } },
        { anchor: { x: 10, y: 10 } },
      ],
      closed: true,
    };
    expect(pathToD(p)).toBe('M 0 0 L 10 0 L 10 10 Z');
  });

  it('emits a cubic C using out of the previous node and in of the current node', () => {
    const p: PathData = {
      nodes: [
        { anchor: { x: 0, y: 0 }, out: { x: 5, y: 0 } },
        { anchor: { x: 10, y: 10 }, in: { x: 0, y: -5 } },
      ],
      closed: false,
    };
    // c1 = prev.anchor + prev.out = (5,0); c2 = cur.anchor + cur.in = (10,5)
    expect(pathToD(p)).toBe('M 0 0 C 5 0 10 5 10 10');
  });

  it('emits a closing cubic segment back to the first node when closed', () => {
    const p: PathData = {
      nodes: [
        { anchor: { x: 0, y: 0 }, in: { x: -2, y: 0 }, out: { x: 2, y: 0 } },
        { anchor: { x: 10, y: 0 }, in: { x: -2, y: 0 }, out: { x: 2, y: 0 } },
      ],
      closed: true,
    };
    // segment 0->1: C (2 0) (8 0) (10 0); closing 1->0: C (12 0) (-2 0) (0 0) Z
    expect(pathToD(p)).toBe('M 0 0 C 2 0 8 0 10 0 C 12 0 -2 0 0 0 Z');
  });

  it('returns empty string for an empty path', () => {
    expect(pathToD({ nodes: [], closed: false })).toBe('');
  });
});

describe('pathBounds', () => {
  it('returns the anchor-point bounding box including a non-zero min', () => {
    const p: PathData = {
      nodes: [{ anchor: { x: 4, y: 6 } }, { anchor: { x: 14, y: 26 } }],
      closed: false,
    };
    expect(pathBounds(p)).toEqual({ x: 4, y: 6, width: 10, height: 20 });
  });

  it('returns a zero box for an empty path', () => {
    expect(pathBounds({ nodes: [], closed: false })).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});
