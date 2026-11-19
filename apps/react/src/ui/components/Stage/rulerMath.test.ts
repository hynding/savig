import { describe, expect, it } from 'vitest';
import { rulerTicks, stageViewMap } from './rulerMath';

describe('stageViewMap', () => {
  it('fits the artboard and applies pan and zoom', () => {
    // 800x600 area, 400x400 artboard -> s = 1.5, centred horizontally (100px gutter).
    expect(stageViewMap({ w: 800, h: 600 }, { width: 400, height: 400 }, { x: 0, y: 0 }, 1)).toEqual({ k: 1.5, ox: 100, oy: 0 });
    expect(stageViewMap({ w: 800, h: 600 }, { width: 400, height: 400 }, { x: 10, y: 20 }, 2)).toEqual({ k: 3, ox: 115, oy: 30 });
  });
});

describe('rulerTicks', () => {
  it('labels nice steps at least 60px apart', () => {
    const t = rulerTicks(500, 0, 1);
    expect(t.major.map((m) => m.value)).toEqual([0, 100, 200, 300, 400, 500]);
    expect(t.minor.length).toBe(45); // 10 subdivisions per 100px step
    const z = rulerTicks(500, 0, 0.5);
    expect(z.major[1].value).toBe(200);
  });

  it('covers negative stage coordinates left of the origin', () => {
    const t = rulerTicks(300, 100, 1);
    expect(t.major[0]).toEqual({ px: 0, value: -100 });
  });
});
