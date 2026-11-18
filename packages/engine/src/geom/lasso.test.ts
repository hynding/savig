import { describe, expect, it } from 'vitest';
import { applyLassoCut, lassoArea, lassoTouchesBox } from './lasso';
import { multiPolygonArea } from './paintBucket';
import { createProject, createSceneObject, createVectorAsset } from '../project';
import type { PathPoint, Project, SceneObject, VectorAsset } from '../types';

const rectLoop = (x0: number, y0: number, x1: number, y1: number): PathPoint[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

function withRect(extra: Partial<SceneObject> = {}): Project {
  const p = createProject();
  p.assets.push(createVectorAsset('rect', { id: 'va', style: { fill: '#ff0000', stroke: '#000000', strokeWidth: 2 } }));
  p.objects.push(createSceneObject('va', { id: 'r', name: 'Box', zOrder: 0, shapeBase: { width: 100, height: 100 }, ...extra }));
  p.assets.push(createVectorAsset('rect', { id: 'vb' }));
  p.objects.push(createSceneObject('vb', { id: 'top', zOrder: 1, shapeBase: { width: 10, height: 10 }, base: { x: 500, y: 500, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } }));
  return p;
}
const areaOf = (p: Project, id: string) => {
  const o = p.objects.find((x) => x.id === id)!;
  const a = p.assets.find((x) => x.id === o.assetId) as VectorAsset;
  const ring = a.path!.nodes.map((n) => [n.anchor.x, n.anchor.y] as [number, number]);
  return multiPolygonArea([[[...ring, ring[0]]]]);
};

describe('lassoArea / lassoTouchesBox', () => {
  it('needs three distinct points and some area', () => {
    expect(lassoArea([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toEqual([]);
    expect(lassoArea([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }])).toEqual([]);
    expect(multiPolygonArea(lassoArea(rectLoop(0, 0, 10, 10)))).toBeCloseTo(100);
  });

  it('touches a box it overlaps, even a flat one', () => {
    const loop = lassoArea(rectLoop(0, 0, 10, 10));
    expect(lassoTouchesBox(loop, { minX: 5, minY: 5, maxX: 20, maxY: 20 })).toBe(true);
    expect(lassoTouchesBox(loop, { minX: 2, minY: 5, maxX: 8, maxY: 5 })).toBe(true);
    expect(lassoTouchesBox(loop, { minX: 11, minY: 11, maxX: 20, maxY: 20 })).toBe(false);
  });
});

describe('applyLassoCut', () => {
  it('cuts the looped half of a rect into a drawing of its own, right above it', () => {
    const p = withRect();
    let n = 0;
    const r = applyLassoCut(p, 'r', rectLoop(-10, -10, 50, 110), 0, { newId: () => `n${++n}` });
    if ('refused' in r) throw new Error(r.refused);
    const next = { ...p, objects: r.objects, assets: r.assets };
    const piece = next.objects.find((o) => o.id === r.insideId)!;
    expect(piece.name).toBe('Box piece');
    expect(areaOf(next, 'r')).toBeCloseTo(5000);
    expect(areaOf(next, r.insideId)).toBeCloseTo(5000);
    const kept = next.objects.find((o) => o.id === 'r')!;
    expect(next.assets.find((a) => a.id === kept.assetId)).toMatchObject({ shapeType: 'path', style: { fill: '#ff0000', stroke: '#000000' } });
    // drawing order: original, piece, then what was above
    const order = [...next.objects].sort((a, b) => a.zOrder - b.zOrder).map((o) => o.id);
    expect(order).toEqual(['r', r.insideId, 'top']);
    expect(piece).toMatchObject({ anchorMode: 'absolute', anchorX: kept.anchorX, anchorY: kept.anchorY });
  });

  it('cuts a stroke-only line through its stroke outline', () => {
    const p = createProject();
    p.assets.push(createVectorAsset('path', { id: 'va', path: { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }] }, style: { fill: 'none', stroke: '#00f', strokeWidth: 10 } }));
    p.objects.push(createSceneObject('va', { id: 'l', anchorMode: 'absolute', anchorX: 0, anchorY: 0 }));
    const r = applyLassoCut(p, 'l', rectLoop(40, -20, 60, 20), 0);
    if ('refused' in r) throw new Error(r.refused);
    const kept = r.assets.find((a) => a.id === r.objects.find((o) => o.id === 'l')!.assetId) as VectorAsset;
    expect(kept.style).toEqual({ fill: '#00f', stroke: 'none', strokeWidth: 0 });
    expect(kept.compoundRings).toHaveLength(1); // the line split in two
    expect(areaOf({ ...p, objects: r.objects, assets: r.assets }, r.insideId)).toBeCloseTo(200, 0);
  });

  it('refuses a loop that misses or holds the whole drawing, and drawings it may not cut', () => {
    const p = withRect();
    expect(applyLassoCut(p, 'r', rectLoop(200, 200, 300, 300), 0)).toEqual({ refused: 'missed' });
    expect(applyLassoCut(p, 'r', rectLoop(-10, -10, 120, 120), 0)).toEqual({ refused: 'whole' });
    expect(applyLassoCut(withRect({ locked: true }), 'r', rectLoop(-10, -10, 50, 110), 0)).toEqual({ refused: 'locked' });
    expect(applyLassoCut(withRect({ tracks: { width: [{ time: 0, value: 50, easing: 'linear' }] } }), 'r', rectLoop(-10, -10, 50, 110), 0)).toEqual({ refused: 'animated-shape' });
    expect(applyLassoCut(p, 'nope', rectLoop(0, 0, 10, 10), 0)).toEqual({ refused: 'not-a-drawing' });
  });
});
