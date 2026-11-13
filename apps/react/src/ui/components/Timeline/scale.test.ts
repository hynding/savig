import { PX_PER_SECOND, timeToX, xToTime, frameTickBackground, makeTimelineScale, rulerLabelStep } from './scale';

it('maps time to x and back', () => {
  expect(timeToX(1)).toBe(PX_PER_SECOND);
  expect(xToTime(PX_PER_SECOND * 2)).toBe(2);
});

describe('frameTickBackground', () => {
  it('draws both frame (minor) and second (major) ticks at readable fps', () => {
    const bg = frameTickBackground(30);
    // Two layered gradients: the second-major (100px period) and the frame-minor.
    expect(bg.match(/repeating-linear-gradient/g)).toHaveLength(2);
    expect(bg).toContain(`transparent ${PX_PER_SECOND}px`); // second period
    expect(bg).toContain(`transparent ${PX_PER_SECOND / 30}px`); // frame period (3.33…px)
  });

  it('degrades to second-ticks only when frames are too dense to read', () => {
    const bg = frameTickBackground(60); // 1.67px/frame < MIN_FRAME_TICK_PX
    expect(bg.match(/repeating-linear-gradient/g)).toHaveLength(1);
    expect(bg).toContain(`transparent ${PX_PER_SECOND}px`);
  });

  it('is safe for a non-positive fps (seconds only, no divide-by-zero)', () => {
    const bg = frameTickBackground(0);
    expect(bg.match(/repeating-linear-gradient/g)).toHaveLength(1);
  });
});

describe('makeTimelineScale (zoom)', () => {
  it('multiplies the base scale and inverts cleanly', () => {
    const s = makeTimelineScale(4);
    expect(s.pxPerSecond).toBe(4 * PX_PER_SECOND);
    expect(s.timeToX(0.5)).toBe(2 * PX_PER_SECOND);
    expect(s.xToTime(s.timeToX(1.25))).toBeCloseTo(1.25);
  });

  it('frame ticks follow the zoom: 60 fps becomes readable when zoomed in', () => {
    expect(makeTimelineScale(1).frameTickBackground(60).match(/repeating-linear-gradient/g)).toHaveLength(1);
    const bg = makeTimelineScale(4).frameTickBackground(60);
    expect(bg.match(/repeating-linear-gradient/g)).toHaveLength(2);
    expect(bg).toContain(`transparent ${(4 * PX_PER_SECOND) / 60}px`);
  });

  it('labels every second until seconds crowd, then every 2nd / 5th / … second', () => {
    expect(rulerLabelStep(100)).toBe(1);
    expect(rulerLabelStep(40)).toBe(1);
    expect(rulerLabelStep(25)).toBe(2);
    expect(rulerLabelStep(10)).toBe(5);
  });
});
