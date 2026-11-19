import { describe, expect, it } from 'vitest';
import { computeSnap, guideSnapTargets } from './snapping';
import { computeSpacingSnap } from './spacingGuides';
import { snapScalePoint } from './scaleSnap';

describe('guideSnapTargets', () => {
  const targets = guideSnapTargets([{ axis: 'x', pos: 100 }, { axis: 'y', pos: 50 }]);

  it('snaps an edge to a vertical guide on x only', () => {
    const r = computeSnap({ minX: 97, maxX: 140, minY: 0, maxY: 20 }, guideSnapTargets([{ axis: 'x', pos: 100 }]), 6);
    expect(r).toEqual({ dx: 3, dy: 0, guideX: 100, guideY: null });
  });

  it('snaps a centre to a horizontal guide', () => {
    const r = computeSnap({ minX: 0, maxX: 10, minY: 38, maxY: 58 }, targets, 6);
    expect(r.dy).toBe(2);
    expect(r.guideY).toBe(50);
  });

  it('never claims the other axis or equal spacing', () => {
    const r = computeSnap({ minX: 300, maxX: 310, minY: 300, maxY: 310 }, targets, 6);
    expect(r).toEqual({ dx: 0, dy: 0, guideX: null, guideY: null });
    const sp = computeSpacingSnap({ minX: 0, maxX: 10, minY: 0, maxY: 10 }, targets, 6);
    expect(sp.guides).toEqual([]);
  });

  it('works for scale-handle point snapping', () => {
    const p = snapScalePoint({ x: 98, y: 52 }, true, true, targets, 6);
    expect(p.x).toBe(100);
    expect(p.y).toBe(50);
  });
});
