import { describe, it, expect } from 'vitest';
import { transformedAABB, computeSnap, aabbIntersect, groupBBox, objectAABB, groupAABB, type AABB } from './snapping';
import { createSceneObject, createGroupObject } from '../../../engine';
import type { SvgAsset } from '../../../engine';

describe('objectAABB', () => {
  it('returns the unrotated stage box of an svg object (translation shifts it uniformly)', () => {
    const asset: SvgAsset = { id: 'a', kind: 'svg', name: 'box', normalizedContent: '<svg/>', viewBox: '0 0 40 20', width: 40, height: 20 };
    const obj = createSceneObject('a', { id: 'o', base: { x: 5, y: 7, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
    expect(objectAABB(obj, asset, 0)).toEqual({ minX: 5, minY: 7, maxX: 45, maxY: 27 });
  });

  it('returns null for an object whose asset is missing', () => {
    const obj = createSceneObject('a', { id: 'o' });
    expect(objectAABB(obj, undefined, 0)).toBeNull();
  });
});

describe('transformedAABB', () => {
  it('translates an unrotated unit-scaled rect by base', () => {
    const b = transformedAABB(
      { x: 0, y: 0, width: 100, height: 50 },
      { anchorX: 0, anchorY: 0, scaleX: 1, scaleY: 1, rotationDeg: 0, baseX: 10, baseY: 20 },
    );
    expect(b).toEqual({ minX: 10, minY: 20, maxX: 110, maxY: 70 });
  });
  it('swaps extents for a 90-degree rotation about the centre', () => {
    const b = transformedAABB(
      { x: 0, y: 0, width: 100, height: 50 },
      { anchorX: 50, anchorY: 25, scaleX: 1, scaleY: 1, rotationDeg: 90, baseX: 0, baseY: 0 },
    );
    expect(b.minX).toBeCloseTo(25);
    expect(b.maxX).toBeCloseTo(75);
    expect(b.minY).toBeCloseTo(-25);
    expect(b.maxY).toBeCloseTo(75);
  });
  it('scales about the origin anchor', () => {
    const b = transformedAABB(
      { x: 0, y: 0, width: 100, height: 50 },
      { anchorX: 0, anchorY: 0, scaleX: 2, scaleY: 2, rotationDeg: 0, baseX: 0, baseY: 0 },
    );
    expect(b).toEqual({ minX: 0, minY: 0, maxX: 200, maxY: 100 });
  });
});

describe('computeSnap', () => {
  const moving: AABB = { minX: 100, minY: 100, maxX: 200, maxY: 150 };
  it('snaps the near left edge and reports a vertical guide; no Y snap', () => {
    const target: AABB = { minX: 103, minY: 300, maxX: 203, maxY: 350 };
    const r = computeSnap(moving, [target], 6);
    expect(r.dx).toBeCloseTo(3); // 100 -> 103
    expect(r.guideX).toBeCloseTo(103);
    expect(r.dy).toBe(0);
    expect(r.guideY).toBeNull();
  });
  it('snaps centre-to-centre (a narrower box so only the centres are in range)', () => {
    const target: AABB = { minX: 42, minY: 124, maxX: 62, maxY: 126 }; // centre (52,125), edges far
    const r = computeSnap({ minX: 0, minY: 100, maxX: 100, maxY: 150 }, [target], 6);
    expect(r.dx).toBeCloseTo(2); // centre 50 -> 52 (edges 0/100 vs 42/62 are out of range)
    expect(r.guideX).toBeCloseTo(52);
  });
  it('picks the nearest candidate', () => {
    const far: AABB = { minX: 103, minY: 999, maxX: 203, maxY: 1099 };
    const near: AABB = { minX: 101, minY: 999, maxX: 201, maxY: 1099 };
    const r = computeSnap(moving, [far, near], 6);
    expect(r.dx).toBeCloseTo(1); // 100 -> 101 (nearest)
    expect(r.guideX).toBeCloseTo(101);
  });
  it('does not snap beyond the threshold (far on both axes)', () => {
    const target: AABB = { minX: 120, minY: 300, maxX: 220, maxY: 350 };
    const r = computeSnap(moving, [target], 6);
    expect(r).toEqual({ dx: 0, dy: 0, guideX: null, guideY: null });
  });
  it('snaps both axes independently', () => {
    const target: AABB = { minX: 104, minY: 104, maxX: 204, maxY: 154 };
    const r = computeSnap(moving, [target], 6);
    expect(r.dx).toBeCloseTo(4);
    expect(r.dy).toBeCloseTo(4);
    expect(r.guideX).toBeCloseTo(104);
    expect(r.guideY).toBeCloseTo(104);
  });
});

describe('aabbIntersect', () => {
  const a: AABB = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
  it('overlapping boxes intersect', () => {
    expect(aabbIntersect(a, { minX: 5, minY: 5, maxX: 15, maxY: 15 })).toBe(true);
  });
  it('disjoint boxes do not intersect', () => {
    expect(aabbIntersect(a, { minX: 20, minY: 0, maxX: 30, maxY: 10 })).toBe(false);
    expect(aabbIntersect(a, { minX: 0, minY: 20, maxX: 10, maxY: 30 })).toBe(false);
  });
  it('edge-touching counts as intersecting', () => {
    expect(aabbIntersect(a, { minX: 10, minY: 0, maxX: 20, maxY: 10 })).toBe(true);
  });
  it('a box fully inside another intersects', () => {
    expect(aabbIntersect(a, { minX: 2, minY: 2, maxX: 8, maxY: 8 })).toBe(true);
  });
});

describe('groupBBox', () => {
  it('unions several AABBs', () => {
    const boxes: AABB[] = [
      { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      { minX: 20, minY: -5, maxX: 30, maxY: 5 },
    ];
    expect(groupBBox(boxes)).toEqual({ minX: 0, minY: -5, maxX: 30, maxY: 10 });
  });
  it('returns null for an empty list', () => {
    expect(groupBBox([])).toBeNull();
  });
});

describe('groupAABB (slice 45b)', () => {
  const svg = (id: string, w: number, h: number): SvgAsset => ({ id, kind: 'svg', name: id, normalizedContent: '<svg/>', viewBox: `0 0 ${w} ${h}`, width: w, height: h });

  it('unions the children boxes and widens about the group anchor when the group scales', () => {
    const assets: SvgAsset[] = [svg('s', 10, 10)];
    const group = createGroupObject({ id: 'g', anchorX: 25, anchorY: 5, zOrder: 2 });
    const a = createSceneObject('s', { id: 'a', parentId: 'g', base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
    const b = createSceneObject('s', { id: 'b', parentId: 'g', base: { x: 40, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
    const objs = [group, a, b];
    const at1 = groupAABB(group, objs, assets, 0)!;
    expect([at1.minX, at1.maxX]).toEqual([0, 50]); // a [0..10] + b [40..50]
    group.base = { ...group.base, scaleX: 2 }; // scale 2x about anchor x=25
    const at2 = groupAABB(group, objs, assets, 0)!;
    expect([at2.minX, at2.maxX]).toEqual([-25, 75]); // [0,50] scaled 2x about 25
  });

  it('returns null for a group with no children', () => {
    const group = createGroupObject({ id: 'g', anchorX: 0, anchorY: 0, zOrder: 0 });
    expect(groupAABB(group, [group], [], 0)).toBeNull();
  });
});
