// Lottie export helpers (spec 2026-11-15-lottie-export). Rendering is checked end to end in
// packages/core/src/node/lottie.test.ts against SaViG's own raster.
import { describe, expect, it } from 'vitest';
import { createProject } from '@savig/engine';
import { exportLottie, lottieColor, numericChannel } from './lottie';

describe('numericChannel', () => {
  it('is static when constant, two keyframes for a straight line, keeps the corner of a V', () => {
    expect(numericChannel([[5], [5], [5]])).toEqual({ a: 0, k: 5 });
    const line = numericChannel([0, 1, 2, 3, 4].map((x) => [x * 10]));
    expect((line.k as { t: number }[]).map((k) => k.t)).toEqual([0, 4]);
    const v = numericChannel([[0], [10], [20], [10], [0]]);
    expect((v.k as { t: number }[]).map((k) => k.t)).toEqual([0, 2, 4]);
    expect((v.k as { o?: unknown }[])[2].o).toBeUndefined(); // last keyframe carries no easing
  });
});

describe('lottieColor', () => {
  it('reads hex, short hex, rgb() and a few names; none is null', () => {
    expect(lottieColor('#ff0000')).toEqual([1, 0, 0]);
    expect(lottieColor('#0f0')).toEqual([0, 1, 0]);
    expect(lottieColor('rgb(0, 0, 255)')).toEqual([0, 0, 1]);
    expect(lottieColor('white')).toEqual([1, 1, 1]);
    expect(lottieColor('none')).toBeNull();
  });
});

describe('exportLottie', () => {
  it('writes the animation header for an empty project', () => {
    const p = createProject({ width: 320, height: 240, fps: 24 });
    const { animation, warnings } = exportLottie(p);
    expect(animation).toMatchObject({ v: '5.7.4', fr: 24, ip: 0, w: 320, h: 240, layers: [], assets: [] });
    expect(animation.op).toBeGreaterThanOrEqual(1); // never a zero-length animation
    expect(warnings).toEqual([]);
  });
});
