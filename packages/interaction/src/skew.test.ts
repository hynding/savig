// Skew (spec 2026-11-18-skew-distort): editor bounds and handle math on skewed objects.
import { describe, expect, it } from 'vitest';
import { buildTransform, createProject, createSceneObject, createVectorAsset, mapPoint } from '@savig/engine';
import { objectAABB, transformedAABB } from './snapping';
import { applyScaleHandleDrag } from './scaleHandles';
import { applyHandleResize } from './resizeHandles';
import { linearMaps } from './handleMath';

describe('linearMaps', () => {
  it('inv undoes fwd for rotation plus skew', () => {
    const L = linearMaps(35, 20, -12);
    const p = L.fwd(3, -8);
    const q = L.inv(p.x, p.y);
    expect(q.x).toBeCloseTo(3, 9);
    expect(q.y).toBeCloseTo(-8, 9);
  });
});

describe('bounds of a skewed object', () => {
  it('transformedAABB spans the skewed parallelogram', () => {
    const box = transformedAABB({ x: 0, y: 0, width: 10, height: 10 }, {
      anchorX: 0, anchorY: 0, scaleX: 1, scaleY: 1, rotationDeg: 0, baseX: 0, baseY: 0, skewX: 45,
    });
    expect(box.minX).toBeCloseTo(0);
    expect(box.maxX).toBeCloseTo(20); // top-right corner (10,10) shears to x = 20
    expect(box.maxY).toBeCloseTo(10);
  });

  it('objectAABB reads the sampled skew', () => {
    const asset = createVectorAsset('rect', { id: 'va' });
    const o = createSceneObject('va', { id: 'r', shapeBase: { width: 10, height: 10 }, anchorMode: 'absolute', anchorX: 0, anchorY: 0 });
    o.base = { ...o.base, skewX: 45 };
    const p = createProject();
    p.assets.push(asset);
    const box = objectAABB(o, asset, 0)!;
    expect(box.maxX - box.minX).toBeCloseTo(20);
  });
});

describe('scale and resize handles on a skewed object', () => {
  const t = { x: 5, y: 3, scaleX: 1.2, scaleY: 0.8, rotation: 20, opacity: 1, skewX: 25, skewY: -10 };
  const content = (s: typeof t, ax: number, ay: number, px: number, py: number) => mapPoint(s, ax, ay, px, py);

  it('scale drag keeps the opposite corner fixed and puts the corner under the pointer', () => {
    const ax = 5;
    const ay = 5;
    const corner = { x: 10, y: 10 };
    const opposite = { x: 0, y: 0 };
    const target = { x: 30, y: 25 };
    const r = applyScaleHandleDrag({
      corner, opposite, anchorX: ax, anchorY: ay, startScaleX: t.scaleX, startScaleY: t.scaleY,
      baseX: t.x, baseY: t.y, rotationDeg: t.rotation, skewX: t.skewX, skewY: t.skewY,
      pointerX: target.x, pointerY: target.y,
    });
    const next = { ...t, scaleX: r.scaleX, scaleY: r.scaleY, x: r.x, y: r.y };
    const o0 = content(t, ax, ay, opposite.x, opposite.y);
    const o1 = content(next, ax, ay, opposite.x, opposite.y);
    expect(o1.x).toBeCloseTo(o0.x, 6);
    expect(o1.y).toBeCloseTo(o0.y, 6);
    const c1 = content(next, ax, ay, corner.x, corner.y);
    expect(c1.x).toBeCloseTo(target.x, 6);
    expect(c1.y).toBeCloseTo(target.y, 6);
    // and the preview transform string agrees
    expect(buildTransform(next, ax, ay)).toContain('skewX(25)');
  });

  it('resize keeps the opposite edge fixed under skew', () => {
    const w = 10;
    const h = 8;
    const r = applyHandleResize({
      handle: 'se', localX: 16, localY: 12, width: w, height: h, anchorFracX: 0.5, anchorFracY: 0.5,
      baseX: t.x, baseY: t.y, scaleX: t.scaleX, scaleY: t.scaleY, rotationDeg: t.rotation, skewX: t.skewX, skewY: t.skewY, minSize: 1,
    });
    const before = content(t, w / 2, h / 2, 0, 0); // nw corner, old geometry
    const after = content({ ...t, x: r.baseX, y: r.baseY }, r.width / 2, r.height / 2, 0, 0);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });
});
