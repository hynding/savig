import { describe, expect, it } from 'vitest';
import { createGroupObject, createProject, createSceneObject, createVectorAsset } from '../project';
import type { PathData, Project, SceneObject, VectorAsset, VectorStyle } from '../types';
import { applyPaintBucket, objectWorldInk, paintBucketTarget, pointInMultiPolygon } from './paintBucket';

const line = (pts: [number, number][], closed = false): PathData => ({ closed, nodes: pts.map(([x, y]) => ({ anchor: { x, y } })) });
const STROKE: Partial<VectorStyle> = { fill: 'none', stroke: '#000000', strokeWidth: 4 };

function addPath(p: Project, id: string, path: PathData, style: Partial<VectorStyle>, z: number, extra: Partial<SceneObject> = {}): void {
  const asset = createVectorAsset('path', { id: `${id}-a`, path, style: { fill: 'none', stroke: 'none', strokeWidth: 0, ...style } });
  p.assets.push(asset);
  p.objects.push(createSceneObject(asset.id, { id, zOrder: z, anchorMode: 'absolute', anchorX: 0, anchorY: 0, ...extra }));
}
function addRect(p: Project, id: string, x: number, y: number, w: number, h: number, style: Partial<VectorStyle>, z: number): void {
  const asset = createVectorAsset('rect', { id: `${id}-a`, style: { fill: 'none', stroke: 'none', strokeWidth: 0, ...style } });
  p.assets.push(asset);
  p.objects.push(createSceneObject(asset.id, { id, zOrder: z, anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5, base: { x, y, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 }, shapeBase: { width: w, height: h } }));
}
/** A square outline drawn as four separate lines, 100..200. */
function boxOfLines(p: Project, z = 1): void {
  addPath(p, 'top', line([[100, 100], [200, 100]]), STROKE, z);
  addPath(p, 'right', line([[200, 100], [200, 200]]), STROKE, z + 1);
  addPath(p, 'bottom', line([[200, 200], [100, 200]]), STROKE, z + 2);
  addPath(p, 'left', line([[100, 200], [100, 100]]), STROKE, z + 3);
}

describe('objectWorldInk', () => {
  it('gives a filled rect its area and a stroked line its outline', () => {
    const p = createProject();
    addRect(p, 'r', 10, 10, 20, 20, { fill: '#ff0000' }, 0);
    addPath(p, 'l', line([[0, 50], [100, 50]]), STROKE, 1);
    const r = objectWorldInk(p, p.objects[0], 0);
    expect(pointInMultiPolygon(r.fill, 20, 20)).toBe(true);
    expect(r.stroke).toEqual([]);
    const l = objectWorldInk(p, p.objects[1], 0);
    expect(pointInMultiPolygon(l.stroke, 50, 51.5)).toBe(true);
    expect(pointInMultiPolygon(l.stroke, 50, 53)).toBe(false);
  });
});

describe('paintBucketTarget', () => {
  it('fills an area closed by separate lines', () => {
    const p = createProject();
    boxOfLines(p);
    const t = paintBucketTarget(p, { x: 150, y: 150 }, 0);
    expect(t.kind).toBe('fill');
    if (t.kind !== 'fill') return;
    expect(t.aboveId).toBeNull();
    const xs = t.rings[0].nodes.map((n) => n.anchor.x);
    expect(Math.min(...xs)).toBeCloseTo(102, 5); // inner edge of the 4-wide line
    expect(Math.max(...xs)).toBeCloseTo(198, 5);
  });

  it('reports an open area, a click on a line, and nothing at all', () => {
    const p = createProject();
    boxOfLines(p);
    p.objects = p.objects.filter((o) => o.id !== 'left'); // gap on the left
    expect(paintBucketTarget(p, { x: 150, y: 150 }, 0).kind).toBe('open');
    expect(paintBucketTarget(p, { x: 150, y: 101 }, 0)).toEqual({ kind: 'stroke', objectId: 'top' });
    expect(paintBucketTarget(createProject(), { x: 5, y: 5 }, 0).kind).toBe('open');
  });

  it('recolours a filled shape nothing cuts, even with its own stroke', () => {
    const p = createProject();
    addRect(p, 'r', 0, 0, 100, 100, { fill: '#ff0000', stroke: '#000000', strokeWidth: 6 }, 0);
    expect(paintBucketTarget(p, { x: 50, y: 50 }, 0)).toEqual({ kind: 'recolor', objectId: 'r' });
  });

  it('fills inside lines drawn over a background, placing the fill above the background', () => {
    const p = createProject();
    addRect(p, 'bg', 0, 0, 400, 400, { fill: '#ffffff' }, 0);
    boxOfLines(p);
    const t = paintBucketTarget(p, { x: 150, y: 150 }, 0);
    expect(t).toMatchObject({ kind: 'fill', aboveId: 'bg' });
    // Outside the box the lines still split the background: that region (with the box as a hole)
    // is filled, so the inside keeps its colour — Flash's region semantics.
    const out = paintBucketTarget(p, { x: 300, y: 300 }, 0);
    expect(out).toMatchObject({ kind: 'fill', aboveId: 'bg' });
    if (out.kind === 'fill') expect(out.rings).toHaveLength(2);
    // With no lines at all, the background is simply recoloured.
    p.objects = p.objects.filter((o) => o.id === 'bg');
    expect(paintBucketTarget(p, { x: 300, y: 300 }, 0)).toEqual({ kind: 'recolor', objectId: 'bg' });
  });

  it('a line across a shape splits it: only the clicked side fills', () => {
    const p = createProject();
    addRect(p, 'r', 0, 0, 100, 100, { fill: '#ff0000' }, 0);
    addPath(p, 'cut', line([[50, -20], [50, 120]]), STROKE, 1);
    const t = paintBucketTarget(p, { x: 20, y: 50 }, 0);
    expect(t.kind).toBe('fill');
    if (t.kind !== 'fill') return;
    const xs = t.rings[0].nodes.map((n) => n.anchor.x);
    expect(Math.max(...xs)).toBeCloseTo(48, 5);
    expect(Math.min(...xs)).toBeCloseTo(0, 5);
  });

  it('ignores hidden lines and guides', () => {
    const p = createProject();
    boxOfLines(p);
    p.objects[3] = { ...p.objects[3], hidden: true };
    expect(paintBucketTarget(p, { x: 150, y: 150 }, 0).kind).toBe('open');
    p.objects[3] = { ...p.objects[3], hidden: undefined, guide: true };
    expect(paintBucketTarget(p, { x: 150, y: 150 }, 0).kind).toBe('open');
  });
});

