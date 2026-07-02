import { describe, it, expect } from 'vitest';
import { createProject } from '@savig/engine';
import { createIdFactory } from './ids';
import { addRect, addEllipse, addPath, setKeyframe, setBaseTransform, removeObjects } from './build';

describe('core/ids', () => {
  it('createIdFactory yields deterministic sequential ids', () => {
    const id = createIdFactory();
    expect([id(), id(), id()]).toEqual(['o1', 'o2', 'o3']);
    const t = createIdFactory('rect');
    expect([t(), t()]).toEqual(['rect1', 'rect2']);
  });
});

describe('core/build addRect', () => {
  it('adds a rect object + vector asset with shapeBase and fractional centre anchor', () => {
    const { project, id } = addRect(createProject(), { x: 10, y: 20, width: 100, height: 50, id: 'r1' });
    expect(id).toBe('r1');
    const obj = project.objects.find((o) => o.id === 'r1')!;
    expect(obj.shapeBase).toEqual({ width: 100, height: 50 });
    expect(obj.base.x).toBe(10);
    expect(obj.base.y).toBe(20);
    expect(obj.anchorMode).toBe('fraction');
    // deterministic, derived asset id
    expect(obj.assetId).toBe('r1-asset');
    const asset = project.assets.find((a) => a.id === 'r1-asset')!;
    expect(asset.kind).toBe('vector');
  });

  it('respects an explicit style and appends with increasing zOrder', () => {
    let p = createProject();
    ({ project: p } = addRect(p, { x: 0, y: 0, width: 10, height: 10, id: 'a', style: { fill: '#f00' } }));
    ({ project: p } = addRect(p, { x: 0, y: 0, width: 10, height: 10, id: 'b' }));
    expect(p.objects.map((o) => o.zOrder)).toEqual([0, 1]);
    const a = p.assets.find((x) => x.id === 'a-asset')!;
    expect(a.kind === 'vector' && a.style.fill).toBe('#f00');
  });

  it('is pure — does not mutate the input project', () => {
    const p0 = createProject();
    addRect(p0, { x: 0, y: 0, width: 5, height: 5, id: 'x' });
    expect(p0.objects).toHaveLength(0);
    expect(p0.assets).toHaveLength(0);
  });
});

describe('core/build addEllipse', () => {
  it('stores radiusX/radiusY from the bounding box', () => {
    const { project } = addEllipse(createProject(), { x: 0, y: 0, width: 80, height: 40, id: 'e1' });
    const obj = project.objects.find((o) => o.id === 'e1')!;
    expect(obj.shapeBase).toEqual({ radiusX: 40, radiusY: 20 });
  });
});

describe('core/build addPath', () => {
  it('normalizes the path to bbox origin and places base at the bbox top-left', () => {
    const path = { closed: false, nodes: [{ anchor: { x: 30, y: 40 } }, { anchor: { x: 50, y: 90 } }] };
    const { project, id } = addPath(createProject(), { path, id: 'p1' });
    const obj = project.objects.find((o) => o.id === id)!;
    expect(obj.base.x).toBe(30);
    expect(obj.base.y).toBe(40);
    const asset = project.assets.find((a) => a.id === 'p1-asset')!;
    const nodes = asset.kind === 'vector' ? asset.path!.nodes : [];
    expect(nodes[0].anchor).toEqual({ x: 0, y: 0 });
    expect(nodes[1].anchor).toEqual({ x: 20, y: 50 });
  });

  it('throws on a degenerate (<2 node) path', () => {
    expect(() => addPath(createProject(), { path: { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }] } })).toThrow();
  });
});

describe('core/build setKeyframe / setBaseTransform', () => {
  it('upserts a keyframe on the named track, sorted by time', () => {
    let p = addRect(createProject(), { x: 0, y: 0, width: 10, height: 10, id: 'r' }).project;
    p = setKeyframe(p, { objectId: 'r', property: 'x', time: 1, value: 100 });
    p = setKeyframe(p, { objectId: 'r', property: 'x', time: 0, value: 0, easing: 'easeInOut' });
    const track = p.objects[0].tracks.x!;
    expect(track.map((k) => k.time)).toEqual([0, 1]);
    expect(track[0].easing).toBe('easeInOut');
  });

  it('throws on an unknown object id (fail-loud for a programmatic caller)', () => {
    expect(() => setKeyframe(createProject(), { objectId: 'nope', property: 'x', time: 0, value: 0 })).toThrow(/no object/);
  });

  it('setBaseTransform merges fields', () => {
    let p = addRect(createProject(), { x: 0, y: 0, width: 10, height: 10, id: 'r' }).project;
    p = setBaseTransform(p, 'r', { rotation: 45, scaleX: 2 });
    expect(p.objects[0].base.rotation).toBe(45);
    expect(p.objects[0].base.scaleX).toBe(2);
    expect(p.objects[0].base.x).toBe(0); // untouched
  });
});

describe('core/build removeObjects', () => {
  it('removes objects and prunes their now-orphaned vector assets', () => {
    let p = addRect(createProject(), { x: 0, y: 0, width: 10, height: 10, id: 'r' }).project;
    expect(p.assets).toHaveLength(1);
    p = removeObjects(p, ['r']);
    expect(p.objects).toHaveLength(0);
    expect(p.assets).toHaveLength(0); // orphaned asset pruned
  });

  it('keeps a vector asset still referenced by another object', () => {
    let p = createProject();
    ({ project: p } = addRect(p, { x: 0, y: 0, width: 10, height: 10, id: 'a' }));
    // second object reusing the first's asset
    const shared = { ...p.objects[0], id: 'b' };
    p = { ...p, objects: [...p.objects, shared] };
    p = removeObjects(p, ['a']);
    expect(p.objects.map((o) => o.id)).toEqual(['b']);
    expect(p.assets).toHaveLength(1); // still referenced by b
  });
});
