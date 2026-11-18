// Skew (spec 2026-11-18-skew-distort): the optional skewX / skewY transform channel.
import { describe, expect, it } from 'vitest';
import { buildTransform, clampSkew, MAX_SKEW, skewOffset } from './transform';
import { invMapPoint, mapPoint } from './groupTransform';
import { sampleObject } from './sample';
import { createKeyframe, createSceneObject } from './project';

// Reference: compose an SVG transform list into a matrix and apply it.
function applySvg(t: string, x: number, y: number): { x: number; y: number } {
  let m = [1, 0, 0, 1, 0, 0];
  const mul = (n: number[]) => {
    m = [
      m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
      m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
    ];
  };
  const rad = (d: number) => (d * Math.PI) / 180;
  for (const [, fn, raw] of t.matchAll(/(\w+)\(([^)]*)\)/g)) {
    const a = raw.split(/[\s,]+/).filter(Boolean).map(Number);
    if (fn === 'translate') mul([1, 0, 0, 1, a[0], a[1]]);
    else if (fn === 'scale') mul([a[0], 0, 0, a[1], 0, 0]);
    else if (fn === 'skewX') mul([1, 0, Math.tan(rad(a[0])), 1, 0, 0]);
    else if (fn === 'skewY') mul([1, Math.tan(rad(a[0])), 0, 1, 0, 0]);
    else if (fn === 'rotate') {
      const [c, s] = [Math.cos(rad(a[0])), Math.sin(rad(a[0]))];
      mul([1, 0, 0, 1, a[1], a[2]]);
      mul([c, s, -s, c, 0, 0]);
      mul([1, 0, 0, 1, -a[1], -a[2]]);
    }
  }
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

const T = { x: 12, y: -7, scaleX: 1.5, scaleY: 0.75, rotation: 30, opacity: 1 };

describe('buildTransform with skew', () => {
  it('emits nothing new when skew is absent or zero (byte-stable)', () => {
    const plain = buildTransform(T, 5, 6);
    expect(buildTransform({ ...T, skewX: 0, skewY: 0 }, 5, 6)).toBe(plain);
    expect(plain).not.toContain('skew');
  });

  it('places skewX then skewY between rotation and scale, about the anchor', () => {
    const s = buildTransform({ ...T, skewX: 20, skewY: -10 }, 5, 6);
    expect(s).toBe('translate(12, -7) rotate(30, 5, 6) translate(5, 6) skewX(20) skewY(-10) scale(1.5, 0.75) translate(-5, -6)');
  });

  it('keeps the anchor point fixed under skew', () => {
    const s = buildTransform({ ...T, x: 0, y: 0, rotation: 0, skewX: 40 }, 5, 6);
    const p = applySvg(s, 5, 6);
    expect(p.x).toBeCloseTo(5);
    expect(p.y).toBeCloseTo(6);
  });
});

describe('mapPoint / invMapPoint with skew', () => {
  const t = { ...T, skewX: 25, skewY: -15 };
  it('mapPoint matches the SVG transform string exactly', () => {
    const s = buildTransform(t, 5, 6);
    for (const [px, py] of [[0, 0], [10, 3], [-4, 20]]) {
      const a = mapPoint(t, 5, 6, px, py);
      const b = applySvg(s, px, py);
      expect(a.x).toBeCloseTo(b.x, 9);
      expect(a.y).toBeCloseTo(b.y, 9);
    }
  });

  it('invMapPoint round-trips mapPoint', () => {
    const w = mapPoint(t, 5, 6, 9, -3);
    const back = invMapPoint(t, 5, 6, w.x, w.y);
    expect(back.x).toBeCloseTo(9, 9);
    expect(back.y).toBeCloseTo(-3, 9);
  });

  it('skewOffset is the identity with no skew', () => {
    expect(skewOffset(undefined, 0, 3, 4)).toEqual({ x: 3, y: 4 });
  });
});

describe('sampleObject skew', () => {
  it('leaves an unskewed object’s state without skew keys (parity)', () => {
    const s = sampleObject(createSceneObject('a', { id: 'o' }), 0);
    expect('skewX' in s).toBe(false);
    expect('skewY' in s).toBe(false);
  });

  it('reads a base skew and interpolates a skew track', () => {
    const o = createSceneObject('a', { id: 'o' });
    o.base = { ...o.base, skewY: 12 };
    o.tracks = { skewX: [createKeyframe(0, 0, { easing: 'linear' }), createKeyframe(2, 30, { easing: 'linear' })] };
    const s = sampleObject(o, 1);
    expect(s.skewX).toBeCloseTo(15);
    expect(s.skewY).toBe(12);
  });

  it('clamps skew to ±MAX_SKEW', () => {
    const o = createSceneObject('a', { id: 'o' });
    o.base = { ...o.base, skewX: 400, skewY: -90 };
    const s = sampleObject(o, 0);
    expect(s.skewX).toBe(MAX_SKEW);
    expect(s.skewY).toBe(-MAX_SKEW);
    expect(clampSkew(Number.NaN)).toBe(0);
  });

  it('a skew wiggle samples skew even without base or track', () => {
    const o = createSceneObject('a', { id: 'o' });
    o.modifiers = { skewX: { wiggle: { amplitude: 5, frequency: 2, seed: 1 } } };
    expect(typeof sampleObject(o, 0.3).skewX).toBe('number');
  });
});