describe('applyPaintBucket', () => {
  it('adds a solid fill shape below the line art and shifts siblings up', () => {
    const p = createProject();
    boxOfLines(p, 0);
    let n = 0;
    const r = applyPaintBucket(p, { x: 150, y: 150 }, 0, '#00aa00', { newId: () => `f${n++}` });
    const fill = r.objects.find((o) => o.id === r.objectId)!;
    expect(fill.zOrder).toBe(0);
    expect(r.objects.find((o) => o.id === 'top')!.zOrder).toBe(1);
    const asset = r.assets.find((a) => a.id === fill.assetId) as VectorAsset;
    expect(asset.style).toEqual({ fill: '#00aa00', stroke: 'none', strokeWidth: 0 });
    expect(fill.base.x).toBeCloseTo(102, 5);
    // The created area is now filled: clicking again recolours it.
    const again = applyPaintBucket({ ...p, objects: r.objects, assets: r.assets }, { x: 150, y: 150 }, 0, '#0000ff');
    expect(again.target).toEqual({ kind: 'recolor', objectId: fill.id });
  });

  it('places the fill inside the background group, mapped to the group space', () => {
    const p = createProject();
    p.objects.push({ ...createGroupObject({ id: 'G', zOrder: 0, anchorX: 0, anchorY: 0 }), base: { x: 1000, y: 0, scaleX: 2, scaleY: 2, rotation: 0, opacity: 1 } });
    addRect(p, 'bg', 0, 0, 200, 200, { fill: '#ffffff' }, 0);
    p.objects[1] = { ...p.objects[1], parentId: 'G' }; // drawn at x 1000..1400 in scene space
    addPath(p, 'cut', line([[1200, -50], [1200, 500]]), STROKE, 1);
    const r = applyPaintBucket(p, { x: 1100, y: 100 }, 0, '#123456');
    const fill = r.objects.find((o) => o.id === r.objectId)!;
    expect(fill.parentId).toBe('G');
    expect(fill.zOrder).toBe(1);
    expect(fill.base.x).toBeCloseTo(0, 5); // group-local
    const asset = r.assets.find((a) => a.id === fill.assetId) as VectorAsset;
    const xs = asset.path!.nodes.map((nd) => nd.anchor.x);
    expect(Math.max(...xs)).toBeCloseTo(99, 5); // (1198 - 1000) / 2
  });

  it('recolours statically, or as a keyframe; refuses a locked target', () => {
    const p = createProject();
    addRect(p, 'r', 0, 0, 100, 100, { fill: '#ff0000' }, 0);
    const a = applyPaintBucket(p, { x: 50, y: 50 }, 0, '#00ff00');
    expect((a.assets[0] as VectorAsset).style.fill).toBe('#00ff00');
    const k = applyPaintBucket(p, { x: 50, y: 50 }, 0, '#00ff00', { keyAt: 1 });
    expect(k.objects[0].colorTracks?.fill).toEqual([{ time: 1, value: '#00ff00', easing: 'linear' }]);
    p.objects[0] = { ...p.objects[0], locked: true };
    expect(applyPaintBucket(p, { x: 50, y: 50 }, 0, '#00ff00').refused).toBe('locked');
  });

  it('forks an asset another object shares, so only the clicked shape changes', () => {
    const p = createProject();
    addRect(p, 'r', 0, 0, 100, 100, { fill: '#ff0000' }, 0);
    p.objects.push({ ...p.objects[0], id: 'twin', zOrder: 1, base: { ...p.objects[0].base, x: 300 } });
    const e = applyPaintBucket(p, { x: 50, y: 50 }, 0, '#00ff00', { newId: () => 'n1' });
    const clicked = e.objects.find((o) => o.id === 'r')!;
    expect(clicked.assetId).toBe('n1-asset');
    expect(e.objects.find((o) => o.id === 'twin')!.assetId).toBe('r-a');
    expect((e.assets.find((a) => a.id === 'r-a') as VectorAsset).style.fill).toBe('#ff0000');
    expect((e.assets.find((a) => a.id === 'n1-asset') as VectorAsset).style.fill).toBe('#00ff00');
  });
});
