// Skew (spec 2026-11-18-skew-distort): editor bounds and handle math on skewed objects.
import { describe, expect, it } from 'vitest';
import { buildTransform, createProject, createSceneObject, createVectorAsset, mapPoint } from '@savig/engine';
import { objectAABB, transformedAABB } from './snapping';
import { applyScaleHandleDrag } from './scaleHandles';
import { applyHandleResize } from './resizeHandles';
import { linearMaps } from './handleMath';
import { applySkewHandleDrag, skewHandleLocalPositions } from './skewHandles';

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

describe('skew handles', () => {
  const bbox = { x: 0, y: 0, width: 20, height: 10 };
  const base = { bbox, anchorX: 10, anchorY: 5, scaleX: 1.5, scaleY: 1, rotationDeg: 30, skewX: 0, skewY: 0, baseX: 7, baseY: 4 };
  const at = (r: { skewX: number; skewY: number; x: number; y: number }, px: number, py: number) =>
    mapPoint({ x: r.x, y: r.y, scaleX: base.scaleX, scaleY: base.scaleY, rotation: base.rotationDeg, skewX: r.skewX, skewY: r.skewY }, base.anchorX, base.anchorY, px, py);
  const start = { skewX: 0, skewY: 0, x: base.baseX, y: base.baseY };

  it('places a handle outside each edge midpoint', () => {
    const p = skewHandleLocalPositions(bbox, 4);
    expect(p.n).toEqual({ x: 10, y: -4 });
    expect(p.e).toEqual({ x: 24, y: 5 });
  });

  it('top handle shears X so the edge follows the pointer and the bottom edge stays put', () => {
    const topNow = at(start, 10, 0);
    // pointer: move 6 units along the (rotated) edge direction
    const dir = { x: Math.cos(Math.PI / 6), y: Math.sin(Math.PI / 6) };
    const r = applySkewHandleDrag({ ...base, handle: 'n', pointerX: topNow.x + 6 * dir.x, pointerY: topNow.y + 6 * dir.y });
    expect(r.skewY).toBe(0);
    expect(r.skewX).toBeCloseTo((-Math.atan(6 / 10) * 180) / Math.PI, 6);
    const b0 = at(start, 10, 10);
    const b1 = at(r, 10, 10);
    expect(b1.x).toBeCloseTo(b0.x, 6);
    expect(b1.y).toBeCloseTo(b0.y, 6);
    const t1 = at(r, 10, 0);
    expect(t1.x).toBeCloseTo(topNow.x + 6 * dir.x, 6);
    expect(t1.y).toBeCloseTo(topNow.y + 6 * dir.y, 6);
  });

  it('right handle shears Y about the left edge; Shift snaps to 15°', () => {
    const rightNow = at(start, 20, 5);
    const r = applySkewHandleDrag({ ...base, handle: 'e', pointerX: rightNow.x - 4, pointerY: rightNow.y + 9, snap: true });
    expect(r.skewX).toBe(0);
    expect(Math.abs(r.skewY) % 15).toBeCloseTo(0, 9);
    const l0 = at(start, 0, 5);
    const l1 = at(r, 0, 5);
    expect(l1.x).toBeCloseTo(l0.x, 6);
    expect(l1.y).toBeCloseTo(l0.y, 6);
  });

  it('Alt shears about the anchor', () => {
    const r = applySkewHandleDrag({ ...base, handle: 's', pointerX: 100, pointerY: 40, fromAnchor: true });
    const a0 = at(start, base.anchorX, base.anchorY);
    const a1 = at(r, base.anchorX, base.anchorY);
    expect(a1.x).toBeCloseTo(a0.x, 6);
    expect(a1.y).toBeCloseTo(a0.y, 6);
  });

  it('never passes the skew limit', () => {
    const r = applySkewHandleDrag({ ...base, rotationDeg: 0, handle: 'n', pointerX: 1e6, pointerY: 4 });
    expect(Math.abs(r.skewX)).toBeLessThanOrEqual(85);
  });
});
