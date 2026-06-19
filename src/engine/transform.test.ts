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

  test('coerces non-finite values to "0"', () => {
    expect(fmt(NaN)).toBe('0');
    expect(fmt(Infinity)).toBe('0');
    expect(fmt(-Infinity)).toBe('0');
  });

  test('rounds values that collapse to negative zero to "0"', () => {
    expect(fmt(-0.00001)).toBe('0');
  });
});

describe('buildTransform', () => {
  test('produces the fixed-order transform string', () => {
    const t = { ...DEFAULT_TRANSFORM, x: 10, y: 20, rotation: 45, scaleX: 2, scaleY: 3 };
    expect(buildTransform(t, 4, 5)).toBe(
      'translate(10, 20) rotate(45, 4, 5) translate(4, 5) scale(2, 3) translate(-4, -5)',
    );
  });

  test('applies fmt rounding to emitted values (deterministic, no raw floats)', () => {
    const t = { ...DEFAULT_TRANSFORM, x: 1.111111, rotation: 30 };
    expect(buildTransform(t, 0, 0)).toBe(
      'translate(1.1111, 0) rotate(30, 0, 0) translate(0, 0) scale(1, 1) translate(0, 0)',
    );
  });

  test('applies fmt to fractional anchor coordinates', () => {
    const t = { ...DEFAULT_TRANSFORM, scaleX: 2, scaleY: 2 };
    expect(buildTransform(t, 1.5, 2.25)).toBe(
      'translate(0, 0) rotate(0, 1.5, 2.25) translate(1.5, 2.25) scale(2, 2) translate(-1.5, -2.25)',
    );
  });
});
