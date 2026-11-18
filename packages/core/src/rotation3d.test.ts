import { describe, expect, it } from 'vitest';
import { buildTransform, createProject, createSceneObject, createVectorAsset, sampleObject } from '@savig/engine';
import type { VectorAsset } from '@savig/engine';
import { bakePerspective, setRotation3D } from './rotation3d';
import { compileShort, decompileProject } from './dsl';
import { describeProject } from './describe';

function fixture() {
  const p = createProject();
  p.objects.push(createSceneObject('a', { id: 'card' }));
  return p;
}

describe('setRotation3D', () => {
  it('sets and clears the static angles', () => {
    let p = setRotation3D(fixture(), 'card', { rotationY: 60 });
    expect(p.objects[0].base.rotationY).toBe(60);
    expect(buildTransform(sampleObject(p.objects[0], 0), 0, 0)).toContain('matrix(0.5, 0, 0, 1, 0, 0)');
    p = setRotation3D(p, 'card', { rotationY: 0 });
    expect('rotationY' in p.objects[0].base).toBe(false);
  });

  it('keys a full flip', () => {
    let p = setRotation3D(fixture(), 'card', { rotationY: 0, time: 0 });
    p = setRotation3D(p, 'card', { rotationY: 360, time: 1, easing: 'linear' });
    expect(sampleObject(p.objects[0], 0.5).rotationY).toBeCloseTo(180);
  });

  it('fails loud', () => {
    expect(() => setRotation3D(fixture(), 'nope', { rotationX: 1 })).toThrow(/no object/);
    expect(() => setRotation3D(fixture(), 'card', {})).toThrow(/needs/);
    expect(() => setRotation3D(fixture(), 'card', { rotationX: Number.NaN })).toThrow(/finite/);
  });
});

describe('3D rotation in the DSL', () => {
  it('compiles and round-trips base and animate', () => {
    const doc = {
      objects: [{ type: 'rect', id: 'card', x: 10, y: 10, width: 40, height: 60, base: { rotationX: 20 }, animate: { rotationY: [{ t: 0, value: 0 }, { t: 1, value: 180 }] } }],
    };
    const p = compileShort(doc as never);
    expect(p.objects[0].base.rotationX).toBe(20);
    expect(p.objects[0].tracks.rotationY).toHaveLength(2);
    const back = decompileProject(p) as unknown as { objects: { base?: Record<string, number>; animate?: Record<string, unknown> }[] };
    expect(back.objects[0].base?.rotationX).toBe(20);
    expect(back.objects[0].animate?.rotationY).toBeDefined();
    expect(describeProject(p)).toMatch(/rx=20°/);
  });
});

function rectFixture() {
  const p = createProject();
  p.assets.push(createVectorAsset('rect', { id: 'a' }));
  p.objects.push(createSceneObject('a', { id: 'card', shapeBase: { width: 80, height: 50 } }));
  return p;
}

describe('bakePerspective', () => {
  it('bakes a static turn into the outline and clears the 3D rotation', () => {
    const p = bakePerspective(setRotation3D(rectFixture(), 'card', { rotationY: 50 }), 'card', { distance: 400 });
    const o = p.objects[0];
    expect(o.base.rotationY).toBeUndefined();
    const asset = p.assets.find((a) => a.id === o.assetId) as VectorAsset;
    expect(asset.shapeType).toBe('path');
    const [a, b, c, d] = asset.path!.nodes.map((n) => n.anchor);
    // The two vertical edges differ in height: one side is nearer.
    expect(Math.abs(d.y - a.y - (c.y - b.y))).toBeGreaterThan(1);
  });

  it('fails loud', () => {
    expect(() => bakePerspective(rectFixture(), 'nope')).toThrow(/no object/);
    expect(() => bakePerspective(rectFixture(), 'card')).toThrow(/no 3D rotation/);
    expect(() => bakePerspective(setRotation3D(rectFixture(), 'card', { rotationY: 20 }), 'card', { distance: -1 })).toThrow(/positive/);
  });
});
