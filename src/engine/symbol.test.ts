import { describe, expect, it } from 'vitest';
import { flattenInstances, remapLocalTime } from './symbol';
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

describe('remapLocalTime (slice 47c)', () => {
  const loop = (o: number, s = 1) => ({ startOffset: o, loop: true, speed: s });
  const once = (o: number, s = 1) => ({ startOffset: o, loop: false, speed: s });
  it('is identity in-range (offset 0, speed 1)', () => {
    expect(remapLocalTime(2, loop(0), 10)).toBeCloseTo(2, 6);
  });
  it('shifts by startOffset', () => {
    expect(remapLocalTime(3, once(1), 10)).toBeCloseTo(2, 6);
  });
  it('holds the first frame before the start', () => {
    expect(remapLocalTime(0.5, once(1), 10)).toBe(0);
  });
  it('scales by speed', () => {
    expect(remapLocalTime(2, once(0, 2), 10)).toBeCloseTo(4, 6);
  });
  it('wraps when looping past the duration', () => {
    expect(remapLocalTime(12, loop(0), 10)).toBeCloseTo(2, 6);
  });
  it('holds the last frame for one-shot past the duration', () => {
    expect(remapLocalTime(12, once(0), 10)).toBeCloseTo(10, 6);
  });
  it('collapses to 0 for a zero-duration symbol', () => {
    expect(remapLocalTime(5, loop(0), 0)).toBe(0);
  });
});

describe('flattenInstances per-instance timelines (slice 47c)', () => {
  function timedProject(symbolTimeA?: import('./types').SymbolTiming, symbolTimeB?: import('./types').SymbolTiming) {
    const innerAsset = createVectorAsset('rect', { id: 'inner-asset', shapeType: 'rect' });
    const inner = createSceneObject('inner-asset', { id: 'inner', zOrder: 0 });
    inner.tracks = { x: [{ time: 0, value: 0, easing: 'linear' }, { time: 2, value: 100, easing: 'linear' }] };
    const sym = createSymbolAsset({ id: 'sym', objects: [inner], width: 10, height: 10 });
    const a = createSceneObject('sym', { id: 'a', zOrder: 0 });
    const b = createSceneObject('sym', { id: 'b', zOrder: 1 });
    if (symbolTimeA) a.symbolTime = symbolTimeA;
    if (symbolTimeB) b.symbolTime = symbolTimeB;
    const p = createProject();
    p.assets = [innerAsset, sym];
    p.objects = [a, b];
    return p;
  }

  it('an instance without symbolTime samples internals at the global time (parity unchanged)', () => {
    const leaves = flattenInstances(timedProject(), 1);
    expect(leaves.every((l) => l.localTime === 1)).toBe(true);
  });

  it('an instance with a startOffset samples its internals at the remapped time', () => {
    const leaves = flattenInstances(timedProject({ startOffset: 0.5, loop: false, speed: 1 }), 1.5);
    const a = leaves.find((l) => l.renderId.startsWith('a/'))!;
    expect(a.localTime).toBeCloseTo(1.0, 6);
  });

  it('two instances with different offsets diverge in frame at the same global time', () => {
    const leaves = flattenInstances(
      timedProject({ startOffset: 0, loop: true, speed: 1 }, { startOffset: 1, loop: true, speed: 1 }),
      1.5,
    );
    const a = leaves.find((l) => l.renderId.startsWith('a/'))!;
    const b = leaves.find((l) => l.renderId.startsWith('b/'))!;
    expect(a.localTime).toBeCloseTo(1.5, 6);
    expect(b.localTime).toBeCloseTo(0.5, 6);
  });

  it('loops the internal time past the symbol duration', () => {
    const leaves = flattenInstances(timedProject({ startOffset: 0, loop: true, speed: 1 }), 5); // dur 2 -> 5 % 2 = 1
    const a = leaves.find((l) => l.renderId.startsWith('a/'))!;
    expect(a.localTime).toBeCloseTo(1, 6);
  });

  it('nested instances with timing compose two remaps correctly', () => {
    // root -> instA (startOffset 1) -> symA -> instB (startOffset 0.5) -> symB -> leaf.
    // instB carries its OWN keyframes so symA has a non-zero intrinsic duration (else symA would be
    // static and A's remap would collapse to 0 — the documented v1 0-duration edge). Both remaps
    // are then non-trivial, so this genuinely exercises two-level composition.
    const innerAsset = createVectorAsset('rect', { id: 'inner-asset', shapeType: 'rect' });
    const innerLeaf = createSceneObject('inner-asset', { id: 'leaf', zOrder: 0 });
    innerLeaf.tracks = { x: [{ time: 0, value: 0, easing: 'linear' }, { time: 4, value: 100, easing: 'linear' }] };
    const symB = createSymbolAsset({ id: 'sym-b', objects: [innerLeaf], width: 10, height: 10 });
    const instB = createSceneObject('sym-b', { id: 'inst-b', zOrder: 0 });
    instB.tracks = { x: [{ time: 0, value: 0, easing: 'linear' }, { time: 4, value: 50, easing: 'linear' }] }; // -> symA duration 4
    instB.symbolTime = { startOffset: 0.5, loop: false, speed: 1 };
    const symA = createSymbolAsset({ id: 'sym-a', objects: [instB], width: 10, height: 10 });
    const instA = createSceneObject('sym-a', { id: 'inst-a', zOrder: 0 });
    instA.symbolTime = { startOffset: 1, loop: false, speed: 1 };
    const p = createProject();
    p.assets = [innerAsset, symB, symA];
    p.objects = [instA];
    // globalTime 3: A childTime = min(3-1, 4) = 2; B childTime = min(2-0.5, 4) = 1.5
    const leaves = flattenInstances(p, 3);
    expect(leaves).toHaveLength(1);
    expect(leaves[0].renderId).toBe('inst-a/inst-b/leaf');
    expect(leaves[0].localTime).toBeCloseTo(1.5, 6);
  });
});
