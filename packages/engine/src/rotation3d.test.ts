// 3D rotation (spec 2026-11-18-3d-rotation): optional rotationX / rotationY, orthographic.
import { describe, expect, it } from 'vitest';
import { buildTransform, tiltMatrix, tiltOffset, untiltOffset } from './transform';
import { invMapPoint, mapPoint } from './groupTransform';
import { sampleObject } from './sample';
import { createKeyframe, createSceneObject } from './project';

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
    else if (fn === 'matrix') mul(a);
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

const T = { x: 12, y: -7, scaleX: 1.5, scaleY: 0.75, rotation: 30, opacity: 1, skewX: 10 };

describe('3D rotation transform', () => {
  it('emits nothing new when absent or zero (byte-stable)', () => {
    const plain = buildTransform(T, 5, 6);
    expect(buildTransform({ ...T, rotationX: 0, rotationY: 0 }, 5, 6)).toBe(plain);
    expect(plain).not.toContain('matrix');
  });

  it('turning 60° about Y halves the width; about X halves the height', () => {
    expect(tiltOffset(0, 60, 10, 10).x).toBeCloseTo(5);
    expect(tiltOffset(0, 60, 10, 10).y).toBeCloseTo(10);
    expect(tiltOffset(60, 0, 10, 10).y).toBeCloseTo(5);
    expect(tiltOffset(60, 0, 10, 10).x).toBeCloseTo(10);
  });

  it('matches CSS rotateX(rx) rotateY(ry) projected orthographically', () => {
    const [a, b, c, d] = tiltMatrix(30, 40);
    const r = Math.PI / 180;
    expect(a).toBeCloseTo(Math.cos(40 * r));
    expect(b).toBeCloseTo(Math.sin(30 * r) * Math.sin(40 * r));
    expect(c).toBe(0);
    expect(d).toBeCloseTo(Math.cos(30 * r));
  });

  it('a 180° Y turn mirrors the drawing (the back of a card)', () => {
    const p = tiltOffset(0, 180, 10, 4);
    expect(p.x).toBeCloseTo(-10);
    expect(p.y).toBeCloseTo(4);
  });

  it('mapPoint agrees with the SVG string and invMapPoint inverts it', () => {
    const t = { ...T, rotationX: 25, rotationY: -50 };
    for (const [px, py] of [[0, 0], [30, 10], [-8, 22]]) {
      const svg = applySvg(buildTransform(t, 5, 6), px, py);
      const m = mapPoint(t, 5, 6, px, py);
      expect(m.x).toBeCloseTo(svg.x, 3);
      expect(m.y).toBeCloseTo(svg.y, 3);
      const back = invMapPoint(t, 5, 6, m.x, m.y);
      expect(back.x).toBeCloseTo(px, 6);
      expect(back.y).toBeCloseTo(py, 6);
    }
  });

  it('untiltOffset stays finite edge-on', () => {
    const p = untiltOffset(0, 90, 1, 1);
    expect(Number.isFinite(p.x)).toBe(true);
  });

  it('sampleObject adds rotationX/Y only when the object has them, and animates them', () => {
    const plain = createSceneObject('a', { id: 'a' });
    expect('rotationY' in sampleObject(plain, 0)).toBe(false);
    const o = { ...plain, tracks: { rotationY: [createKeyframe(0, 0, { easing: 'linear' }), createKeyframe(1, 180, { easing: 'linear' })] } };
    expect(sampleObject(o, 0.5).rotationY).toBeCloseTo(90);
    expect(sampleObject(o, 0.5).rotationX).toBeUndefined();
  });
});
