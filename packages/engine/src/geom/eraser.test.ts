import { describe, expect, it } from 'vitest';
import { createGroupObject, createProject, createSceneObject, createVectorAsset } from '../project';
import type { PathData, Project, SceneObject, VectorAsset, VectorStyle } from '../types';
import { applyEraser, eraserArea } from './eraser';
import { multiPolygonArea, objectWorldInk, pointInMultiPolygon } from './paintBucket';

const line = (pts: [number, number][]): PathData => ({ closed: false, nodes: pts.map(([x, y]) => ({ anchor: { x, y } })) });
function addRect(p: Project, id: string, x: number, y: number, w: number, h: number, style: Partial<VectorStyle>, extra: Partial<SceneObject> = {}): void {
  const asset = createVectorAsset('rect', { id: `${id}-a`, style: { fill: 'none', stroke: 'none', strokeWidth: 0, ...style } });
  p.assets.push(asset);
  p.objects.push(createSceneObject(asset.id, { id, zOrder: p.objects.length, anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5, base: { x, y, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 }, shapeBase: { width: w, height: h }, ...extra }));
}
function addLine(p: Project, id: string, pts: [number, number][], extra: Partial<SceneObject> = {}): void {
  const asset = createVectorAsset('path', { id: `${id}-a`, path: line(pts), style: { fill: 'none', stroke: '#000000', strokeWidth: 4 } });
  p.assets.push(asset);
  p.objects.push(createSceneObject(asset.id, { id, zOrder: p.objects.length, anchorMode: 'absolute', anchorX: 0, anchorY: 0, ...extra }));
}
const view = (p: Project, e: { objects: SceneObject[]; assets: Project['assets'] }): Project => ({ ...p, objects: e.objects, assets: e.assets });
const inkAt = (p: Project, id: string, x: number, y: number) => {
  const o = p.objects.find((q) => q.id === id)!;
  const ink = objectWorldInk(p, o, 0);
  return pointInMultiPolygon(ink.fill, x, y) || pointInMultiPolygon(ink.stroke, x, y);
};

describe('eraserArea', () => {
  it('is a round dab for one point and a capsule for a drag', () => {
    expect(multiPolygonArea(eraserArea([{ x: 0, y: 0 }], 10))).toBeCloseTo(Math.PI * 25, -1);
    const cap = eraserArea([{ x: 0, y: 0 }, { x: 100, y: 0 }], 10);
    expect(multiPolygonArea(cap)).toBeGreaterThan(1000);
    expect(pointInMultiPolygon(cap, 50, 4)).toBe(true);
    expect(pointInMultiPolygon(cap, 50, 6)).toBe(false);
    expect(eraserArea([{ x: 0, y: 0 }], 0)).toEqual([]);
  });
});

describe('applyEraser', () => {
  it('cuts a channel through a filled rect, which becomes a path keeping its place', () => {
    const p = createProject();
    addRect(p, 'r', 0, 0, 100, 100, { fill: '#ff0000' });
    const e = applyEraser(p, [{ x: 50, y: -10 }, { x: 50, y: 110 }], 10, 0);
    expect(e.erased).toEqual(['r']);
    const q = view(p, e);
    const a = q.assets.find((x) => x.id === 'r-a') as VectorAsset;
    expect(a.shapeType).toBe('path');
    expect(a.compoundRings).toHaveLength(1); // two pieces
    expect(a.style.fill).toBe('#ff0000');
    expect(inkAt(q, 'r', 50, 50)).toBe(false);
    expect(inkAt(q, 'r', 20, 50)).toBe(true);
    expect(inkAt(q, 'r', 80, 50)).toBe(true);
    expect(inkAt(q, 'r', 105, 50)).toBe(false); // nothing moved
    expect(q.objects[0]).toMatchObject({ anchorMode: 'absolute', anchorX: 50, anchorY: 50 });
    expect(q.objects[0].shapeBase).toBeUndefined();
  });

  it('splits a line into its outlined pieces, stroke colour becoming the fill', () => {
    const p = createProject();
    addLine(p, 'l', [[0, 50], [100, 50]]);
    const e = applyEraser(p, [{ x: 50, y: 0 }, { x: 50, y: 100 }], 10, 0);
    const q = view(p, e);
    const a = q.assets[0] as VectorAsset;
    expect(a.style).toMatchObject({ fill: '#000000', stroke: 'none', strokeWidth: 0 });
    expect(inkAt(q, 'l', 50, 50)).toBe(false);
    expect(inkAt(q, 'l', 20, 50)).toBe(true);
  });

  it('works through rotation and a group, in each shape’s own space', () => {
    const p = createProject();
    p.objects.push({ ...createGroupObject({ id: 'g', zOrder: 0, anchorX: 0, anchorY: 0 }), base: { x: 200, y: 0, scaleX: 2, scaleY: 2, rotation: 0, opacity: 1 } });
    addRect(p, 'r', 0, 0, 50, 50, { fill: '#00f' }, { parentId: 'g', base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 45, opacity: 1 } });
    const ring = objectWorldInk(p, p.objects[1], 0).fill[0][0];
    const hit = { x: ring.reduce((a, [x]) => a + x, 0) / ring.length, y: ring.reduce((a, [, y]) => a + y, 0) / ring.length };
    expect(inkAt(p, 'r', hit.x, hit.y)).toBe(true);
    const e = applyEraser(p, [hit], 6, 0);
    expect(e.erased).toEqual(['r']);
    expect(inkAt(view(p, e), 'r', hit.x, hit.y)).toBe(false);
  });

  it('deletes a shape erased away, skips locked / morphing / animated-size shapes, ignores misses', () => {
    const p = createProject();
    addRect(p, 'small', 0, 0, 4, 4, { fill: '#000' });
    addRect(p, 'locked', 100, 0, 40, 40, { fill: '#000' }, { locked: true });
    addRect(p, 'sized', 200, 0, 40, 40, { fill: '#000' }, { tracks: { width: [{ time: 0, value: 40, easing: 'linear' }, { time: 1, value: 80, easing: 'linear' }] } });
    addRect(p, 'far', 0, 300, 40, 40, { fill: '#000' });
    const e = applyEraser(p, [{ x: 2, y: 2 }, { x: 120, y: 20 }, { x: 220, y: 20 }], 20, 0);
    expect(e.deleted).toEqual(['small']);
    expect(e.objects.map((o) => o.id)).toEqual(['locked', 'sized', 'far']);
    expect(e.skipped).toEqual([{ id: 'locked', reason: 'locked' }, { id: 'sized', reason: 'animated-shape' }]);
    expect(applyEraser(p, [{ x: 500, y: 500 }], 10, 0).objects).toBe(p.objects);
  });

  it('forks a shared asset so a twin is untouched', () => {
    const p = createProject();
    addRect(p, 'r', 0, 0, 100, 100, { fill: '#f00' });
    p.objects.push({ ...p.objects[0], id: 'twin', zOrder: 1, base: { ...p.objects[0].base, x: 300 } });
    const e = applyEraser(p, [{ x: 50, y: 50 }], 10, 0, { newId: () => 'n' });
    expect(e.objects.find((o) => o.id === 'r')!.assetId).toBe('n-asset');
    expect((e.assets.find((a) => a.id === 'r-a') as VectorAsset).shapeType).toBe('rect');
  });
});
