import { describe, it, expect } from 'vitest';
import { brushParams, strokeToPath } from './brush';

describe('brushParams', () => {
  it('clamps to [0,1] and is monotonic in tolerance', () => {
    expect(brushParams(-1).tolerance).toBe(brushParams(0).tolerance);
    expect(brushParams(2).tolerance).toBe(brushParams(1).tolerance);
    expect(brushParams(1).tolerance).toBeGreaterThan(brushParams(0).tolerance);
    expect(brushParams(0).tolerance).toBeGreaterThan(0); // always some cleanup
  });
});

describe('strokeToPath', () => {
  const line = (n: number) => Array.from({ length: n }, (_, i) => ({ x: i, y: 0 }));

  it('returns an empty open path for fewer than 2 distinct points', () => {
    expect(strokeToPath([], brushParams(0.5))).toEqual({ nodes: [], closed: false });
    expect(strokeToPath([{ x: 1, y: 1 }, { x: 1, y: 1 }], brushParams(0.5)))
      .toEqual({ nodes: [], closed: false });
  });

  it('collapses a straight drag to a 2-node corner path', () => {
    const path = strokeToPath(line(10), brushParams(0.5));
    expect(path.closed).toBe(false);
    expect(path.nodes).toHaveLength(2);
    expect(path.nodes[0].in).toBeUndefined();
    expect(path.nodes[0].out).toBeUndefined();
  });

  it('produces smooth nodes (in == -out) on a curved stroke at default smoothing', () => {
    const pts = [
      { x: 0, y: 0 }, { x: 10, y: 20 }, { x: 20, y: 0 }, { x: 30, y: 20 }, { x: 40, y: 0 },
    ];
    const path = strokeToPath(pts, brushParams(0.5));
    expect(path.closed).toBe(false);
    expect(path.nodes.length).toBeGreaterThanOrEqual(3);
    const mid = path.nodes[1];
    expect(mid.in).toBeDefined();
    expect(mid.out).toBeDefined();
    expect(mid.in!.x).toBeCloseTo(0 - mid.out!.x);
    expect(mid.in!.y).toBeCloseTo(0 - mid.out!.y);
  });

  it('emits corner nodes (no handles) when smoothing is 0', () => {
    const pts = [
      { x: 0, y: 0 }, { x: 10, y: 20 }, { x: 20, y: 0 }, { x: 30, y: 20 }, { x: 40, y: 0 },
    ];
    const path = strokeToPath(pts, brushParams(0));
    for (const n of path.nodes) {
      expect(n.in).toBeUndefined();
      expect(n.out).toBeUndefined();
    }
  });

  it('is deterministic', () => {
    const pts = [{ x: 0, y: 0 }, { x: 5, y: 9 }, { x: 12, y: 3 }, { x: 20, y: 14 }];
    expect(strokeToPath(pts, brushParams(0.6))).toEqual(strokeToPath(pts, brushParams(0.6)));
  });
});
