import { describe, expect, it } from 'vitest';
import { closestArcLength, hintedPair, HINT_SAMPLES, keptHints, snapToOutline } from './hints';
import { flattenPath } from '../geom/arcLength';
import { bakeShapeTween, rebakeLayerTweens, shapeHintStatus, shapeTweenOutlines } from '../frameTween';
import { createFrameLayer, createSceneObject, createVectorAsset } from '../project';
import { samplePath } from '../path';
import type { Asset, PathData, PathPoint } from '../types';

const square = (x: number, y: number, s: number): PathData => ({
  closed: true,
  nodes: [{ anchor: { x, y } }, { anchor: { x: x + s, y } }, { anchor: { x: x + s, y: y + s } }, { anchor: { x, y: y + s } }],
});
const near = (p: PathPoint, q: PathPoint, tol = 1e-6) => Math.hypot(p.x - q.x, p.y - q.y) < tol;

describe('closestArcLength', () => {
  it('projects onto the outline', () => {
    const f = flattenPath(square(0, 0, 10));
    expect(closestArcLength(f, { x: 5, y: -3 })).toEqual({ s: 5, d: 3 });
    expect(closestArcLength(f, { x: 13, y: 5 }).s).toBeCloseTo(15);
  });
});

describe('hintedPair', () => {
  it('lines the hint spots up and keeps equal node counts', () => {
    const a = square(0, 0, 100);
    const b = square(200, 0, 100);
    // Pin A's top-left corner to B's bottom-right corner (a half-turn), and A's top-right to B's bottom-left.
    const r = hintedPair(a, b, [
      { a: { x: 0, y: 0 }, b: { x: 300, y: 100 } },
      { a: { x: 100, y: 0 }, b: { x: 200, y: 100 } },
    ])!;
    expect(r.a.nodes.length).toBe(r.b.nodes.length);
    expect(r.a.nodes.length).toBe(HINT_SAMPLES);
    const i = r.a.nodes.findIndex((n) => near(n.anchor, { x: 0, y: 0 }));
    expect(i).toBeGreaterThanOrEqual(0);
    expect(near(r.b.nodes[i].anchor, { x: 300, y: 100 })).toBe(true);
    const j = r.a.nodes.findIndex((n) => near(n.anchor, { x: 100, y: 0 }));
    expect(near(r.b.nodes[j].anchor, { x: 200, y: 100 })).toBe(true);
    // Every node lies on its outline.
    for (const n of r.a.nodes) expect(closestArcLength(flattenPath(a), n.anchor).d).toBeLessThan(1e-6);
  });

  it('drops hints whose order disagrees (they would cross the morph)', () => {
    const a = square(0, 0, 100);
    const b = square(0, 0, 100);
    const crossed = hintedPair(a, b, [
      { a: { x: 0, y: 0 }, b: { x: 0, y: 0 } },
      { a: { x: 100, y: 0 }, b: { x: 100, y: 0 } },
      { a: { x: 100, y: 100 }, b: { x: 100, y: 100 } },
      { a: { x: 0, y: 100 }, b: { x: 0, y: 100 } },
      { a: { x: 50, y: 0 }, b: { x: 50, y: 100 } }, // jumps across: would twist the morph
    ])!;
    // The four agreeing corners win; the crossing hint is dropped, so A's top middle stays put.
    const j = crossed.a.nodes.findIndex((n) => near(n.anchor, { x: 50, y: 0 }, 1e-3));
    expect(j).toBeGreaterThanOrEqual(0);
    expect(near(crossed.b.nodes[j].anchor, { x: 50, y: 0 }, 1e-3)).toBe(true);
  });

  it('works on open paths (ends stay ends)', () => {
    const a: PathData = { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }] };
    const b: PathData = { closed: false, nodes: [{ anchor: { x: 0, y: 50 } }, { anchor: { x: 100, y: 50 } }] };
    const r = hintedPair(a, b, [{ a: { x: 20, y: 0 }, b: { x: 80, y: 50 } }])!;
    expect(near(r.a.nodes[0].anchor, { x: 0, y: 0 })).toBe(true);
    expect(near(r.b.nodes[r.b.nodes.length - 1].anchor, { x: 100, y: 50 })).toBe(true);
    const i = r.a.nodes.findIndex((n) => near(n.anchor, { x: 20, y: 0 }));
    expect(near(r.b.nodes[i].anchor, { x: 80, y: 50 })).toBe(true);
  });

  it('returns null without hints or when one outline is open and the other closed', () => {
    expect(hintedPair(square(0, 0, 1), square(0, 0, 1), [])).toBeNull();
    expect(hintedPair(square(0, 0, 1), { ...square(0, 0, 1), closed: false }, [{ a: { x: 0, y: 0 }, b: { x: 0, y: 0 } }])).toBeNull();
  });
});

