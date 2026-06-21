import { it, expect } from 'vitest';
import { hitTestAnchor, hitTestHandle, hitTestSegment, nearFirstAnchor } from './pathHitTest';
import type { PathData } from '../../../engine';

const p: PathData = {
  nodes: [
    { anchor: { x: 0, y: 0 }, out: { x: 4, y: 0 } },
    { anchor: { x: 10, y: 0 }, in: { x: -4, y: 0 } },
  ],
  closed: false,
};

it('hits an anchor within tolerance', () => {
  expect(hitTestAnchor(p, { x: 0.5, y: 0.5 }, 2)).toBe(0);
  expect(hitTestAnchor(p, { x: 5, y: 5 }, 2)).toBeNull();
});

it('returns the nearest anchor when two are within tolerance', () => {
  const dense: PathData = {
    nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 3, y: 0 } }],
    closed: false,
  };
  // (2.5,0) is within tol=3 of both anchors but closer to index 1.
  expect(hitTestAnchor(dense, { x: 2.5, y: 0 }, 3)).toBe(1);
});

it('hits a handle (anchor + offset) within tolerance', () => {
  expect(hitTestHandle(p, { x: 4, y: 0 }, 2)).toEqual({ index: 0, side: 'out' });
  expect(hitTestHandle(p, { x: 6, y: 0 }, 2)).toEqual({ index: 1, side: 'in' });
});

it('hits a segment near its chord and reports t', () => {
  const hit = hitTestSegment(p, { x: 5, y: 0.2 }, 1)!;
  expect(hit.segmentIndex).toBe(0);
  expect(hit.t).toBeCloseTo(0.5, 2);
});

it('detects nearness to the first anchor', () => {
  expect(nearFirstAnchor(p, { x: 0.5, y: 0 }, 2)).toBe(true);
  expect(nearFirstAnchor(p, { x: 9, y: 0 }, 2)).toBe(false);
});
