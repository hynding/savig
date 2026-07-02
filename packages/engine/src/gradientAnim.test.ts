import { describe, it, expect } from 'vitest';
import { interpolateGradient, sampleGradient, stopAt } from './gradientAnim';
import type { Gradient, GradientKeyframe } from './types';

const lin = (x2: number, stops: Gradient['stops']): Gradient => ({
  type: 'linear',
  x1: 0,
  y1: 0,
  x2,
  y2: 0,
  stops,
});

describe('interpolateGradient', () => {
  it('lerps coords, offsets, opacity and stop colors at t=0.5', () => {
    const a = lin(0, [
      { offset: 0, color: '#000000' },
      { offset: 0.5, color: '#000000', opacity: 0 },
    ]);
    const b = lin(1, [
      { offset: 0, color: '#ffffff' },
      { offset: 1, color: '#ffffff', opacity: 1 },
    ]);
    const r = interpolateGradient(a, b, 0.5);
    expect(r.type).toBe('linear');
    expect((r as Extract<Gradient, { type: 'linear' }>).x2).toBeCloseTo(0.5);
    expect(r.stops[0].color).toBe('#808080');
    expect(r.stops[1].offset).toBeCloseTo(0.75);
    expect(r.stops[1].opacity).toBeCloseTo(0.5);
  });

  it('STEPS-holds when types differ (a until t>=1)', () => {
    const a = lin(1, [{ offset: 0, color: '#000000' }]);
    const b: Gradient = {
      type: 'radial',
      cx: 0.5,
      cy: 0.5,
      r: 0.5,
      stops: [{ offset: 0, color: '#ffffff' }],
    };
    expect(interpolateGradient(a, b, 0.4)).toEqual(a);
    expect(interpolateGradient(a, b, 1)).toEqual(b);
  });

  // (Slice 34: differing stop counts now MORPH via union-offset reconciliation —
  // see the 'interpolateGradient stop-count morphing' describe block below.)

  it('holds radial focal point when only one endpoint defines it', () => {
    const a: Gradient = {
      type: 'radial',
      cx: 0,
      cy: 0,
      r: 1,
      stops: [{ offset: 0, color: '#000000' }],
    };
    const b: Gradient = {
      type: 'radial',
      cx: 0,
      cy: 0,
      r: 1,
      fx: 0.4,
      fy: 0.4,
      stops: [{ offset: 0, color: '#000000' }],
    };
    const r = interpolateGradient(a, b, 0.5) as Extract<Gradient, { type: 'radial' }>;
    expect(r.fx).toBeUndefined();
  });

  it('holds the focal point atomically when one endpoint defines only fx', () => {
    const a: Gradient = {
      type: 'radial',
      cx: 0,
      cy: 0,
      r: 1,
      fx: 0.3,
      fy: 0.2,
      stops: [{ offset: 0, color: '#000000' }],
    };
    const b: Gradient = {
      type: 'radial',
      cx: 0,
      cy: 0,
      r: 1,
      fx: 0.8, // fy missing -> focal point is not fully defined on b
      stops: [{ offset: 0, color: '#000000' }],
    };
    const r = interpolateGradient(a, b, 0.5) as Extract<Gradient, { type: 'radial' }>;
    expect(r.fx).toBeUndefined();
    expect(r.fy).toBeUndefined();
  });

  it('does not set explicit opacity:1 when the lerped opacity reaches full', () => {
    const a = lin(0, [{ offset: 0, color: '#000000', opacity: 0 }]);
    const b = lin(1, [{ offset: 0, color: '#000000', opacity: 1 }]);
    expect(interpolateGradient(a, b, 1).stops[0].opacity).toBeUndefined();
    expect(interpolateGradient(a, b, 0.5).stops[0].opacity).toBeCloseTo(0.5);
  });
});

