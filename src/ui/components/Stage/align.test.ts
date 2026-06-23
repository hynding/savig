import { describe, it, expect } from 'vitest';
import { computeAlign, computeDistribute, type AlignItem } from './align';

const box = (id: string, minX: number, minY: number, w: number, h: number, x = minX, y = minY): AlignItem => ({
  id,
  x,
  y,
  aabb: { minX, minY, maxX: minX + w, maxY: minY + h },
});

describe('computeAlign', () => {
  it('left aligns every AABB minX to the group minX (zero deltas filtered)', () => {
    const items = [box('a', 0, 0, 10, 10), box('b', 40, 5, 20, 10)];
    expect(computeAlign(items, 'left')).toEqual([{ id: 'b', x: 0 }]); // a already leftmost; b.x 40 + (0-40)
  });

  it('right aligns every AABB maxX to the group maxX', () => {
    const items = [box('a', 0, 0, 10, 10), box('b', 40, 0, 20, 10)];
    // group maxX 60. a maxX 10 -> dx 50; b maxX 60 -> 0 (filtered).
    expect(computeAlign(items, 'right')).toEqual([{ id: 'a', x: 50 }]);
  });

  it('hcenter aligns every AABB center X to the group center X', () => {
    const items = [box('a', 0, 0, 10, 10), box('b', 40, 0, 20, 10)];
    // group [0,60] center 30. a center 5 -> dx 25; b center 50 -> dx -20.
    expect(computeAlign(items, 'hcenter')).toEqual([{ id: 'a', x: 25 }, { id: 'b', x: 20 }]);
  });

  it('bottom aligns every AABB maxY to the group maxY', () => {
    const items = [box('a', 0, 0, 10, 10), box('b', 0, 0, 10, 30)];
    expect(computeAlign(items, 'bottom')).toEqual([{ id: 'a', y: 20 }]); // a maxY 10 -> dy 20; b 30 -> 0
  });

  it('vcenter aligns every AABB center Y to the group center Y', () => {
    const items = [box('a', 0, 0, 10, 10), box('b', 0, 40, 10, 20)];
    // group [0,60] center 30. a center 5 -> dy 25; b center 50 -> dy -20.
    expect(computeAlign(items, 'vcenter')).toEqual([{ id: 'a', y: 25 }, { id: 'b', y: 20 }]);
  });

  it('is a no-op for fewer than 2 items', () => {
    expect(computeAlign([box('a', 0, 0, 10, 10)], 'left')).toEqual([]);
  });
});

describe('computeDistribute', () => {
  it('equalizes horizontal gaps with the extremes fixed', () => {
    // widths 10,10,10 across [0,100]: free = 100 - 30 = 70, gap = 35.
    const items = [box('a', 0, 0, 10, 10), box('b', 30, 0, 10, 10), box('c', 90, 0, 10, 10)];
    // a fixed; b -> minX 0+10+35 = 45 (dx 15); c -> 45+10+35 = 90 (dx 0, filtered).
    expect(computeDistribute(items, 'h')).toEqual([{ id: 'b', x: 45 }]);
  });

  it('distributes by SORTED order regardless of input order', () => {
    const items = [box('c', 90, 0, 10, 10), box('a', 0, 0, 10, 10), box('b', 30, 0, 10, 10)];
    expect(computeDistribute(items, 'h')).toEqual([{ id: 'b', x: 45 }]);
  });

  it('equalizes vertical gaps', () => {
    const items = [box('a', 0, 0, 10, 10), box('b', 0, 30, 10, 10), box('c', 0, 90, 10, 10)];
    expect(computeDistribute(items, 'v')).toEqual([{ id: 'b', y: 45 }]);
  });

  it('is a no-op for fewer than 3 items', () => {
    expect(computeDistribute([box('a', 0, 0, 10, 10), box('b', 40, 0, 10, 10)], 'h')).toEqual([]);
  });
});
