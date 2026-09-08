import { describe, expect, it } from 'vitest';
import { computePeaks } from './waveform';

describe('computePeaks', () => {
  it('constant signal → constant peaks', () => {
    expect(Array.from(computePeaks(new Float32Array(100).fill(0.5), 4))).toEqual([0.5, 0.5, 0.5, 0.5]);
  });
  it('takes max |sample| per bin (negative peaks count)', () => {
    const data = new Float32Array([0, -0.9, 0, 0.2]);
    // Expected values go through Math.fround: the result is a Float32Array, and 0.9/0.2 are
    // not exactly representable in float32 (e.g. Math.fround(0.9) !== 0.9 as a JS double).
    expect(Array.from(computePeaks(data, 2))).toEqual([Math.fround(0.9), Math.fround(0.2)]);
  });
  it('silence → zeros; empty input → zeros; bins > samples still fills bins', () => {
    expect(Array.from(computePeaks(new Float32Array(8), 3))).toEqual([0, 0, 0]);
    expect(Array.from(computePeaks(new Float32Array(0), 2))).toEqual([0, 0]);
    expect(computePeaks(new Float32Array([1]), 4)).toHaveLength(4);
  });
});
