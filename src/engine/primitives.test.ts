import { describe, it, expect } from 'vitest';
import { polygonPath, starPath, linePath, roundCorners } from './primitives';
import type { PathData } from './types';

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

describe('roundCorners', () => {
  const square: PathData = {
    nodes: [
      { anchor: { x: 0, y: 0 } },
      { anchor: { x: 100, y: 0 } },
      { anchor: { x: 100, y: 100 } },
      { anchor: { x: 0, y: 100 } },
    ],
    closed: true,
  };

  it('radius 0 returns the sharp path unchanged', () => {
    expect(roundCorners(square, 0)).toEqual(square);
  });

  it('fillets a square corner with circular-arc tangent points and handles', () => {
    const r = 20;
    const h = (4 / 3) * 20 * Math.tan(Math.PI / 8); // 90deg corner -> kappa*R
    const out = roundCorners(square, r);
    expect(out.nodes).toHaveLength(8);
    expect(out.closed).toBe(true);
    // Corner (0,0): prev (0,100) -> A on that edge; next (100,0) -> B on that edge.
    const a = out.nodes[0];
    const b = out.nodes[1];
    expect(a.anchor.x).toBeCloseTo(0);
    expect(a.anchor.y).toBeCloseTo(20);
    expect(a.out!.x).toBeCloseTo(0);
    expect(a.out!.y).toBeCloseTo(-h);
    expect(b.anchor.x).toBeCloseTo(20);
    expect(b.anchor.y).toBeCloseTo(0);
    expect(b.in!.x).toBeCloseTo(-h);
    expect(b.in!.y).toBeCloseTo(0);
  });

  it('clamps an over-large radius to the half-edge (no overlap)', () => {
    const out = roundCorners(square, 1000);
    // t clamped to 50 (half of the 100 edge); A on the (0,0)->(0,100) edge at y=50.
    expect(out.nodes[0].anchor.y).toBeCloseTo(50);
  });
});

describe('polygonPath / starPath cornerRadius', () => {
  it('polygonPath with cornerRadius 0 is byte-identical to the sharp polygon', () => {
    expect(polygonPath(0, 0, 50, 5, 0, 0)).toEqual(polygonPath(0, 0, 50, 5, 0));
  });
  it('polygonPath with cornerRadius > 0 produces handles (a rounded path)', () => {
    const p = polygonPath(0, 0, 50, 5, 0, 8);
    expect(p.nodes).toHaveLength(10); // 2 per corner
    expect(p.nodes.some((n) => n.out || n.in)).toBe(true);
  });
  it('starPath with cornerRadius rounds inner + outer vertices', () => {
    const s = starPath(0, 0, 50, 25, 5, 0, 5);
    expect(s.nodes).toHaveLength(20); // 2 * (2 * points)
  });
});
