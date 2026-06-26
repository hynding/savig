import { describe, it, expect } from 'vitest';
import { transformedAABB, computeSnap, aabbIntersect, groupBBox, objectAABB, groupAABB, instanceAABB, sceneContentAABB, entityAABB, isSymbolInstance, type AABB } from './snapping';
import { createSceneObject, createGroupObject, createVectorAsset, createSymbolAsset } from '../../../engine';
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

  it('spans a path asset compound rings (slice 46)', () => {
    const asset = createVectorAsset('path', {
      id: 'a',
      path: { closed: true, nodes: [ { anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 10, y: 10 } }, { anchor: { x: 0, y: 10 } } ] },
      compoundRings: [ { closed: true, nodes: [ { anchor: { x: 20, y: 20 } }, { anchor: { x: 30, y: 20 } }, { anchor: { x: 30, y: 30 } }, { anchor: { x: 20, y: 30 } } ] } ],
    });
    const obj = createSceneObject('a', { id: 'o', anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5, base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
    const box = objectAABB(obj, asset, 0)!;
    expect(box.maxX - box.minX).toBeCloseTo(30, 4);
    expect(box.maxY - box.minY).toBeCloseTo(30, 4);
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

describe('groupAABB recursion for nested groups (slice 45e)', () => {
  it('an outer group unions a nested inner group bbox', () => {
    const assets: SvgAsset[] = [{ id: 's', kind: 'svg', name: 's', normalizedContent: '<svg/>', viewBox: '0 0 10 10', width: 10, height: 10 }];
    const outer = createGroupObject({ id: 'outer', anchorX: 0, anchorY: 0, zOrder: 2 });
    const inner = createGroupObject({ id: 'inner', anchorX: 0, anchorY: 0, zOrder: 1 });
    inner.parentId = 'outer';
    const a = createSceneObject('s', { id: 'a', parentId: 'inner', base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
    const b = createSceneObject('s', { id: 'b', parentId: 'inner', base: { x: 40, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
    const objs = [outer, inner, a, b];
    expect(groupAABB(outer, objs, assets, 0)).toEqual({ minX: 0, minY: 0, maxX: 50, maxY: 10 }); // a [0..10] + b [40..50]
  });
});

describe('instanceAABB (slice 47b)', () => {
  // A symbol containing one 10x10 rect at the origin; instanced identity at the top level.
  const innerAsset = createVectorAsset('rect', { id: 'inner', shapeType: 'rect' });
  const makeInner = () => {
    const o = createSceneObject('inner', { id: 'r', zOrder: 0 });
    o.shapeBase = { width: 10, height: 10 };
    return o;
  };

  it('returns the symbol content box mapped through an identity instance', () => {
    const sym = createSymbolAsset({ id: 'sym', objects: [makeInner()], width: 10, height: 10 });
    const inst = createSceneObject('sym', { id: 'i', base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
    const box = instanceAABB(inst, [innerAsset, sym], 0)!;
    expect(box.minX).toBeCloseTo(0, 4);
    expect(box.minY).toBeCloseTo(0, 4);
    expect(box.maxX).toBeCloseTo(10, 4);
    expect(box.maxY).toBeCloseTo(10, 4);
  });

  it('shifts the box by the instance translation', () => {
    const sym = createSymbolAsset({ id: 'sym', objects: [makeInner()], width: 10, height: 10 });
    const inst = createSceneObject('sym', { id: 'i', base: { x: 100, y: 50, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
    const box = instanceAABB(inst, [innerAsset, sym], 0)!;
    expect(box.minX).toBeCloseTo(100, 4);
    expect(box.minY).toBeCloseTo(50, 4);
    expect(box.maxX).toBeCloseTo(110, 4);
    expect(box.maxY).toBeCloseTo(60, 4);
  });

  it('doubles the box for a 2x instance scale about an anchor at the box centre', () => {
    const sym = createSymbolAsset({ id: 'sym', objects: [makeInner()], width: 10, height: 10 });
    const inst = createSceneObject('sym', {
      id: 'i', anchorX: 5, anchorY: 5,
      base: { x: 0, y: 0, scaleX: 2, scaleY: 2, rotation: 0, opacity: 1 },
    });
    const box = instanceAABB(inst, [innerAsset, sym], 0)!;
    expect(box.maxX - box.minX).toBeCloseTo(20, 4);
    expect(box.maxY - box.minY).toBeCloseTo(20, 4);
    // anchor (5,5) is fixed; content 0..10 -> -5..15 about 5
    expect(box.minX).toBeCloseTo(-5, 4);
    expect(box.maxX).toBeCloseTo(15, 4);
  });

  it('returns null for a missing symbol and is cycle-guarded against self-containment', () => {
    const inst = createSceneObject('missing', { id: 'i' });
    expect(instanceAABB(inst, [], 0)).toBeNull();
    // A self-referential symbol (contains an instance of itself) must terminate and be finite.
    const selfInst = createSceneObject('cyc', { id: 'self' });
    const sym = createSymbolAsset({ id: 'cyc', objects: [selfInst, makeInner()], width: 10, height: 10 });
    const outer = createSceneObject('cyc', { id: 'o', base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
    const box = instanceAABB(outer, [innerAsset, sym], 0)!; // the recursive self-branch is skipped; the rect still counts
    expect(box.maxX - box.minX).toBeCloseTo(10, 4);
  });
});

describe('entityAABB + sceneContentAABB (slice 47b)', () => {
  const innerAsset = createVectorAsset('rect', { id: 'inner', shapeType: 'rect' });

  it('dispatches a plain object to its objectAABB', () => {
    const svg: SvgAsset = { id: 'a', kind: 'svg', name: 'box', normalizedContent: '<svg/>', viewBox: '0 0 40 20', width: 40, height: 20 };
    const obj = createSceneObject('a', { id: 'o', base: { x: 5, y: 7, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
    expect(entityAABB(obj, [obj], [svg], 0)).toEqual({ minX: 5, minY: 7, maxX: 45, maxY: 27 });
  });

  it('dispatches an instance to its instanceAABB', () => {
    const r = createSceneObject('inner', { id: 'r', zOrder: 0 });
    r.shapeBase = { width: 10, height: 10 };
    const sym = createSymbolAsset({ id: 'sym', objects: [r], width: 10, height: 10 });
    const inst = createSceneObject('sym', { id: 'i', base: { x: 20, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
    const box = entityAABB(inst, [inst], [innerAsset, sym], 0)!;
    expect(box.minX).toBeCloseTo(20, 4);
    expect(box.maxX).toBeCloseTo(30, 4);
  });

  it('unions two top-level objects into a scene content box', () => {
    const r1 = createSceneObject('inner', { id: 'r1', zOrder: 0, base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
    r1.shapeBase = { width: 10, height: 10 };
    const r2 = createSceneObject('inner', { id: 'r2', zOrder: 1, base: { x: 40, y: 30, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
    r2.shapeBase = { width: 10, height: 10 };
    const box = sceneContentAABB([r1, r2], [innerAsset], 0)!;
    expect(box).toEqual({ minX: 0, minY: 0, maxX: 50, maxY: 40 });
  });
});

describe('isSymbolInstance (slice 47b)', () => {
  it('is true only when the object asset is a symbol', () => {
    const sym = createSymbolAsset({ id: 'sym', objects: [], width: 0, height: 0 });
    const svg: SvgAsset = { id: 'a', kind: 'svg', name: 'b', normalizedContent: '<svg/>', viewBox: '0 0 1 1', width: 1, height: 1 };
    expect(isSymbolInstance(createSceneObject('sym', { id: 'i' }), [sym, svg])).toBe(true);
    expect(isSymbolInstance(createSceneObject('a', { id: 'o' }), [sym, svg])).toBe(false);
  });
});
