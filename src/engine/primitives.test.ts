import { describe, it, expect } from 'vitest';
import { polygonPath, starPath, linePath } from './primitives';

describe('polygonPath', () => {
  it('produces `sides` closed corner nodes', () => {
    const p = polygonPath(0, 0, 10, 5);
    expect(p.nodes).toHaveLength(5);
    expect(p.closed).toBe(true);
    expect(p.nodes.every((n) => n.in === undefined && n.out === undefined)).toBe(true);
  });

  it('places the first vertex straight up (−90°)', () => {
    const p = polygonPath(0, 0, 10, 4);
    expect(p.nodes[0].anchor.x).toBeCloseTo(0, 6);
    expect(p.nodes[0].anchor.y).toBeCloseTo(-10, 6);
  });

  it('lays a square out clockwise in SVG space', () => {
    const p = polygonPath(0, 0, 10, 4); // up, right, down, left
    expect(p.nodes[1].anchor.x).toBeCloseTo(10, 6);
    expect(p.nodes[1].anchor.y).toBeCloseTo(0, 6);
    expect(p.nodes[2].anchor.y).toBeCloseTo(10, 6);
    expect(p.nodes[3].anchor.x).toBeCloseTo(-10, 6);
  });

  it('honors center and rotation', () => {
    const p = polygonPath(100, 50, 10, 4, Math.PI / 2); // +90° → first vertex points right
    expect(p.nodes[0].anchor.x).toBeCloseTo(110, 6);
    expect(p.nodes[0].anchor.y).toBeCloseTo(50, 6);
  });

  it('clamps sides to at least 3', () => {
    expect(polygonPath(0, 0, 10, 2).nodes).toHaveLength(3);
    expect(polygonPath(0, 0, 10, 0).nodes).toHaveLength(3);
  });
});

describe('starPath', () => {
  it('produces 2*points closed corner nodes alternating radius', () => {
    const p = starPath(0, 0, 10, 4, 5);
    expect(p.nodes).toHaveLength(10);
    expect(p.closed).toBe(true);
    expect(p.nodes.every((n) => n.in === undefined && n.out === undefined)).toBe(true);
    // even indices = outer radius (10), odd = inner radius (4)
    const r = (i: number) => Math.hypot(p.nodes[i].anchor.x, p.nodes[i].anchor.y);
    expect(r(0)).toBeCloseTo(10, 6);
    expect(r(1)).toBeCloseTo(4, 6);
    expect(r(2)).toBeCloseTo(10, 6);
  });

  it('places the first outer vertex straight up', () => {
    const p = starPath(0, 0, 10, 4, 5);
    expect(p.nodes[0].anchor.x).toBeCloseTo(0, 6);
    expect(p.nodes[0].anchor.y).toBeCloseTo(-10, 6);
  });

  it('clamps points to at least 2', () => {
    expect(starPath(0, 0, 10, 4, 1).nodes).toHaveLength(4);
  });
});

describe('linePath', () => {
  it('produces an open two-node corner path', () => {
    const p = linePath({ x: 1, y: 2 }, { x: 9, y: 4 });
    expect(p.closed).toBe(false);
    expect(p.nodes).toHaveLength(2);
    expect(p.nodes[0].anchor).toEqual({ x: 1, y: 2 });
    expect(p.nodes[1].anchor).toEqual({ x: 9, y: 4 });
    expect(p.nodes.every((n) => n.in === undefined && n.out === undefined)).toBe(true);
  });
});
