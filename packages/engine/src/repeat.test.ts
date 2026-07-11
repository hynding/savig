import { describe, expect, it } from 'vitest';
import { normalizeRepeat, repeatDeltaTransform } from './repeat';
import type { RepeatSpec } from './types';

function spec(overrides: Partial<RepeatSpec> = {}): RepeatSpec {
  return { count: 3, dx: 10, dy: 5, rotate: 15, scale: 0.9, stagger: 0.4, ...overrides };
}

describe('normalizeRepeat', () => {
  it('count 1 -> undefined (single copy = no-op)', () => {
    expect(normalizeRepeat(spec({ count: 1 }))).toBeUndefined();
  });

  it('count 0 or negative -> undefined', () => {
    expect(normalizeRepeat(spec({ count: 0 }))).toBeUndefined();
    expect(normalizeRepeat(spec({ count: -5 }))).toBeUndefined();
  });

  it('count 3.7 rounds to 4 (Math.round, then clamp [2,64])', () => {
    expect(normalizeRepeat(spec({ count: 3.7 }))?.count).toBe(4);
  });

  it('count 200 clamps to 64', () => {
    expect(normalizeRepeat(spec({ count: 200 }))?.count).toBe(64);
  });

  it('NaN stagger -> undefined (any non-finite field invalidates the whole spec)', () => {
    expect(normalizeRepeat(spec({ stagger: NaN }))).toBeUndefined();
  });

  it('non-finite dx/dy/rotate/scale also invalidate the spec', () => {
    expect(normalizeRepeat(spec({ dx: Infinity }))).toBeUndefined();
    expect(normalizeRepeat(spec({ scale: -Infinity }))).toBeUndefined();
  });

  it('negative stagger clamps to 0', () => {
    expect(normalizeRepeat(spec({ stagger: -2 }))?.stagger).toBe(0);
  });

  it('negative/tiny scale clamps to 0.01', () => {
    expect(normalizeRepeat(spec({ scale: -3 }))?.scale).toBe(0.01);
    expect(normalizeRepeat(spec({ scale: 0 }))?.scale).toBe(0.01);
  });

  it('oversized scale clamps to 100', () => {
    expect(normalizeRepeat(spec({ scale: 500 }))?.scale).toBe(100);
  });

  it('valid spec passes through dx/dy/rotate unchanged', () => {
    const n = normalizeRepeat(spec());
    expect(n).toEqual({ count: 3, dx: 10, dy: 5, rotate: 15, scale: 0.9, stagger: 0.4 });
  });
});

describe('repeatDeltaTransform', () => {
  it('k=0 -> empty string (identity, no copy offset)', () => {
    expect(repeatDeltaTransform(spec(), 0)).toBe('');
  });

  it('k=2 with {dx:10,dy:5,rotate:15,scale:0.9} composes translate/rotate/scale', () => {
    // translate(k*dx, k*dy) rotate(k*rotate) scale(scale^k), mirroring buildTransform's
    // `translate(x, y)` comma-space syntax and fmt() number formatting.
    expect(repeatDeltaTransform(spec(), 2)).toBe('translate(20, 10) rotate(30) scale(0.81)');
  });

  it('k=1 composes the single-step delta', () => {
    expect(repeatDeltaTransform(spec(), 1)).toBe('translate(10, 5) rotate(15) scale(0.9)');
  });

  it('omits translate() when dx/dy delta is 0', () => {
    expect(repeatDeltaTransform(spec({ dx: 0, dy: 0 }), 2)).toBe('rotate(30) scale(0.81)');
  });

  it('omits rotate() when rotate delta is 0', () => {
    expect(repeatDeltaTransform(spec({ rotate: 0 }), 2)).toBe('translate(20, 10) scale(0.81)');
  });

  it('omits scale() when scale is 1 (identity, scale^k === 1)', () => {
    expect(repeatDeltaTransform(spec({ scale: 1 }), 2)).toBe('translate(20, 10) rotate(30)');
  });

  it('all components identity but k>0 -> empty string', () => {
    expect(repeatDeltaTransform(spec({ dx: 0, dy: 0, rotate: 0, scale: 1 }), 3)).toBe('');
  });
});
