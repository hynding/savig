import { describe, it, expect } from 'vitest';
import { decompose, parseTransform, unwrapDegrees, IDENTITY, type Mat } from './smilTransform';

const apply = (m: Mat, x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

describe('parseTransform', () => {
  it('parses empty string to identity', () => {
    expect(parseTransform('')).toEqual([1, 0, 0, 1, 0, 0]);
  });
  it('returns a fresh copy, not the shared IDENTITY constant', () => {
    expect(parseTransform('')).not.toBe(IDENTITY);
  });
  it('parses comma-separated buildTransform output', () => {
    const m = parseTransform('translate(10, 20) rotate(90, 0, 0) scale(2, 3)');
    // (1,0) -> scale -> (2,0) -> rotate90 -> (0,2) -> translate -> (10,22)
    const [x, y] = apply(m, 1, 0);
    expect(x).toBeCloseTo(10, 6);
    expect(y).toBeCloseTo(22, 6);
  });
  it('parses space-separated camera output and 1-arg forms', () => {
    const m = parseTransform('translate(160 120) scale(2) rotate(0) translate(-160 -120)');
    const [x, y] = apply(m, 160, 120);
    expect(x).toBeCloseTo(160, 6);
    expect(y).toBeCloseTo(120, 6);
  });
  it('parses matrix() and 3-arg rotate(angle, cx, cy)', () => {
    expect(parseTransform('matrix(1, 0, 0, 1, 5, 6)')).toEqual([1, 0, 0, 1, 5, 6]);
    const m = parseTransform('rotate(180, 10, 0)'); // rotate about (10,0): (0,0) -> (20,0)
    const [x, y] = apply(m, 0, 0);
    expect(x).toBeCloseTo(20, 6);
    expect(y).toBeCloseTo(0, 6);
  });
});

describe('decompose', () => {
  // Recompose T·R·SkewX·S and check it reproduces the matrix (the invariant Task 2 relies on:
  // stacked additive animateTransforms translate -> rotate -> skewX -> scale reproduce the frame).
  const recompose = (d: ReturnType<typeof decompose>): Mat => {
    const rad = (deg: number) => (deg * Math.PI) / 180;
    const cos = Math.cos(rad(d.rotation)), sin = Math.sin(rad(d.rotation));
    const k = Math.tan(rad(d.skewX));
    // T · R · SkewX · S
    const a = cos * d.scaleX + 0, b = sin * d.scaleX;
    const c = (cos * k - sin) * d.scaleY, dd = (sin * k + cos) * d.scaleY;
    return [a, b, c, dd, d.tx, d.ty];
  };
  const roundTrip = (m: Mat) => {
    const r = recompose(decompose(m));
    m.forEach((v, i) => expect(r[i]).toBeCloseTo(v, 6));
  };
  it('round-trips a plain TRS chain', () => roundTrip(parseTransform('translate(10, 20) rotate(30, 0, 0) scale(2, 3)')));
  it('round-trips a sheared matrix (rotate·scale·rotate produces skew)', () =>
    roundTrip(parseTransform('rotate(30) scale(2, 0.5) rotate(20)')));
  it('round-trips a flip (negative determinant)', () => roundTrip(parseTransform('scale(-2, 3)')));
  it('handles a degenerate zero-scale matrix without NaN', () => {
    const d = decompose([0, 0, 0, 0, 5, 6]);
    for (const v of Object.values(d)) expect(Number.isFinite(v)).toBe(true);
    expect(d.tx).toBe(5);
  });
});

describe('unwrapDegrees', () => {
  it('removes the ±360 jump when a rotation crosses 180', () => {
    expect(unwrapDegrees([170, 179, -179, -170])).toEqual([170, 179, 181, 190]);
  });
  it('leaves already-continuous values unchanged', () => {
    expect(unwrapDegrees([0, 45, 90])).toEqual([0, 45, 90]);
  });
});
