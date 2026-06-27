import { describe, it, expect } from 'vitest';
import { snapScalePoint, snapScaleAlongSegment } from './scaleSnap';
import type { AABB } from './snapping';

const box = (minX: number, minY: number, maxX: number, maxY: number): AABB => ({ minX, minY, maxX, maxY });

describe('snapScalePoint (free per-axis)', () => {
  const targets = [box(100, 0, 200, 50)]; // x-lines 100/150/200, y-lines 0/25/50

  it('snaps x to a near vertical line when within threshold (both axes dragged)', () => {
    const r = snapScalePoint({ x: 98, y: 10 }, true, true, targets, 6);
    expect(r.x).toBe(100); // snapped to minX=100
    expect(r.guideX).toBe(100);
  });

  it('does NOT move an axis that is not being dragged', () => {
    const r = snapScalePoint({ x: 98, y: 2 }, true, false, targets, 6); // syAxis off
    expect(r.x).toBe(100);
    expect(r.y).toBe(2); // y untouched
    expect(r.guideY).toBeNull();
  });

  it('leaves the point unchanged when no line is within threshold', () => {
    const r = snapScalePoint({ x: 130, y: 80 }, true, true, targets, 6);
    expect(r).toEqual({ x: 130, y: 80, guideX: null, guideY: null });
  });
});

describe('snapScaleAlongSegment (uniform/from-center constraint)', () => {
  const targets = [box(100, 100, 200, 200)];

  it('slides the point ALONG the segment so its x lands on a vertical line', () => {
    // segment (0,0)->(120,120) (45°); a vertical line at x=100 -> point (100,100) on the segment.
    const r = snapScaleAlongSegment({ x: 96, y: 104 }, { x: 0, y: 0 }, { x: 120, y: 120 }, targets, 6);
    expect(r.x).toBeCloseTo(100, 6);
    expect(r.y).toBeCloseTo(100, 6); // stays on the 45° segment
    expect(r.guideX).toBe(100);
  });

  it('returns the projection (no guide) when no line is near', () => {
    const r = snapScaleAlongSegment({ x: 10, y: 12 }, { x: 0, y: 0 }, { x: 120, y: 120 }, targets, 6);
    // projection of (10,12) onto the 45° line = (11,11); no target near -> guides null
    expect(r.guideX).toBeNull();
    expect(r.guideY).toBeNull();
    expect(r.x).toBeCloseTo(11, 6);
    expect(r.y).toBeCloseTo(11, 6);
  });
});
