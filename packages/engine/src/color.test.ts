import { describe, it, expect } from 'vitest';
import { parseHex, formatHex, interpolateColor, sampleColor } from './color';
import type { ColorKeyframe } from './types';

describe('parseHex', () => {
  it('parses #rrggbb and #rgb (case-insensitive)', () => {
    expect(parseHex('#ff0000')).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseHex('#0F0')).toEqual({ r: 0, g: 255, b: 0 });
  });
  it('returns null for none / named / malformed', () => {
    expect(parseHex('none')).toBeNull();
    expect(parseHex('red')).toBeNull();
    expect(parseHex('#12')).toBeNull();
  });
});

describe('formatHex', () => {
  it('clamps, rounds, and zero-pads to #rrggbb', () => {
    expect(formatHex({ r: 255, g: 0, b: 16 })).toBe('#ff0010');
    expect(formatHex({ r: 300, g: -5, b: 7.6 })).toBe('#ff0008');
  });
});

describe('interpolateColor', () => {
  it('lerps in RGB', () => {
    expect(interpolateColor('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
  it('steps when an endpoint is unparseable (none): holds a until t===1', () => {
    expect(interpolateColor('#000000', 'none', 0.5)).toBe('#000000');
    expect(interpolateColor('none', '#ffffff', 1)).toBe('#ffffff');
  });
});

describe('sampleColor', () => {
  const track: ColorKeyframe[] = [
    { time: 0, value: '#000000', easing: 'linear' },
    { time: 2, value: '#ffffff', easing: 'linear' },
  ];
  it('clamps before first / after last; single keyframe holds', () => {
    expect(sampleColor(track, -1)).toBe('#000000');
    expect(sampleColor(track, 5)).toBe('#ffffff');
    expect(sampleColor([{ time: 0, value: '#abcdef', easing: 'linear' }], 9)).toBe('#abcdef');
  });
  it('interpolates the bracketing pair with easing', () => {
    expect(sampleColor(track, 1)).toBe('#808080'); // linear midpoint
  });
  it('throws on an empty track', () => {
    expect(() => sampleColor([], 0)).toThrow();
  });
});