describe('sampleGradient', () => {
  const track: GradientKeyframe[] = [
    {
      time: 0,
      gradient: lin(0, [
        { offset: 0, color: '#000000' },
        { offset: 1, color: '#000000' },
      ]),
      easing: 'linear',
    },
    {
      time: 2,
      gradient: lin(1, [
        { offset: 0, color: '#ffffff' },
        { offset: 1, color: '#ffffff' },
      ]),
      easing: 'linear',
    },
  ];

  it('clamps before first and after last', () => {
    expect(sampleGradient(track, -1)).toEqual(track[0].gradient);
    expect(sampleGradient(track, 5)).toEqual(track[1].gradient);
  });

  it('brackets and applies easing at the midpoint', () => {
    const r = sampleGradient(track, 1);
    expect(r.stops[0].color).toBe('#808080');
  });

  it('throws on an empty track', () => {
    expect(() => sampleGradient([], 0)).toThrow();
  });

  it('returns the only keyframe when the track has length 1', () => {
    const single: GradientKeyframe = {
      time: 1,
      gradient: lin(0.5, [{ offset: 0, color: '#aabbcc' }]),
      easing: 'linear',
    };
    expect(sampleGradient([single], 0)).toEqual(single.gradient);
    expect(sampleGradient([single], 1)).toEqual(single.gradient);
    expect(sampleGradient([single], 2)).toEqual(single.gradient);
  });
});

describe('stopAt', () => {
  const stops = [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }];
  it('samples a color between two stops', () => {
    expect(stopAt(stops, 0.25).color).toBe('#404040');
    expect(stopAt(stops, 0.25).offset).toBe(0.25);
  });
  it('clamps before the first / after the last stop', () => {
    expect(stopAt(stops, -0.5).color).toBe('#000000');
    expect(stopAt(stops, 2).color).toBe('#ffffff');
  });
});

describe('interpolateGradient stop-count morphing', () => {
  const a = lin(1, [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }]);
  const b = lin(1, [
    { offset: 0, color: '#ff0000' },
    { offset: 0.5, color: '#00ff00' },
    { offset: 1, color: '#0000ff' },
  ]);

  it('t=0 reconciles a to the union offsets with a colinear middle stop (renders as a)', () => {
    const g = interpolateGradient(a, b, 0);
    expect(g.stops).toHaveLength(3);
    expect(g.stops.map((s) => s.offset)).toEqual([0, 0.5, 1]);
    expect(g.stops[0].color).toBe('#000000');
    expect(g.stops[1].color).toBe('#808080'); // colinear black->white midpoint
    expect(g.stops[2].color).toBe('#ffffff');
  });
  it('t=1 equals the 3-stop gradient', () => {
    const g = interpolateGradient(a, b, 1);
    expect(g.stops.map((s) => s.color)).toEqual(['#ff0000', '#00ff00', '#0000ff']);
  });
  it('t=0.5 blends both gradients at the union offsets (3 stops)', () => {
    const g = interpolateGradient(a, b, 0.5);
    expect(g.stops).toHaveLength(3);
    expect(g.stops[0].color).toBe('#800000'); // (#000000 + #ff0000)/2
    expect(g.stops[2].color).toBe('#8080ff'); // (#ffffff + #0000ff)/2
  });
  it('morphs radial gradients across stop count too', () => {
    const ra: Gradient = { type: 'radial', cx: 0.5, cy: 0.5, r: 0.5, stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }] };
    const rb: Gradient = { type: 'radial', cx: 0.5, cy: 0.5, r: 0.5, stops: [{ offset: 0, color: '#ff0000' }, { offset: 0.5, color: '#00ff00' }, { offset: 1, color: '#0000ff' }] };
    expect(interpolateGradient(ra, rb, 0.5).stops).toHaveLength(3);
  });
  it('STILL steps-holds across a TYPE mismatch (linear vs radial)', () => {
    const r: Gradient = { type: 'radial', cx: 0.5, cy: 0.5, r: 0.5, stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }] };
    expect(interpolateGradient(a, r, 0.4)).toBe(a); // hold a
    expect(interpolateGradient(a, r, 1)).toBe(r); // hold b at the end
  });
});