describe('shape tween with hints', () => {
  const pathAsset = (id: string, path: PathData) => createVectorAsset('path', { id, path, style: { fill: '#ff0000', stroke: 'none', strokeWidth: 0 } });
  function scene() {
    const L = createFrameLayer({ id: 'L', zOrder: 0, keys: [{ id: 'k1', time: 0 }, { id: 'k2', time: 1 }], end: 2 });
    const at = (id: string, assetId: string, key: string) =>
      createSceneObject(assetId, { id, parentId: 'L', frameKeyId: key, zOrder: 1, anchorMode: 'fraction', base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
    return {
      objects: [L, at('a', 'pa', 'k1'), at('b', 'pb', 'k2')],
      assets: [pathAsset('pa', square(0, 0, 100)), pathAsset('pb', square(0, 0, 100))] as Asset[],
    };
  }
  const hints = [{ a: { x: 0, y: 0 }, b: { x: 100, y: 100 } }, { a: { x: 100, y: 100 }, b: { x: 0, y: 0 } }];

  it('bakes the hinted correspondence and records the hints on the key', () => {
    const { objects, assets } = scene();
    const r = bakeShapeTween(objects, assets, 'L', 'k1', { hints });
    if ('error' in r) throw new Error(r.error);
    expect(r.tween.hints).toEqual(hints);
    const a = r.objects.find((o) => o.id === 'a')!;
    const start = samplePath(a.shapeTrack!, 0);
    const end = samplePath(a.shapeTrack!, 1);
    expect(start.nodes.length).toBe(end.nodes.length);
    const i = start.nodes.findIndex((n) => near(n.anchor, { x: 0, y: 0 }));
    expect(near(end.nodes[i].anchor, { x: 100, y: 100 })).toBe(true); // a half-turn, not the identity
    // Re-bakes (F5 etc.) keep the hints.
    const again = rebakeLayerTweens(r.objects, r.assets, 'L');
    const key = again.objects.find((o) => o.id === 'L')!.frames!.keys[0];
    expect(key.tween!.hints).toEqual(hints);
  });

  it('without hints the bake is unchanged (parity)', () => {
    const { objects, assets } = scene();
    const r = bakeShapeTween(objects, assets, 'L', 'k1', {});
    if ('error' in r) throw new Error(r.error);
    expect(r.tween.hints).toBeUndefined();
    expect(samplePath(r.objects.find((o) => o.id === 'a')!.shapeTrack!, 0).nodes).toHaveLength(4);
  });

  it('shapeTweenOutlines / shapeHintStatus describe the baked tween for the editor', () => {
    const { objects, assets } = scene();
    expect(shapeTweenOutlines(objects, 'L', 'k1')).toEqual([]);
    const corners = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    const crossing = [...corners.map((c) => ({ a: c, b: c })), { a: { x: 50, y: 0 }, b: { x: 50, y: 100 } }];
    const r = bakeShapeTween(objects, assets, 'L', 'k1', { hints: crossing });
    if ('error' in r) throw new Error(r.error);
    const pairs = shapeTweenOutlines(r.objects, 'L', 'k1');
    expect(pairs).toHaveLength(1);
    expect(pairs[0].from.nodes.length).toBe(pairs[0].to.nodes.length);
    expect(shapeHintStatus(r.objects, 'L', 'k1', crossing)).toEqual([true, true, true, true, false]);
  });
});

describe('re-bake stability', () => {
  it('keeps the corners of both outlines and does not erode on repeated re-bakes', () => {
    const a = square(0, 0, 100);
    const b = square(200, 0, 100);
    const hs = [{ a: { x: 30, y: 0 }, b: { x: 270, y: 100 } }];
    const corners = (p: PathData, ox: number) => [{ x: ox, y: 0 }, { x: ox + 100, y: 0 }, { x: ox + 100, y: 100 }, { x: ox, y: 100 }].every((c) => p.nodes.some((n) => near(n.anchor, c, 1e-6)));
    let pair = hintedPair(a, b, hs)!;
    expect(corners(pair.a, 0)).toBe(true);
    expect(corners(pair.b, 200)).toBe(true);
    // Move the hint and re-bake from the resampled start outline, several times.
    for (let k = 0; k < 6; k++) {
      const h = [{ a: { x: 10 + k * 13, y: 0 }, b: { x: 270 - k * 7, y: 100 } }];
      pair = hintedPair(pair.a, b, h)!;
      expect(pair.a.nodes.length).toBe(HINT_SAMPLES);
      expect(corners(pair.a, 0)).toBe(true);
    }
  });
});

describe('keptHints / snapToOutline', () => {
  it('flags the crossing hint and snaps points onto the outline', () => {
    const a = square(0, 0, 100);
    const hs = [
      { a: { x: 0, y: 0 }, b: { x: 0, y: 0 } },
      { a: { x: 100, y: 0 }, b: { x: 100, y: 0 } },
      { a: { x: 100, y: 100 }, b: { x: 100, y: 100 } },
      { a: { x: 0, y: 100 }, b: { x: 0, y: 100 } },
      { a: { x: 50, y: 0 }, b: { x: 50, y: 100 } },
    ];
    expect(keptHints(a, a, hs)).toEqual([true, true, true, true, false]);
    expect(keptHints(a, { ...a, closed: false }, hs).every((k) => !k)).toBe(true);
    expect(near(snapToOutline(a, { x: 40, y: -7 }), { x: 40, y: 0 })).toBe(true);
    expect(near(snapToOutline(a, { x: 60, y: 45 }), { x: 60, y: 0 }) || near(snapToOutline(a, { x: 60, y: 45 }), { x: 100, y: 45 })).toBe(true);
  });
});
