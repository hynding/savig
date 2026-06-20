import { describe, expect, it } from 'vitest';
import { geometryToSvgAttrs, renderShapeToSvg } from './renderShape';

describe('geometryToSvgAttrs', () => {
  it('maps rect width/height with x/y pinned at 0', () => {
    expect(geometryToSvgAttrs('rect', { width: 120, height: 80 })).toEqual({
      x: '0',
      y: '0',
      width: '120',
      height: '80',
    });
  });

  it('maps rect cornerRadius to rx/ry', () => {
    expect(geometryToSvgAttrs('rect', { width: 10, height: 10, cornerRadius: 4 })).toEqual({
      x: '0',
      y: '0',
      width: '10',
      height: '10',
      rx: '4',
      ry: '4',
    });
  });

  it('maps ellipse radii to cx/cy/rx/ry so it sits in the local box', () => {
    expect(geometryToSvgAttrs('ellipse', { radiusX: 30, radiusY: 20 })).toEqual({
      cx: '30',
      cy: '20',
      rx: '30',
      ry: '20',
    });
  });

  it('clamps negative dimensions to 0', () => {
    expect(geometryToSvgAttrs('rect', { width: -5, height: 10 }).width).toBe('0');
  });
});

describe('renderShapeToSvg', () => {
  it('renders a styled rect deterministically (geometry then style)', () => {
    expect(
      renderShapeToSvg('rect', { width: 100, height: 50 }, { fill: '#f00', stroke: 'none', strokeWidth: 0 }),
    ).toBe('<rect x="0" y="0" width="100" height="50" fill="#f00" stroke="none" stroke-width="0"/>');
  });

  it('renders an ellipse', () => {
    expect(
      renderShapeToSvg('ellipse', { radiusX: 30, radiusY: 20 }, { fill: 'none', stroke: '#000', strokeWidth: 2 }),
    ).toBe('<ellipse cx="30" cy="20" rx="30" ry="20" fill="none" stroke="#000" stroke-width="2"/>');
  });
});
