import { describe, expect, it } from 'vitest';
import { normalizeTrim, trimToDashAttrs } from './trim';
import { createKeyframe } from './project';

describe('trimToDashAttrs', () => {
  it('maps a plain window to dasharray/dashoffset in pathLength-normalized units', () => {
    expect(trimToDashAttrs({ start: 0.2, end: 0.7, offset: 0 })).toEqual({
      'stroke-dasharray': '0.5 0.5',
      'stroke-dashoffset': '-0.2',
      pathLength: '1',
    });
  });
  it('adds offset into the phase and wraps mod 1', () => {
    const a = trimToDashAttrs({ start: 0.5, end: 0.75, offset: 0.75 });
    expect(a['stroke-dasharray']).toBe('0.25 0.75');
    expect(a['stroke-dashoffset']).toBe('-0.25'); // (0.5 + 0.75) mod 1 = 0.25
  });
  it('clamps an inverted window (end < start) to an invisible stroke', () => {
    expect(trimToDashAttrs({ start: 0.8, end: 0.2, offset: 0 })['stroke-dasharray']).toBe('0 1');
  });
  it('renders identity as a solid full-length dash (attrs still emitted)', () => {
    expect(trimToDashAttrs({ start: 0, end: 1, offset: 0 })).toEqual({
      'stroke-dasharray': '1 0',
      'stroke-dashoffset': '0',
      pathLength: '1',
    });
  });
});

describe('normalizeTrim', () => {
  it('collapses identity with no tracks to undefined', () => {
    expect(normalizeTrim({ start: 0, end: 1, offset: 0 })).toBeUndefined();
  });
  it('keeps identity when any track exists', () => {
    const t = { start: 0, end: 1, offset: 0, endTrack: [createKeyframe(0, 0)] };
    expect(normalizeTrim(t)).toEqual(t);
  });
  it('keeps non-identity values', () => {
    expect(normalizeTrim({ start: 0.1, end: 1, offset: 0 })).toEqual({ start: 0.1, end: 1, offset: 0 });
  });
  it('drops empty track arrays before deciding', () => {
    expect(normalizeTrim({ start: 0, end: 1, offset: 0, endTrack: [] })).toBeUndefined();
  });
});
