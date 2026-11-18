import { describe, expect, it } from 'vitest';
import { buildTransform, createProject, createSceneObject, sampleObject } from '@savig/engine';
import { setRotation3D } from './rotation3d';
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
