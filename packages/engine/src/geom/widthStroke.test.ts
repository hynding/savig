import { describe, expect, it } from 'vitest';
import type { PathData, VectorStyle } from '../types';
import { MAX_WIDTH_SCALE, MAX_WIDTH_STOPS, WIDTH_PRESETS, hasWidthProfile, normalizeWidthProfile, widthScaleAt } from './widthStroke';
import { computeOutlineStrokeEffect, strokeInkRings, widthStrokeD, widthStrokeRings } from './strokeOutline';
import { ringArea } from './boolean';
import { renderShapeToSvg } from '../renderShape';
import { createSceneObject, createVectorAsset } from '../project';

const line: PathData = { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }] };
const square: PathData = {
  closed: true,
  nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }, { anchor: { x: 100, y: 100 } }, { anchor: { x: 0, y: 100 } }],
};
const style = (widthProfile?: VectorStyle['widthProfile']): VectorStyle => ({ fill: 'none', stroke: '#123456', strokeWidth: 10, ...(widthProfile ? { widthProfile } : {}) });
const inkArea = (rings: PathData[]) => rings.reduce((sum, r) => sum + ringArea(r.nodes.map((n) => n.anchor)), 0);

describe('normalizeWidthProfile', () => {
  it('keeps finite stations, clamps, sorts and keeps the last station per t', () => {
    expect(
      normalizeWidthProfile([{ t: 0.8, w: 2 }, { t: -1, w: 99 }, { t: 0.8, w: 3 }, { t: NaN, w: 1 }, { t: 0.5 }, null, 'x']),
    ).toEqual([
      { t: 0, w: MAX_WIDTH_SCALE },
      { t: 0.8, w: 3 },
    ]);
  });

  it('drops an empty, non-array or all-uniform profile', () => {
    expect(normalizeWidthProfile([])).toBeUndefined();
    expect(normalizeWidthProfile('nope')).toBeUndefined();
    expect(normalizeWidthProfile([{ t: 0, w: 1 }, { t: 1, w: 1 }])).toBeUndefined();
  });

  it('thins an overlong profile to MAX_WIDTH_STOPS, keeping both ends', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ t: i / 99, w: i % 2 ? 0.5 : 2 }));
    const out = normalizeWidthProfile(many)!;
    expect(out).toHaveLength(MAX_WIDTH_STOPS);
    expect(out[0].t).toBe(0);
    expect(out[out.length - 1].t).toBe(1);
  });

  it('presets are already normal', () => {
    for (const [id, p] of Object.entries(WIDTH_PRESETS)) {
      if (id === 'uniform') continue;
      expect(normalizeWidthProfile(p)).toEqual(p);
    }
  });
});

describe('widthScaleAt', () => {
  const p = [{ t: 0.25, w: 0 }, { t: 0.75, w: 2 }];
  it('holds the ends and eases between stations', () => {
    expect(widthScaleAt(p, 0)).toBe(0);
    expect(widthScaleAt(p, 1)).toBe(2);
    expect(widthScaleAt(p, 0.5)).toBeCloseTo(1);
    // smoothstep: a quarter of the way in sits below the linear value
    expect(widthScaleAt(p, 0.375)).toBeLessThan(0.5);
    expect(widthScaleAt([], 0.3)).toBe(1);
  });
});

describe('widthStrokeRings', () => {
  it('a uniform-1 profile matches the plain stroke area', () => {
    const rings = widthStrokeRings(line, style([{ t: 0, w: 1 }, { t: 1, w: 1.0001 }]));
    expect(Math.abs(inkArea(rings))).toBeCloseTo(1000, -1);
  });

  it('a taper follows the profile on a straight two-node line', () => {
    const rings = widthStrokeRings(line, style([...WIDTH_PRESETS['taper-end']]));
    // ∫ smoothstep 1→0 = 1/2, so half the uniform area
    expect(Math.abs(inkArea(rings))).toBeGreaterThan(470);
    expect(Math.abs(inkArea(rings))).toBeLessThan(530);
    const xs = rings[0].nodes.map((n) => n.anchor);
    const widthNear = (x: number) => {
      const ys = xs.filter((q) => Math.abs(q.x - x) < 1).map((q) => q.y);
      return Math.max(...ys) - Math.min(...ys);
    };
    expect(widthNear(5)).toBeGreaterThan(widthNear(95));
  });

  it('a closed path strokes to an annulus (outer ring plus hole)', () => {
    const rings = widthStrokeRings(square, style([...WIDTH_PRESETS.bulge]));
    expect(rings.length).toBe(2);
    const [a, b] = rings.map((r) => ringArea(r.nodes.map((n) => n.anchor)));
    expect(Math.sign(a)).not.toBe(Math.sign(b));
  });

  it('draws nothing without a profile, a stroke, or a path', () => {
    expect(widthStrokeRings(line, style())).toEqual([]);
    expect(widthStrokeRings(line, { ...style([{ t: 0, w: 2 }]), stroke: 'none' })).toEqual([]);
    expect(widthStrokeRings(undefined, style([{ t: 0, w: 2 }]))).toEqual([]);
    expect(widthStrokeD(line, style())).toBe('');
    expect(hasWidthProfile(style([{ t: 0, w: 2 }]))).toBe(true);
  });

  it('strokeInkRings (eraser / paint bucket) uses the profile when there is one', () => {
    const tapered = strokeInkRings(line, style([...WIDTH_PRESETS['taper-end']]));
    const plain = strokeInkRings(line, style());
    expect(Math.abs(inkArea(tapered))).toBeLessThan(Math.abs(inkArea(plain)) * 0.6);
  });
});

describe('rendering a profiled path', () => {
  it('renderShapeToSvg draws the fill with no stroke, then the outline filled with the stroke paint', () => {
    const svg = renderShapeToSvg('path', {}, { ...style([...WIDTH_PRESETS.bulge]), fill: '#ff0000', strokeDasharray: [0.1, 0.1] }, line);
    const [shape, outline] = svg.split('/>');
    expect(shape).toContain('stroke="none"');
    expect(shape).toContain('fill="#ff0000"');
    expect(shape).not.toContain('stroke-width');
    expect(shape).not.toContain('stroke-dasharray');
    expect(outline).toContain('data-savig-width');
    expect(outline).toContain('fill="#123456"');
    expect(outline).toMatch(/d="M[^"]+Z/);
  });

  it('a stroke gradient paints the outline', () => {
    const svg = renderShapeToSvg('path', {}, style([...WIDTH_PRESETS.bulge]), line, 'o1', { stroke: true });
    expect(svg).toMatch(/data-savig-width="" d="[^"]*" fill="url\(#savig-grad-o1-stroke\)"/);
  });

  it('a plain stroke renders exactly as before', () => {
    expect(renderShapeToSvg('path', {}, style(), line)).not.toContain('data-savig-width');
  });
});

describe('Outline stroke honours the profile', () => {
  it('outlines to the profiled ink', () => {
    const asset = createVectorAsset('path', { path: line, style: style([...WIDTH_PRESETS['taper-end']]) });
    const obj = createSceneObject(asset.id);
    const effect = computeOutlineStrokeEffect(obj, asset)!;
    const area = Math.abs(ringArea(effect.nextAsset.path!.nodes.map((n) => n.anchor)));
    expect(area).toBeLessThan(600);
    expect(effect.nextAsset.style.widthProfile).toBeUndefined();
  });
});
