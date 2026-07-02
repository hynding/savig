import { describe, expect, it } from 'vitest';
import {
  angleToLinearCoords,
  defaultGradient,
  gradientAttrs,
  gradientStopAttrs,
  gradientStopsMarkup,
  gradientToSvg,
  linearCoordsToAngle,
  paintRef,
} from './gradient';
import type { LinearGradient, RadialGradient } from './types';

describe('gradientStopAttrs', () => {
  it('returns raw offset + color, omitting stop-opacity when >= 1', () => {
    expect(gradientStopAttrs({ offset: 0.25, color: '#ff0000' })).toEqual({
      offset: '0.25',
      'stop-color': '#ff0000',
    });
    expect(gradientStopAttrs({ offset: 0.25, color: '#ff0000', opacity: 1 })).toEqual({
      offset: '0.25',
      'stop-color': '#ff0000',
    });
  });
  it('includes stop-opacity when < 1', () => {
    expect(gradientStopAttrs({ offset: 1, color: '#0000ff', opacity: 0.5 })).toEqual({
      offset: '1',
      'stop-color': '#0000ff',
      'stop-opacity': '0.5',
    });
  });
});

describe('gradientAttrs', () => {
  it('returns linear coordinate attrs (no id)', () => {
    expect(gradientAttrs({ type: 'linear', x1: 0, y1: 0.5, x2: 1, y2: 0.5, stops: [] })).toEqual({
      x1: '0',
      y1: '0.5',
      x2: '1',
      y2: '0.5',
    });
  });
  it('returns radial attrs, omitting absent focal point', () => {
    expect(gradientAttrs({ type: 'radial', cx: 0.5, cy: 0.5, r: 0.5, stops: [] })).toEqual({
      cx: '0.5',
      cy: '0.5',
      r: '0.5',
    });
  });
  it('includes focal point when present', () => {
    expect(
      gradientAttrs({ type: 'radial', cx: 0.5, cy: 0.5, r: 0.5, fx: 0.2, fy: 0.3, stops: [] }),
    ).toEqual({ cx: '0.5', cy: '0.5', r: '0.5', fx: '0.2', fy: '0.3' });
  });
});

describe('gradientStopsMarkup', () => {
  it('renders stops, emitting stop-opacity only when < 1', () => {
    expect(
      gradientStopsMarkup({
        type: 'linear',
        x1: 0,
        y1: 0,
        x2: 1,
        y2: 0,
        stops: [
          { offset: 0, color: '#ff0000' },
          { offset: 1, color: '#0000ff', opacity: 0.5 },
        ],
      }),
    ).toBe(
      '<stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff" stop-opacity="0.5"/>',
    );
  });
});

describe('paintRef', () => {
  it('wraps an id as a url() reference', () => {
    expect(paintRef('savig-grad-abc-fill')).toBe('url(#savig-grad-abc-fill)');
  });
});

describe('gradientToSvg', () => {
  const linear: LinearGradient = {
    type: 'linear',
    x1: 0,
    y1: 0.5,
    x2: 1,
    y2: 0.5,
    stops: [
      { offset: 0, color: '#000000' },
      { offset: 1, color: '#ffffff' },
    ],
  };

  it('emits a linearGradient with no gradientUnits (objectBoundingBox default)', () => {
    const svg = gradientToSvg('g1', linear);
    expect(svg).toBe(
      '<linearGradient id="g1" x1="0" y1="0.5" x2="1" y2="0.5">' +
        '<stop offset="0" stop-color="#000000"/>' +
        '<stop offset="1" stop-color="#ffffff"/>' +
        '</linearGradient>',
    );
    expect(svg).not.toContain('gradientUnits');
  });

  it('emits a radialGradient with cx/cy/r and optional focal point', () => {
    const radial: RadialGradient = {
      type: 'radial',
      cx: 0.5,
      cy: 0.5,
      r: 0.5,
      fx: 0.25,
      fy: 0.75,
      stops: [
        { offset: 0, color: '#ff0000' },
        { offset: 1, color: '#0000ff' },
      ],
    };
    expect(gradientToSvg('g2', radial)).toBe(
      '<radialGradient id="g2" cx="0.5" cy="0.5" r="0.5" fx="0.25" fy="0.75">' +
        '<stop offset="0" stop-color="#ff0000"/>' +
        '<stop offset="1" stop-color="#0000ff"/>' +
        '</radialGradient>',
    );
  });

  it('omits fx/fy when absent', () => {
    const radial: RadialGradient = {
      type: 'radial',
      cx: 0.5,
      cy: 0.5,
      r: 0.5,
      stops: [
        { offset: 0, color: '#000000' },
        { offset: 1, color: '#ffffff' },
      ],
    };
    expect(gradientToSvg('g3', radial)).not.toContain('fx=');
  });

  it('emits stop-opacity only when < 1, clamping offset and opacity to [0,1]', () => {
    const g: LinearGradient = {
      type: 'linear',
      x1: 0,
      y1: 0,
      x2: 1,
      y2: 0,
      stops: [
        { offset: -0.5, color: '#000000', opacity: 1 },
        { offset: 1.5, color: '#ffffff', opacity: 0.3 },
      ],
    };
    const svg = gradientToSvg('g4', g);
    expect(svg).toContain('<stop offset="0" stop-color="#000000"/>');
    expect(svg).toContain('<stop offset="1" stop-color="#ffffff" stop-opacity="0.3"/>');
  });

  it('escapes a malicious stop color (defense-in-depth)', () => {
    const g: LinearGradient = {
      type: 'linear',
      x1: 0,
      y1: 0,
      x2: 1,
      y2: 0,
      stops: [
        { offset: 0, color: '"><script>alert(1)</script>' },
        { offset: 1, color: '#fff' },
      ],
    };
    const svg = gradientToSvg('g5', g);
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });
});

describe('defaultGradient', () => {
  it('builds a horizontal two-stop linear gradient seeded by a color', () => {
    expect(defaultGradient('linear', '#112233')).toEqual({
      type: 'linear',
      x1: 0,
      y1: 0.5,
      x2: 1,
      y2: 0.5,
      stops: [
        { offset: 0, color: '#112233' },
        { offset: 1, color: '#ffffff' },
      ],
    });
  });

  it('builds a centered two-stop radial gradient, defaulting the seed to black', () => {
    expect(defaultGradient('radial')).toEqual({
      type: 'radial',
      cx: 0.5,
      cy: 0.5,
      r: 0.5,
      stops: [
        { offset: 0, color: '#000000' },
        { offset: 1, color: '#ffffff' },
      ],
    });
  });
});

describe('angle <-> linear coords', () => {
  it('0deg is left->right across the bbox', () => {
    expect(angleToLinearCoords(0)).toEqual({ x1: 0, y1: 0.5, x2: 1, y2: 0.5 });
  });

  it('90deg is top->bottom', () => {
    const c = angleToLinearCoords(90);
    expect(c.x1).toBeCloseTo(0.5);
    expect(c.y1).toBeCloseTo(0);
    expect(c.x2).toBeCloseTo(0.5);
    expect(c.y2).toBeCloseTo(1);
  });

  it('round-trips an angle', () => {
    expect(
      linearCoordsToAngle({ type: 'linear', ...angleToLinearCoords(135), stops: [] }),
    ).toBeCloseTo(135);
  });
});
