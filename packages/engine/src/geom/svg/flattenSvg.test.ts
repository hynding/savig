import { describe, it, expect } from 'vitest';
import { parseTransformList, flattenElementToRings, svgAssetRings, type Mat2x3 } from './flattenSvg';
import type { SvgAsset } from '../../types';

const el = (markup: string): Element =>
  new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`, 'image/svg+xml')
    .documentElement.firstElementChild!;
const ID: Mat2x3 = [1, 0, 0, 1, 0, 0];

describe('flattenSvg', () => {
  it('rect -> 4 corners', () => {
    const rings = flattenElementToRings(el('<rect x="2" y="3" width="10" height="4"/>'), ID);
    expect(rings).toHaveLength(1);
    const xs = rings[0].map((p) => p[0]);
    const ys = rings[0].map((p) => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(2);
    expect(Math.max(...xs)).toBeCloseTo(12);
    expect(Math.min(...ys)).toBeCloseTo(3);
    expect(Math.max(...ys)).toBeCloseTo(7);
  });

  it('circle -> points on the circle', () => {
    const rings = flattenElementToRings(el('<circle cx="0" cy="0" r="10"/>'), ID);
    for (const [x, y] of rings[0]) expect(Math.hypot(x, y)).toBeCloseTo(10, 4);
  });

  it('polygon -> its points', () => {
    const rings = flattenElementToRings(el('<polygon points="0,0 10,0 10,10"/>'), ID);
    expect(rings[0]).toEqual([
      [0, 0], [10, 0], [10, 10],
    ]);
  });

  it('translate transform shifts points', () => {
    const m = parseTransformList('translate(5 7)');
    const rings = flattenElementToRings(el('<rect x="0" y="0" width="2" height="2"/>'), m);
    expect(Math.min(...rings[0].map((p) => p[0]))).toBeCloseTo(5);
    expect(Math.min(...rings[0].map((p) => p[1]))).toBeCloseTo(7);
  });

  it('scale + translate compose left-to-right', () => {
    const m = parseTransformList('translate(10 0) scale(2)');
    // a point (3,0) -> scale -> (6,0) -> translate -> (16,0)
    const rings = flattenElementToRings(el('<rect x="3" y="0" width="0.001" height="0.001"/>'), m);
    expect(Math.min(...rings[0].map((p) => p[0]))).toBeCloseTo(16, 2);
  });

  it('path cubic flattens with a midpoint on the curve', () => {
    // De Casteljau t=0.5 midpoint of M0 0 C0 10 10 10 10 0 is (5, 7.5)
    const rings = flattenElementToRings(el('<path d="M0 0 C0 10 10 10 10 0 Z"/>'), ID);
    const near = rings[0].some((p) => Math.abs(p[0] - 5) < 0.6 && Math.abs(p[1] - 7.5) < 0.6);
    expect(near).toBe(true);
  });

  it('svgAssetRings maps viewBox -> width/height and returns one ring per shape', () => {
    const asset: SvgAsset = {
      id: 's', kind: 'svg', name: 's', viewBox: '0 0 10 10', width: 20, height: 20,
      normalizedContent:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect x="0" y="0" width="10" height="10"/></svg>',
    };
    const rings = svgAssetRings(asset);
    expect(rings).toHaveLength(1);
    // viewBox 10 -> render box 20 => the rect spans 0..20 in object-local coords
    expect(Math.max(...rings[0].map((p) => p[0]))).toBeCloseTo(20, 3);
  });

  it('svgAssetRings follows nested <g transform>', () => {
    const asset: SvgAsset = {
      id: 'g', kind: 'svg', name: 'g', viewBox: '0 0 10 10', width: 10, height: 10,
      normalizedContent:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g transform="translate(5 0)"><rect x="0" y="0" width="2" height="2"/></g></svg>',
    };
    const rings = svgAssetRings(asset);
    expect(rings).toHaveLength(1);
    expect(Math.min(...rings[0].map((p) => p[0]))).toBeCloseTo(5, 3); // shifted by the g transform
  });

  it('svgAssetRings skips unsupported-only markup without throwing', () => {
    const asset: SvgAsset = {
      id: 't', kind: 'svg', name: 't', viewBox: '0 0 10 10', width: 10, height: 10,
      normalizedContent:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text x="0" y="5">hi</text></svg>',
    };
    expect(svgAssetRings(asset)).toEqual([]);
  });
});
