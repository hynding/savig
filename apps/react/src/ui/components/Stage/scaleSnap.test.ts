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

  it('snaps along the segment to a HORIZONTAL line (y-guide) when no vertical line is near', () => {
    // 45° segment; a horizontal line y=100 with its vertical edges (x 200/300/400) far from proj.x~100.
    const t2 = [box(200, 100, 400, 100)];
    const r = snapScaleAlongSegment({ x: 104, y: 96 }, { x: 0, y: 0 }, { x: 120, y: 120 }, t2, 6);
    expect(r.y).toBeCloseTo(100, 6);
    expect(r.x).toBeCloseTo(100, 6); // stays on the 45° segment
    expect(r.guideY).toBe(100);
    expect(r.guideX).toBeNull();
  });

  it('returns the projection (no guide) when no line is near', () => {
    const r = snapScaleAlongSegment({ x: 10, y: 12 }, { x: 0, y: 0 }, { x: 120, y: 120 }, targets, 6);
    // projection of (10,12) onto the 45° line = (11,11); no target near -> guides null
    expect(r.guideX).toBeNull();
    expect(r.guideY).toBeNull();
    expect(r.x).toBeCloseTo(11, 6);
    expect(r.y).toBeCloseTo(11, 6);
  });

  it('does NOT snap when reaching the line would slide the point off-axis beyond threshold', () => {
    // STEEP segment (0,0)->(10,120): a vertical line at x=6 is within the per-axis threshold of the
    // projection's x (~3), but reaching it slides ~36px along the segment -> 2D distance > 6 -> reject.
    const t2 = [box(6, -50, 6, -50)]; // vertical line x=6; y far away
    const r = snapScaleAlongSegment({ x: 3, y: 36 }, { x: 0, y: 0 }, { x: 10, y: 120 }, t2, 6);
    expect(r.guideX).toBeNull();
    expect(r.guideY).toBeNull();
  });

  it('grid: slides along the diagonal to land the corner on a grid line (gridSize)', () => {
    // 45deg segment; point (96,96) -> nearest grid line 100 -> slide to (100,100)
    const r = snapScaleAlongSegment({ x: 96, y: 96 }, { x: 0, y: 0 }, { x: 120, y: 120 }, [], 8, 50);
    expect(r.x).toBeCloseTo(100, 3);
    expect(r.y).toBeCloseTo(100, 3);
    expect(r.guideX === 100 || r.guideY === 100).toBe(true);
  });

  it('grid: no grid line within threshold leaves the projected point', () => {
    const r = snapScaleAlongSegment({ x: 75, y: 75 }, { x: 0, y: 0 }, { x: 120, y: 120 }, [], 6, 50);
    expect(r.guideX).toBeNull();
    expect(r.guideY).toBeNull();
  });
});
