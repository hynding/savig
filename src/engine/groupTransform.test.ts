import { describe, it, expect } from 'vitest';
import { groupTransformPrefix, parentGroupOf, bakeGroupIntoChild, unbakeGroupFromChild, isRenderHidden, mapPoint } from './groupTransform';
import { createGroupObject, createProject, createSceneObject } from './project';
import type { Project } from './types';

function withObjects(...objects: ReturnType<typeof createSceneObject>[]): Project {
  return { ...createProject(), objects };
}

describe('groupTransformPrefix', () => {
  it("returns the group's buildTransform for a child (translated group)", () => {
    const g = createGroupObject({ id: 'g', anchorX: 0, anchorY: 0, zOrder: 0 });
    g.base = { ...g.base, x: 10, y: 20 };
    const child = createSceneObject('a', { id: 'c', parentId: 'g' });
    const prefix = groupTransformPrefix(withObjects(g, child).objects, child, 0);
    expect(prefix.startsWith('translate(10, 20)')).toBe(true);
  });

  it("returns '' for an object with no group parent", () => {
    const lone = createSceneObject('a', { id: 'c' });
    expect(groupTransformPrefix(withObjects(lone).objects, lone, 0)).toBe('');
  });

  it('parentGroupOf resolves the container, null when parentId is not a group', () => {
    const g = createGroupObject({ id: 'g', anchorX: 0, anchorY: 0, zOrder: 0 });
    const child = createSceneObject('a', { id: 'c', parentId: 'g' });
    const proj = withObjects(g, child);
    expect(parentGroupOf(proj.objects, child)?.id).toBe('g');
    expect(parentGroupOf(proj.objects, g)).toBeNull();
  });
});

