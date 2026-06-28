import { describe, it, expect } from 'vitest';
import { pickRingTarget } from './pickRingTarget';
import type { PathData } from '../../../engine';

const tri = (off: number): PathData => ({
  closed: true,
  nodes: [
    { anchor: { x: off, y: off } },
    { anchor: { x: off + 10, y: off } },
    { anchor: { x: off + 10, y: off + 10 } },
  ],
});

describe('pickRingTarget', () => {
  const rings = [tri(0), tri(100)];

  it('picks an anchor on the primary ring', () => {
    expect(pickRingTarget(rings, { x: 0, y: 0 }, 3)).toEqual({ ring: 0, kind: 'anchor', index: 0 });
  });

  it('picks an anchor on a compound ring', () => {
    expect(pickRingTarget(rings, { x: 110, y: 100 }, 3)).toMatchObject({ ring: 1, kind: 'anchor', index: 1 });
  });

  it('returns null when nothing is within tolerance', () => {
    expect(pickRingTarget(rings, { x: 500, y: 500 }, 3)).toBeNull();
  });

  it('lower ring wins when two rings have a hit of the same kind at the same point', () => {
    const t = pickRingTarget([tri(0), tri(0)], { x: 0, y: 0 }, 3); // identical rings, anchor at (0,0)
    expect(t).toMatchObject({ ring: 0, kind: 'anchor', index: 0 });
  });

  it('a handle hit beats an anchor hit on the same ring', () => {
    // a node with an out-handle; clicking the handle tip should report kind:'handle'.
    const withHandle: PathData = {
      closed: true,
      nodes: [
        { anchor: { x: 0, y: 0 }, out: { x: 5, y: 0 } },
        { anchor: { x: 20, y: 0 } },
        { anchor: { x: 20, y: 20 } },
      ],
    };
    const t = pickRingTarget([withHandle], { x: 5, y: 0 }, 2);
    expect(t).toMatchObject({ ring: 0, kind: 'handle', index: 0, side: 'out' });
  });
});
