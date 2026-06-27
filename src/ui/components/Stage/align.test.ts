import { describe, it, expect } from 'vitest';
import { computeAlign, computeAlignToFrame, computeDistribute, computeCenterOnFrame, computeDistributeCenters, type AlignItem } from './align';

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

describe('computeCenterOnFrame', () => {
  it('centres one item on the frame', () => {
    expect(computeCenterOnFrame([box('a', 0, 0, 10, 10)], 100, 100)).toEqual([{ id: 'a', x: 45, y: 45 }]); // centre 5,5 -> 50,50
  });
  it('shifts a multi-selection by ONE delta (relative offsets preserved)', () => {
    const out = computeCenterOnFrame([box('a', 0, 0, 10, 10), box('b', 20, 0, 10, 10)], 100, 100);
    // combined bbox x 0..30 (centre 15), y 0..10 (centre 5) -> +35, +45
    expect(out).toEqual([{ id: 'a', x: 35, y: 45 }, { id: 'b', x: 55, y: 45 }]);
  });
  it('returns [] when already centred and [] for empty', () => {
    expect(computeCenterOnFrame([box('a', 45, 45, 10, 10)], 100, 100)).toEqual([]);
    expect(computeCenterOnFrame([], 100, 100)).toEqual([]);
  });
});

describe('computeAlignToFrame (align to artboard)', () => {
  it('aligns left edges to x=0, right edges to frameW, hcenter to frameW/2', () => {
    expect(computeAlignToFrame([box('a', 10, 0, 20, 20)], 'left', 100, 100)).toEqual([{ id: 'a', x: 0 }]); // d = 0-10
    expect(computeAlignToFrame([box('a', 0, 0, 20, 20)], 'right', 100, 100)).toEqual([{ id: 'a', x: 80 }]); // d = 100-20
    expect(computeAlignToFrame([box('a', 0, 0, 20, 20)], 'hcenter', 100, 100)).toEqual([{ id: 'a', x: 40 }]); // centre 10->50
  });
  it('aligns top to y=0, bottom to frameH, vcenter to frameH/2', () => {
    expect(computeAlignToFrame([box('a', 0, 10, 20, 20)], 'top', 100, 100)).toEqual([{ id: 'a', y: 0 }]);
    expect(computeAlignToFrame([box('a', 0, 0, 20, 20)], 'bottom', 100, 100)).toEqual([{ id: 'a', y: 80 }]);
    expect(computeAlignToFrame([box('a', 0, 0, 20, 20)], 'vcenter', 100, 100)).toEqual([{ id: 'a', y: 40 }]);
  });
  it('operates PER-ITEM (each to the frame, not to the group) and filters no-op deltas', () => {
    const out = computeAlignToFrame([box('a', 0, 0, 10, 10), box('b', 50, 0, 10, 10)], 'left', 100, 100);
    expect(out).toEqual([{ id: 'b', x: 0 }]); // a already at 0 (filtered); b -> 0
  });
  it('returns [] for no items and for an already-aligned item', () => {
    expect(computeAlignToFrame([], 'left', 100, 100)).toEqual([]);
    expect(computeAlignToFrame([box('a', 0, 0, 20, 20)], 'left', 100, 100)).toEqual([]);
  });
});

describe('computeDistributeCenters', () => {
  // box(id, minX, minY, w, h, x, y); centre = minX + w/2. Differently sized to show CENTERS (not gaps) are evened.
  it('evens the centres along x (the middle moves to the midpoint)', () => {
    // a: minX -5 w10 -> centre 0; b: minX 20 w20 -> centre 30; c: minX 95 w10 -> centre 100
    const out = computeDistributeCenters([box('a', -5, 0, 10, 10), box('b', 20, 0, 20, 10), box('c', 95, 0, 10, 10)], 'h');
    // step = (100-0)/2 = 50 -> b centre 30 -> 50 => +20 (b.x default = minX = 20 -> 40)
    expect(out).toEqual([{ id: 'b', x: 40 }]);
  });
  it('evens the centres along y', () => {
    const out = computeDistributeCenters([box('a', 0, -5, 10, 10), box('b', 0, 20, 10, 20), box('c', 0, 95, 10, 10)], 'v');
    expect(out).toEqual([{ id: 'b', y: 40 }]);
  });
  it('returns [] for fewer than 3 and for already-even', () => {
    expect(computeDistributeCenters([box('a', 0, 0, 10, 10), box('b', 40, 0, 10, 10)], 'h')).toEqual([]);
    // centres at 5, 50, 95 -> step 45 -> already even
    expect(computeDistributeCenters([box('a', 0, 0, 10, 10), box('b', 45, 0, 10, 10), box('c', 90, 0, 10, 10)], 'h')).toEqual([]);
  });
});
