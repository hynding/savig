import { describe, it, expect } from 'vitest';
import { shapeLocalBBox } from './gradientHandles';
import type { PathData } from './types';

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
