import { describe, it, expect } from 'vitest';
import { shapeLocalBBox, gradientHandlePositions, applyGradientHandleDrag } from './gradientHandles';
import type { Gradient, PathData } from './types';

describe('shapeLocalBBox', () => {
  it('rect -> origin bbox of width/height', () => {
    expect(shapeLocalBBox('rect', { width: 100, height: 60 })).toEqual({ x: 0, y: 0, width: 100, height: 60 });
  });
  it('ellipse -> 2*radius bbox', () => {
    expect(shapeLocalBBox('ellipse', { radiusX: 30, radiusY: 20 })).toEqual({ x: 0, y: 0, width: 60, height: 40 });
  });
  it('path -> pathBounds', () => {
    const path: PathData = { nodes: [{ anchor: { x: 5, y: 5 } }, { anchor: { x: 25, y: 15 } }], closed: false };
    expect(shapeLocalBBox('path', {}, path)).toEqual({ x: 5, y: 5, width: 20, height: 10 });
  });
  it('missing geometry -> zero bbox', () => {
    expect(shapeLocalBBox('rect', {})).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe('gradientHandlePositions', () => {
  const bbox = { x: 0, y: 0, width: 100, height: 100 };

  it('linear -> start and end at local fraction coords', () => {
    const g: Gradient = { type: 'linear', x1: 0, y1: 0.5, x2: 1, y2: 0.5, stops: [] };
    expect(gradientHandlePositions(g, bbox)).toEqual([
      { id: 'start', x: 0, y: 50 },
      { id: 'end', x: 100, y: 50 },
    ]);
  });

  it('radial -> center, radius (center+r rightward), focal (defaults to center)', () => {
    const g: Gradient = { type: 'radial', cx: 0.5, cy: 0.5, r: 0.5, stops: [] };
    expect(gradientHandlePositions(g, bbox)).toEqual([
      { id: 'center', x: 50, y: 50 },
      { id: 'radius', x: 100, y: 50 },
      { id: 'focal', x: 50, y: 50 },
    ]);
  });

  it('radial focal uses fx/fy when present', () => {
    const g: Gradient = { type: 'radial', cx: 0.5, cy: 0.5, r: 0.5, fx: 0.2, fy: 0.8, stops: [] };
    const focal = gradientHandlePositions(g, bbox).find((h) => h.id === 'focal');
    expect(focal).toEqual({ id: 'focal', x: 20, y: 80 });
  });

  it('respects a non-zero bbox origin (path)', () => {
    const g: Gradient = { type: 'linear', x1: 0, y1: 0, x2: 1, y2: 1, stops: [] };
    expect(gradientHandlePositions(g, { x: 10, y: 20, width: 100, height: 50 })).toEqual([
      { id: 'start', x: 10, y: 20 },
      { id: 'end', x: 110, y: 70 },
    ]);
  });
});

describe('applyGradientHandleDrag', () => {
  const bbox = { x: 0, y: 0, width: 100, height: 100 };
  const lin: Gradient = { type: 'linear', x1: 0, y1: 0.5, x2: 1, y2: 0.5, stops: [] };
  const rad: Gradient = { type: 'radial', cx: 0.5, cy: 0.5, r: 0.5, stops: [] };

  it('linear end -> sets x2/y2 as fraction of the drag point', () => {
    const r = applyGradientHandleDrag(lin, 'end', { x: 100, y: 0 }, bbox) as Extract<Gradient, { type: 'linear' }>;
    expect(r.x2).toBe(1);
    expect(r.y2).toBe(0);
    expect(r.x1).toBe(0); // start unchanged
  });

  it('linear start clamps fractions to [0,1]', () => {
    const r = applyGradientHandleDrag(lin, 'start', { x: -50, y: 200 }, bbox) as Extract<Gradient, { type: 'linear' }>;
    expect(r.x1).toBe(0);
    expect(r.y1).toBe(1);
  });

  it('radial center -> sets cx/cy, leaves fx/fy untouched', () => {
    const withFocal: Gradient = { ...rad, fx: 0.2, fy: 0.2 };
    const r = applyGradientHandleDrag(withFocal, 'center', { x: 30, y: 70 }, bbox) as Extract<Gradient, { type: 'radial' }>;
    expect([r.cx, r.cy]).toEqual([0.3, 0.7]);
    expect([r.fx, r.fy]).toEqual([0.2, 0.2]);
  });

  it('radial radius -> r = fraction distance from center (may exceed 1, never negative)', () => {
    const r = applyGradientHandleDrag(rad, 'radius', { x: 80, y: 50 }, bbox) as Extract<Gradient, { type: 'radial' }>;
    expect(r.r).toBeCloseTo(0.3);
  });

  it('radial focal -> sets fx/fy', () => {
    const r = applyGradientHandleDrag(rad, 'focal', { x: 25, y: 75 }, bbox) as Extract<Gradient, { type: 'radial' }>;
    expect([r.fx, r.fy]).toEqual([0.25, 0.75]);
  });

  it('zero-width bbox -> 0 fraction, no NaN', () => {
    const r = applyGradientHandleDrag(lin, 'end', { x: 50, y: 50 }, { x: 0, y: 0, width: 0, height: 0 }) as Extract<Gradient, { type: 'linear' }>;
    expect(r.x2).toBe(0);
    expect(r.y2).toBe(0);
  });
});
