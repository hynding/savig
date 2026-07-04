import { PX_PER_SECOND, timeToX, xToTime, frameTickBackground } from './scale';

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