describe('bakeGroupIntoChild', () => {
  it('translate group: adds the group translation to the child base, clears parentId', () => {
    const g = createGroupObject({ id: 'g', anchorX: 0, anchorY: 0, zOrder: 0 });
    g.base = { ...g.base, x: 10, y: 20 };
    const child = createSceneObject('a', { id: 'c', parentId: 'g', base: { x: 5, y: 7, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
    const baked = bakeGroupIntoChild(g, child, 0, 0); // child anchor (0,0)
    expect(baked.parentId).toBeUndefined();
    expect([baked.base.x, baked.base.y]).toEqual([15, 27]);
    expect([baked.base.scaleX, baked.base.scaleY, baked.base.rotation]).toEqual([1, 1, 0]);
  });

  it('uniform-scale group: multiplies scale and scales the child position about the group anchor', () => {
    const g = createGroupObject({ id: 'g', anchorX: 0, anchorY: 0, zOrder: 0 });
    g.base = { ...g.base, scaleX: 2, scaleY: 2 };
    const child = createSceneObject('a', { id: 'c', parentId: 'g', base: { x: 10, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
    const baked = bakeGroupIntoChild(g, child, 0, 0);
    // anchor point (10,0) scaled 2x about (0,0) -> (20,0); scale 1*2 = 2.
    expect([baked.base.x, baked.base.y]).toEqual([20, 0]);
    expect([baked.base.scaleX, baked.base.scaleY]).toEqual([2, 2]);
  });
});

describe('isRenderHidden (slice 45c)', () => {
  const byId = (...os: ReturnType<typeof createSceneObject>[]) => new Map(os.map((o) => [o.id, o] as const));

  it('cascades a hidden group to its visible children', () => {
    const g = createGroupObject({ id: 'g', anchorX: 0, anchorY: 0, zOrder: 0 });
    g.hidden = true;
    const child = createSceneObject('a', { id: 'c', parentId: 'g' });
    expect(isRenderHidden(child, byId(g, child))).toBe(true);
  });

  it('a visible child of a visible group is not hidden; a self-hidden child is', () => {
    const g = createGroupObject({ id: 'g', anchorX: 0, anchorY: 0, zOrder: 0 });
    const child = createSceneObject('a', { id: 'c', parentId: 'g' });
    expect(isRenderHidden(child, byId(g, child))).toBe(false);
    expect(isRenderHidden({ ...child, hidden: true }, byId(g, child))).toBe(true);
  });
});

describe('nested groups (slice 45e)', () => {
  function nested(): Project {
    // child C in inner group P (translate 10,0) in outer group GP (translate 100,0).
    const gp = createGroupObject({ id: 'gp', anchorX: 0, anchorY: 0, zOrder: 2 });
    gp.base = { ...gp.base, x: 100, y: 0 };
    const p = createGroupObject({ id: 'p', anchorX: 0, anchorY: 0, zOrder: 1 });
    p.base = { ...p.base, x: 10, y: 0 };
    p.parentId = 'gp';
    const c = createSceneObject('a', { id: 'c', parentId: 'p', base: { x: 5, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } });
    return { ...createProject(), objects: [gp, p, c] };
  }

  it('groupTransformPrefix composes BOTH ancestors outermost-first', () => {
    const proj = nested();
    const c = proj.objects.find((o) => o.id === 'c')!;
    const prefix = groupTransformPrefix(proj.objects, c, 0);
    expect(prefix.startsWith('translate(100, 0)')).toBe(true); // GP (outermost) first
    expect(prefix).toContain('translate(10, 0)'); // then P (inner)
    expect(prefix.indexOf('translate(100, 0)')).toBeLessThan(prefix.indexOf('translate(10, 0)'));
  });

  it('isRenderHidden cascades from a hidden GRANDPARENT group', () => {
    const proj = nested();
    const gp = proj.objects.find((o) => o.id === 'gp')!;
    gp.hidden = true;
    const byId = new Map(proj.objects.map((o) => [o.id, o] as const));
    expect(isRenderHidden(proj.objects.find((o) => o.id === 'c')!, byId)).toBe(true); // grandchild hidden
    expect(isRenderHidden(proj.objects.find((o) => o.id === 'p')!, byId)).toBe(true); // inner group hidden too
  });
});

describe('unbakeGroupFromChild (slice 45f)', () => {
  const child = () => createSceneObject('a', { id: 'c', base: { x: 5, y: 7, scaleX: 1.5, scaleY: 1.5, rotation: 20, opacity: 1 } });
  const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

  it('round-trips bakeGroupIntoChild for a translate group', () => {
    const g = createGroupObject({ id: 'g', anchorX: 0, anchorY: 0, zOrder: 0 });
    g.base = { ...g.base, x: 10, y: 20 };
    const c = child();
    const back = unbakeGroupFromChild(g, bakeGroupIntoChild(g, c, 0, 0), 0, 0);
    close(back.base.x, c.base.x); close(back.base.y, c.base.y);
    expect(back.parentId).toBe('g');
  });

  it('round-trips for a uniform-scale + rotate group', () => {
    const g = createGroupObject({ id: 'g', anchorX: 5, anchorY: 5, zOrder: 0 });
    g.base = { ...g.base, x: 3, y: -4, scaleX: 2, scaleY: 2, rotation: 35 };
    const c = child();
    const back = unbakeGroupFromChild(g, bakeGroupIntoChild(g, c, 0, 0), 0, 0);
    close(back.base.x, c.base.x); close(back.base.y, c.base.y);
    close(back.base.scaleX, c.base.scaleX); close(back.base.rotation, c.base.rotation);
  });
});

describe('mapPoint (exported)', () => {
  it('translates a point by a pure-translate transform', () => {
    const p = mapPoint({ x: 10, y: 20, scaleX: 1, scaleY: 1, rotation: 0 }, 0, 0, 3, 4);
    expect(p).toEqual({ x: 13, y: 24 });
  });
  it('rotates 90° about the anchor', () => {
    const p = mapPoint({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 90 }, 0, 0, 1, 0);
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(1, 6);
  });
});
