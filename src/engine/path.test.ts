import { describe, it, expect } from 'vitest';
import { pathToD, pathBounds, samplePath } from './path';
import type { PathData, ShapeKeyframe } from './types';
import { applyEasing } from './easing';

describe('pathToD', () => {
  it('serializes a straight open path (corners) as M/L', () => {
    const p: PathData = {
      nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }],
      closed: false,
    };
    expect(pathToD(p)).toBe('M 0 0 L 10 0');
  });

  it('closes a path with Z', () => {
    const p: PathData = {
      nodes: [
        { anchor: { x: 0, y: 0 } },
        { anchor: { x: 10, y: 0 } },
        { anchor: { x: 10, y: 10 } },
      ],
      closed: true,
    };
    expect(pathToD(p)).toBe('M 0 0 L 10 0 L 10 10 Z');
  });

  it('emits a cubic C using out of the previous node and in of the current node', () => {
    const p: PathData = {
      nodes: [
        { anchor: { x: 0, y: 0 }, out: { x: 5, y: 0 } },
        { anchor: { x: 10, y: 10 }, in: { x: 0, y: -5 } },
      ],
      closed: false,
    };
    // c1 = prev.anchor + prev.out = (5,0); c2 = cur.anchor + cur.in = (10,5)
    expect(pathToD(p)).toBe('M 0 0 C 5 0 10 5 10 10');
  });

  it('emits a closing cubic segment back to the first node when closed', () => {
    const p: PathData = {
      nodes: [
        { anchor: { x: 0, y: 0 }, in: { x: -2, y: 0 }, out: { x: 2, y: 0 } },
        { anchor: { x: 10, y: 0 }, in: { x: -2, y: 0 }, out: { x: 2, y: 0 } },
      ],
      closed: true,
    };
    // segment 0->1: C (2 0) (8 0) (10 0); closing 1->0: C (12 0) (-2 0) (0 0) Z
    expect(pathToD(p)).toBe('M 0 0 C 2 0 8 0 10 0 C 12 0 -2 0 0 0 Z');
  });

  it('returns empty string for an empty path', () => {
    expect(pathToD({ nodes: [], closed: false })).toBe('');
  });
});

describe('pathBounds', () => {
  it('returns the anchor-point bounding box including a non-zero min', () => {
    const p: PathData = {
      nodes: [{ anchor: { x: 4, y: 6 } }, { anchor: { x: 14, y: 26 } }],
      closed: false,
    };
    expect(pathBounds(p)).toEqual({ x: 4, y: 6, width: 10, height: 20 });
  });

  it('returns a zero box for an empty path', () => {
    expect(pathBounds({ nodes: [], closed: false })).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe('samplePath', () => {
  const square = (s: number): ShapeKeyframe => ({
    time: 0,
    easing: 'linear',
    path: { closed: true, nodes: [
      { anchor: { x: 0, y: 0 } },
      { anchor: { x: s, y: 0 } },
      { anchor: { x: s, y: s } },
      { anchor: { x: 0, y: s } },
    ] },
  });

  it('throws on an empty track', () => {
    expect(() => samplePath([], 0)).toThrow();
  });

  it('returns the lone snapshot for a single-keyframe track (static)', () => {
    const k = square(10);
    expect(samplePath([k], 5).nodes[1].anchor.x).toBe(10);
  });

  it('clamps before the first and after the last keyframe', () => {
    const a = { ...square(10), time: 1 };
    const b = { ...square(20), time: 3 };
    expect(samplePath([a, b], 0).nodes[1].anchor.x).toBe(10);
    expect(samplePath([a, b], 9).nodes[1].anchor.x).toBe(20);
  });

  it('linearly interpolates matched anchors at the midpoint', () => {
    const a = { ...square(10), time: 0 };
    const b = { ...square(20), time: 2 };
    expect(samplePath([a, b], 1).nodes[2].anchor).toEqual({ x: 15, y: 15 });
  });

  it('applies the FROM keyframe easing', () => {
    const a: ShapeKeyframe = { ...square(0), time: 0, easing: 'easeIn' };
    const b: ShapeKeyframe = { ...square(10), time: 1 };
    expect(samplePath([a, b], 0.5).nodes[1].anchor.x).toBeLessThan(5);
  });

  it('holds `closed` from the FROM keyframe (no midpoint flip)', () => {
    const a: ShapeKeyframe = { ...square(10), time: 0, path: { ...square(10).path, closed: false } };
    const b: ShapeKeyframe = { ...square(10), time: 1, path: { ...square(10).path, closed: true } };
    expect(samplePath([a, b], 0.5).closed).toBe(false);
  });

  it('pads the shorter keyframe: extra nodes grow out of the last shared anchor', () => {
    const a: ShapeKeyframe = { time: 0, easing: 'linear', path: { closed: false, nodes: [
      { anchor: { x: 0, y: 0 } },
      { anchor: { x: 10, y: 0 } },
    ] } };
    const b: ShapeKeyframe = { time: 1, easing: 'linear', path: { closed: false, nodes: [
      { anchor: { x: 0, y: 0 } },
      { anchor: { x: 10, y: 0 } },
      { anchor: { x: 20, y: 0 } },
    ] } };
    const out = samplePath([a, b], 0.5);
    expect(out.nodes).toHaveLength(3);
    expect(out.nodes[2].anchor).toEqual({ x: 15, y: 0 });
  });

  it('grows a handle from a corner (absent => zero offset)', () => {
    const a: ShapeKeyframe = { time: 0, easing: 'linear', path: { closed: false, nodes: [
      { anchor: { x: 0, y: 0 } },
      { anchor: { x: 10, y: 0 } },
    ] } };
    const b: ShapeKeyframe = { time: 1, easing: 'linear', path: { closed: false, nodes: [
      { anchor: { x: 0, y: 0 }, out: { x: 4, y: 0 } },
      { anchor: { x: 10, y: 0 } },
    ] } };
    expect(samplePath([a, b], 0.5).nodes[0].out).toEqual({ x: 2, y: 0 });
  });

  it('keeps a corner when both keyframes lack the handle', () => {
    const a: ShapeKeyframe = { time: 0, easing: 'linear', path: { closed: false, nodes: [
      { anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } },
    ] } };
    const b: ShapeKeyframe = { time: 1, easing: 'linear', path: { closed: false, nodes: [
      { anchor: { x: 0, y: 0 } }, { anchor: { x: 20, y: 0 } },
    ] } };
    expect(samplePath([a, b], 0.5).nodes[0].out).toBeUndefined();
    expect(samplePath([a, b], 0.5).nodes[0].in).toBeUndefined();
  });

  it('does not mutate its inputs', () => {
    const a = { ...square(10), time: 0 };
    const b = { ...square(20), time: 1 };
    const snapshot = JSON.stringify([a, b]);
    samplePath([a, b], 0.5);
    expect(JSON.stringify([a, b])).toBe(snapshot);
  });
});

describe('samplePath resampled', () => {
  const a: PathData = { nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 10, y: 10 } }], closed: true };
  const b: PathData = { nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 20, y: 0 } }], closed: true };

  it('produces a fixed-resolution point set between resampled keyframes', () => {
    const track: ShapeKeyframe[] = [
      { time: 0, path: a, easing: 'linear', morph: 'resampled' },
      { time: 1, path: b, easing: 'linear' },
    ];
    expect(samplePath(track, 0.5).nodes.length).toBe(64);
  });

  it('clamp returns the real (un-resampled) path at the endpoints', () => {
    const track: ShapeKeyframe[] = [
      { time: 0, path: a, easing: 'linear', morph: 'resampled' },
      { time: 1, path: b, easing: 'linear' },
    ];
    expect(samplePath(track, 0).nodes.length).toBe(a.nodes.length); // clamp -> first.path
    expect(samplePath(track, 1).nodes.length).toBe(b.nodes.length); // clamp -> last.path
  });

  it('without morph:resampled, behaves exactly as before (index-pad)', () => {
    const track: ShapeKeyframe[] = [
      { time: 0, path: a, easing: 'linear' },
      { time: 1, path: b, easing: 'linear' },
    ];
    expect(samplePath(track, 0.5).nodes.length).toBe(Math.max(a.nodes.length, b.nodes.length));
  });
});

