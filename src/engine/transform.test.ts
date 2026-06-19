import { describe, expect, test } from 'vitest';
import { buildTransform, fmt } from './transform';
import { DEFAULT_TRANSFORM } from './project';

describe('fmt', () => {
  test('rounds to 4 decimals', () => {
    expect(fmt(1.234567)).toBe('1.2346');
  });

  test('normalizes negative zero to "0"', () => {
    expect(fmt(-0)).toBe('0');
  });

  test('keeps integers clean', () => {
    expect(fmt(5)).toBe('5');
  });
});

describe('buildTransform', () => {
  test('produces the fixed-order transform string', () => {
    const t = { ...DEFAULT_TRANSFORM, x: 10, y: 20, rotation: 45, scaleX: 2, scaleY: 3 };
    expect(buildTransform(t, 4, 5)).toBe(
      'translate(10, 20) rotate(45, 4, 5) translate(4, 5) scale(2, 3) translate(-4, -5)',
    );
  });

  test('is deterministic for identical inputs', () => {
    const t = { ...DEFAULT_TRANSFORM, x: 1.111111, rotation: 30 };
    expect(buildTransform(t, 0, 0)).toBe(buildTransform(t, 0, 0));
  });
});
