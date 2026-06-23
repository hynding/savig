import { describe, expect, it } from 'vitest';
import { flattenInstances } from './symbol';
import { createProject, createSceneObject, createSymbolAsset, createVectorAsset } from './project';

// A rect object with id `id`, zOrder `z`, referencing asset `asset-${id}`.
function rect(id: string, z: number, x = 0) {
  const o = createSceneObject(`asset-${id}`, { id, name: id, zOrder: z });
  o.base.x = x;
  return o;
}

describe('flattenInstances (slice 47a)', () => {
  it('a symbol-free project flattens to its objects in zOrder (parity)', () => {
    const p = createProject();
    p.assets = [createVectorAsset('rect', { id: 'asset-b' }), createVectorAsset('rect', { id: 'asset-a' })];
    p.objects = [rect('b', 2), rect('a', 1)];
    const leaves = flattenInstances(p, 0);
    expect(leaves.map((l) => l.renderId)).toEqual(['a', 'b']);
    expect(leaves.every((l) => l.transformPrefix === '' && l.opacityFactor === 1 && l.localTime === 0)).toBe(true);
  });

  it('expands a symbol instance into composite-id leaves with a composed prefix', () => {
    const inner = createVectorAsset('rect', { id: 'asset-inner' });
    const innerObj = createSceneObject('asset-inner', { id: 'inner', name: 'inner', zOrder: 1 });
    const sym = createSymbolAsset({ id: 'sym-1', objects: [innerObj] });
    const p = createProject();
    p.assets = [inner, sym];
    const instance = createSceneObject('sym-1', { id: 'inst', name: 'inst', zOrder: 1 });
    instance.base.x = 50; // instance translation must appear in the leaf prefix
    p.objects = [instance];
    const leaves = flattenInstances(p, 0);
    expect(leaves).toHaveLength(1);
    expect(leaves[0].renderId).toBe('inst/inner');
    expect(leaves[0].object.id).toBe('inner');
    expect(leaves[0].transformPrefix).toContain('translate(50');
  });

  it('multiplies opacity down the instance chain', () => {
    const inner = createVectorAsset('rect', { id: 'asset-inner' });
    const innerObj = createSceneObject('asset-inner', { id: 'inner', name: 'inner', zOrder: 1 });
    const sym = createSymbolAsset({ id: 'sym-1', objects: [innerObj] });
    const p = createProject();
    p.assets = [inner, sym];
    const instance = createSceneObject('sym-1', { id: 'inst', name: 'inst', zOrder: 1 });
    instance.base.opacity = 0.5;
    p.objects = [instance];
    expect(flattenInstances(p, 0)[0].opacityFactor).toBeCloseTo(0.5);
  });

  it('composes two nested instance levels (instance-in-instance)', () => {
    const inner = createVectorAsset('rect', { id: 'asset-inner' });
    const innerObj = createSceneObject('asset-inner', { id: 'leaf', name: 'leaf', zOrder: 1 });
    const symB = createSymbolAsset({ id: 'sym-b', objects: [innerObj] });
    // symA contains an instance of symB, translated 10
    const bInstance = createSceneObject('sym-b', { id: 'b', name: 'b', zOrder: 1 });
    bInstance.base.x = 10;
    const symA = createSymbolAsset({ id: 'sym-a', objects: [bInstance] });
    const p = createProject();
    p.assets = [inner, symB, symA];
    const aInstance = createSceneObject('sym-a', { id: 'a', name: 'a', zOrder: 1 });
    aInstance.base.x = 100;
    p.objects = [aInstance];
    const leaves = flattenInstances(p, 0);
    expect(leaves).toHaveLength(1);
    expect(leaves[0].renderId).toBe('a/b/leaf');
    expect(leaves[0].transformPrefix).toContain('translate(100'); // outermost A
    expect(leaves[0].transformPrefix).toContain('translate(10'); // then B
  });

  it('cycle-guards a self-referential symbol (finite, drops the cyclic branch)', () => {
    const sym = createSymbolAsset({ id: 'sym-1', objects: [] });
    const selfInstance = createSceneObject('sym-1', { id: 'self', name: 'self', zOrder: 1 });
    sym.objects = [selfInstance]; // sym contains an instance of itself
    const p = createProject();
    p.assets = [sym];
    const top = createSceneObject('sym-1', { id: 'top', name: 'top', zOrder: 1 });
    p.objects = [top];
    expect(() => flattenInstances(p, 0)).not.toThrow();
    expect(flattenInstances(p, 0)).toEqual([]); // top expands; inner self is cycle-skipped
  });

  it('skips group containers but folds their transform into children (parity with computeFrame)', () => {
    const p = createProject();
    p.assets = [createVectorAsset('rect', { id: 'asset-c' })];
    const group = createSceneObject('', { id: 'g', name: 'g', zOrder: 1 });
    group.isGroup = true;
    group.base.x = 10;
    const child = createSceneObject('asset-c', { id: 'c', name: 'c', zOrder: 1, parentId: 'g' });
    p.objects = [group, child];
    const leaves = flattenInstances(p, 0);
    expect(leaves.map((l) => l.renderId)).toEqual(['c']); // group is not a leaf
    expect(leaves[0].transformPrefix).toContain('translate(10');
  });

  it('skips a hidden instance and its whole subtree', () => {
    const inner = createVectorAsset('rect', { id: 'asset-inner' });
    const innerObj = createSceneObject('asset-inner', { id: 'inner', name: 'inner', zOrder: 1 });
    const sym = createSymbolAsset({ id: 'sym-1', objects: [innerObj] });
    const p = createProject();
    p.assets = [inner, sym];
    const instance = createSceneObject('sym-1', { id: 'inst', name: 'inst', zOrder: 1 });
    instance.hidden = true;
    p.objects = [instance];
    expect(flattenInstances(p, 0)).toEqual([]);
  });
});
