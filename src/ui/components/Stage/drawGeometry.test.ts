import { describe, expect, it } from 'vitest';
import { rectFromDrag, primitivePathFromDrag, primitiveSpecFromDrag } from './drawGeometry';
import { pathToD } from '../../../engine';

describe('rectFromDrag', () => {
  it('builds bounds from a top-left to bottom-right drag', () => {
    expect(rectFromDrag({ x: 10, y: 20 }, { x: 110, y: 70 }, 3)).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it('normalizes a bottom-right to top-left (negative) drag', () => {
    expect(rectFromDrag({ x: 110, y: 70 }, { x: 10, y: 20 }, 3)).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it('returns null for a sub-threshold drag', () => {
    expect(rectFromDrag({ x: 10, y: 10 }, { x: 11, y: 11 }, 3)).toBeNull();
  });
});

const OPTS = { polygonSides: 6, starPoints: 5, starInnerRatio: 0.5, cornerRadius: 0 };

describe('primitivePathFromDrag', () => {
  it('builds a polygon centered at start with radius = drag distance', () => {
    const p = primitivePathFromDrag('polygon', { x: 0, y: 0 }, { x: 0, y: 10 }, OPTS, 3);
    expect(p).not.toBeNull();
    expect(p!.nodes).toHaveLength(6);
    expect(p!.closed).toBe(true);
    expect(p!.nodes.every((n) => Math.abs(Math.hypot(n.anchor.x, n.anchor.y) - 10) < 1e-6)).toBe(true);
  });

  it('builds a star with 2*points nodes and inner = radius*ratio', () => {
    const p = primitivePathFromDrag('star', { x: 0, y: 0 }, { x: 10, y: 0 }, OPTS, 3);
    expect(p!.nodes).toHaveLength(10);
    const radii = p!.nodes.map((n) => Math.hypot(n.anchor.x, n.anchor.y));
    expect(Math.max(...radii)).toBeCloseTo(10, 6);
    expect(Math.min(...radii)).toBeCloseTo(5, 6);
  });

  it('builds an open two-node line', () => {
    const p = primitivePathFromDrag('line', { x: 1, y: 2 }, { x: 9, y: 4 }, OPTS, 3);
    expect(p!.closed).toBe(false);
    expect(p!.nodes).toHaveLength(2);
    expect(p!.nodes[0].anchor).toEqual({ x: 1, y: 2 });
    expect(p!.nodes[1].anchor).toEqual({ x: 9, y: 4 });
  });

  it('returns null for a sub-threshold drag', () => {
    expect(primitivePathFromDrag('polygon', { x: 0, y: 0 }, { x: 1, y: 1 }, OPTS, 3)).toBeNull();
    expect(primitivePathFromDrag('line', { x: 0, y: 0 }, { x: 1, y: 1 }, OPTS, 3)).toBeNull();
  });

  it('rounds polygon corners when cornerRadius > 0', () => {
    const sharp = primitivePathFromDrag('polygon', { x: 0, y: 0 }, { x: 0, y: 50 }, OPTS, 4);
    const round = primitivePathFromDrag('polygon', { x: 0, y: 0 }, { x: 0, y: 50 }, { ...OPTS, cornerRadius: 8 }, 4);
    expect(pathToD(sharp!)).not.toContain('C');
    expect(pathToD(round!)).toContain('C'); // rounded -> cubic segments
  });
});

describe('primitiveSpecFromDrag', () => {
  const OPTS = { polygonSides: 6, starPoints: 5, starInnerRatio: 0.5, cornerRadius: 4 };
  it('builds a stage-frame polygon spec (center=start, radius=drag distance)', () => {
    const spec = primitiveSpecFromDrag('polygon', { x: 10, y: 10 }, { x: 10, y: 60 }, OPTS, 3);
    expect(spec).toMatchObject({ kind: 'polygon', cx: 10, cy: 10, sides: 6, cornerRadius: 4 });
    expect(spec!.radius).toBeCloseTo(50);
  });
  it('builds a star spec carrying points + inner ratio', () => {
    const spec = primitiveSpecFromDrag('star', { x: 0, y: 0 }, { x: 30, y: 0 }, OPTS, 3);
    expect(spec).toMatchObject({ kind: 'star', points: 5, innerRatio: 0.5 });
  });
  it('returns null for a sub-threshold drag', () => {
    expect(primitiveSpecFromDrag('polygon', { x: 0, y: 0 }, { x: 1, y: 1 }, OPTS, 3)).toBeNull();
  });
});
