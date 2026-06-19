import { describe, expect, test } from 'vitest';
import { interpolate } from './interpolate';
import { createKeyframe } from './project';

describe('interpolate', () => {
  test('throws on an empty track', () => {
    expect(() => interpolate([], 0)).toThrow();
  });

  test('returns the single value for a one-keyframe track', () => {
    expect(interpolate([createKeyframe(2, 42)], 0)).toBe(42);
    expect(interpolate([createKeyframe(2, 42)], 5)).toBe(42);
  });

  test('clamps before the first and after the last keyframe', () => {
    const track = [createKeyframe(1, 10), createKeyframe(3, 30)];
    expect(interpolate(track, 0)).toBe(10);
    expect(interpolate(track, 5)).toBe(30);
  });

  test('linearly interpolates at the midpoint', () => {
    const track = [createKeyframe(0, 0), createKeyframe(1, 100)];
    expect(interpolate(track, 0.5)).toBeCloseTo(50, 6);
  });

  test('eases with keyframe A easing over the A→B segment', () => {
    const track = [createKeyframe(0, 0, { easing: 'easeIn' }), createKeyframe(1, 100)];
    // easeIn(0.5) = 0.25 → 25
    expect(interpolate(track, 0.5)).toBeCloseTo(25, 6);
  });

  test('picks the correct segment across three keyframes', () => {
    const track = [
      createKeyframe(0, 0),
      createKeyframe(2, 100),
      createKeyframe(4, 0),
    ];
    expect(interpolate(track, 1)).toBeCloseTo(50, 6);
    expect(interpolate(track, 3)).toBeCloseTo(50, 6);
  });

  test('rotation shortest mode takes the short way (350 → 10 goes +20)', () => {
    const track = [
      createKeyframe(0, 350, { rotationMode: 'shortest' }),
      createKeyframe(1, 10),
    ];
    // shortest delta = +20 → at t=0.5 value = 360 (i.e. 350 + 10)
    expect(interpolate(track, 0.5)).toBeCloseTo(360, 6);
  });

  test('rotation raw mode interpolates literal values (350 → 10 goes down)', () => {
    const track = [
      createKeyframe(0, 350, { rotationMode: 'raw' }),
      createKeyframe(1, 10),
    ];
    expect(interpolate(track, 0.5)).toBeCloseTo(180, 6);
  });

  test('handles zero-length segments without dividing by zero', () => {
    const track = [createKeyframe(1, 10), createKeyframe(1, 20)];
    expect(Number.isFinite(interpolate(track, 1))).toBe(true);
  });
});