describe('samplePath per-node easing', () => {
  // Two-node open path, A -> B over [0,2]. Node 0 easeIn, node 1 linear.
  const A: PathData = { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 0, y: 0 } }] };
  const B: PathData = { closed: false, nodes: [{ anchor: { x: 10, y: 0 } }, { anchor: { x: 10, y: 0 } }] };

  it('eases each node with its own t; endpoints stay exact', () => {
    const track: ShapeKeyframe[] = [
      { time: 0, easing: 'linear', nodeEasings: ['easeIn', 'linear'], path: A },
      { time: 2, easing: 'linear', path: B },
    ];
    const mid = samplePath(track, 1); // rawProgress 0.5
    expect(mid.nodes[0].anchor.x).toBeCloseTo(10 * applyEasing('easeIn', 0.5), 6);
    expect(mid.nodes[1].anchor.x).toBeCloseTo(10 * 0.5, 6);
    expect(mid.nodes[0].anchor.x).not.toBeCloseTo(mid.nodes[1].anchor.x, 4);
    expect(samplePath(track, 0)).toEqual(A);
    expect(samplePath(track, 2)).toEqual(B);
  });

  it('a hole / -1 pair falls back to the keyframe easing', () => {
    const track: ShapeKeyframe[] = [
      { time: 0, easing: 'linear', nodeEasings: [undefined as unknown as 'linear', 'easeIn'], path: A },
      { time: 2, easing: 'linear', path: B },
    ];
    const mid = samplePath(track, 1);
    expect(mid.nodes[0].anchor.x).toBeCloseTo(5, 6); // linear fallback
    expect(mid.nodes[1].anchor.x).toBeCloseTo(10 * applyEasing('easeIn', 0.5), 6);
  });

  it('absent nodeEasings is byte-identical to a single-easing morph', () => {
    const plain: ShapeKeyframe[] = [
      { time: 0, easing: 'easeIn', path: A },
      { time: 2, easing: 'linear', path: B },
    ];
    const mid = samplePath(plain, 1);
    expect(mid.nodes[0].anchor.x).toBeCloseTo(mid.nodes[1].anchor.x, 9);
    expect(mid.nodes[0].anchor.x).toBeCloseTo(10 * applyEasing('easeIn', 0.5), 6);
  });
});
