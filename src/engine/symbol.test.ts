import { describe, expect, it } from 'vitest';
import { flattenInstances, remapLocalTime, symbolContains, countSymbolInstances } from './symbol';
import { symbolEffectiveDuration } from './duration';
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

describe('flattenInstances symbolTimeTrack (slice 47c keyframed time-remap)', () => {
  // Instance "a" of a symbol whose inner object animates x over t in [0,2] (intrinsic duration 2).
  function trackProject(symbolTimeTrack?: import('./types').Keyframe[], symbolTime?: import('./types').SymbolTiming) {
    const innerAsset = createVectorAsset('rect', { id: 'inner-asset', shapeType: 'rect' });
    const inner = createSceneObject('inner-asset', { id: 'inner', zOrder: 0 });
    inner.tracks = { x: [{ time: 0, value: 0, easing: 'linear' }, { time: 2, value: 100, easing: 'linear' }] };
    const sym = createSymbolAsset({ id: 'sym', objects: [inner], width: 10, height: 10 });
    const a = createSceneObject('sym', { id: 'a', zOrder: 0 });
    if (symbolTimeTrack) a.symbolTimeTrack = symbolTimeTrack;
    if (symbolTime) a.symbolTime = symbolTime;
    const p = createProject();
    p.assets = [innerAsset, sym];
    p.objects = [a];
    return p;
  }
  const kf = (time: number, value: number): import('./types').Keyframe => ({ time, value, easing: 'linear' });
  const localTimeAt = (track: import('./types').Keyframe[] | undefined, parent: number, st?: import('./types').SymbolTiming) =>
    flattenInstances(trackProject(track, st), parent).find((l) => l.renderId.startsWith('a/'))!.localTime;

  it('identity track samples internals at the parent time', () => {
    expect(localTimeAt([kf(0, 0), kf(2, 2)], 1.5)).toBeCloseTo(1.5, 6);
  });
  it('half-speed track (slope 1/2) halves the internal time', () => {
    expect(localTimeAt([kf(0, 0), kf(4, 2)], 2)).toBeCloseTo(1, 6); // between (0,0)-(4,2) at t=2 -> 1
  });
  it('flat segment FREEZES the internal frame', () => {
    expect(localTimeAt([kf(0, 1), kf(2, 1)], 0.5)).toBeCloseTo(1, 6);
    expect(localTimeAt([kf(0, 1), kf(2, 1)], 1.5)).toBeCloseTo(1, 6);
  });
  it('downward slope plays in REVERSE', () => {
    expect(localTimeAt([kf(0, 2), kf(2, 0)], 0.5)).toBeCloseTo(1.5, 6);
  });
  it('clamps parent times outside the keyframe range to the endpoint values', () => {
    expect(localTimeAt([kf(0, 0), kf(2, 2)], 5)).toBeCloseTo(2, 6); // after last
    expect(localTimeAt([kf(1, 0.5), kf(2, 2)], 0)).toBeCloseTo(0.5, 6); // before first
  });
  it('clamps a negative interpolated value to internal time 0', () => {
    expect(localTimeAt([kf(0, -1), kf(2, 0)], 0)).toBeCloseTo(0, 6); // Math.max(0, -1) -> 0
  });
  it('a non-empty track SUPERSEDES the constant symbolTime remap', () => {
    // track identity -> 1.5; the symbolTime offset would give 0.5. Track must win.
    expect(localTimeAt([kf(0, 0), kf(2, 2)], 1.5, { startOffset: 1, loop: false, speed: 1 })).toBeCloseTo(1.5, 6);
  });
  it('absent track is byte-identical to no remap (parity)', () => {
    expect(localTimeAt(undefined, 1.2)).toBeCloseTo(1.2, 6);
  });
});

describe('symbolContains (slice 47d cycle guard)', () => {
  function nestedAssets() {
    const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
    const symC = createSymbolAsset({ id: 'C', objects: [createSceneObject('rect-asset', { id: 'leaf' })], width: 10, height: 10 });
    const symB = createSymbolAsset({ id: 'B', objects: [createSceneObject('C', { id: 'b-c' })], width: 10, height: 10 });
    const symA = createSymbolAsset({ id: 'A', objects: [createSceneObject('B', { id: 'a-b' })], width: 10, height: 10 });
    return [rectAsset, symA, symB, symC];
  }
  it('is true for direct containment', () => {
    expect(symbolContains('B', 'C', nestedAssets())).toBe(true);
  });
  it('is true for transitive containment', () => {
    expect(symbolContains('A', 'C', nestedAssets())).toBe(true);
  });
  it('is false for unrelated symbols and for self', () => {
    expect(symbolContains('C', 'A', nestedAssets())).toBe(false);
    expect(symbolContains('A', 'A', nestedAssets())).toBe(false);
  });
  it('terminates on a corrupt self-referential graph', () => {
    const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
    const symX = createSymbolAsset({ id: 'X', objects: [createSceneObject('X', { id: 'x-x' }), createSceneObject('rect-asset', { id: 'leaf' })], width: 10, height: 10 });
    expect(symbolContains('X', 'rect-asset', [rectAsset, symX])).toBe(false);
    expect(symbolContains('X', 'X', [rectAsset, symX])).toBe(true);
  });
});

describe('countSymbolInstances (slice 47d)', () => {
  it('counts references across the root scene and symbol scenes', () => {
    const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
    const symC = createSymbolAsset({ id: 'C', objects: [createSceneObject('rect-asset', { id: 'leaf' })], width: 10, height: 10 });
    const symB = createSymbolAsset({ id: 'B', objects: [createSceneObject('C', { id: 'b-c1' }), createSceneObject('C', { id: 'b-c2' })], width: 10, height: 10 });
    const p = createProject();
    p.assets = [rectAsset, symB, symC];
    p.objects = [createSceneObject('C', { id: 'root-c' }), createSceneObject('B', { id: 'root-b' })];
    expect(countSymbolInstances('C', p)).toBe(3);
    expect(countSymbolInstances('B', p)).toBe(1);
    expect(countSymbolInstances('rect-asset', p)).toBe(1);
  });
});

describe('symbolEffectiveDuration — manual override (47c)', () => {
  const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });

  it('returns the manual duration when > 0, else the intrinsic objectsMaxKeyframeTime', () => {
    const keyed = createSceneObject('rect-asset', { id: 'k', tracks: { x: [{ time: 0, value: 0, easing: 'linear' }, { time: 3, value: 9, easing: 'linear' }] } });
    const auto = createSymbolAsset({ id: 's1', objects: [keyed], width: 1, height: 1, duration: 0 });
    expect(symbolEffectiveDuration(auto)).toBeCloseTo(3, 6);
    const manual = createSymbolAsset({ id: 's2', objects: [keyed], width: 1, height: 1, duration: 2 });
    expect(symbolEffectiveDuration(manual)).toBe(2);
  });

  it('a 0-intrinsic symbol with a manual duration loops (was the 0-duration collapse edge)', () => {
    const inner = createSceneObject('rect-asset', { id: 'inner' });
    const sym = createSymbolAsset({ id: 'sym', objects: [inner], width: 10, height: 10, duration: 2 });
    const inst = createSceneObject('sym', { id: 'inst', symbolTime: { startOffset: 0, loop: true, speed: 1 } });
    const project = createProject();
    project.assets = [rectAsset, sym];
    project.objects = [inst];
    const leaf = flattenInstances(project, 3).find((l) => l.renderId === 'inst/inner')!;
    expect(leaf.localTime).toBe(1);
  });

  it('without the override a 0-intrinsic looping symbol still collapses to 0 (regression baseline)', () => {
    const inner = createSceneObject('rect-asset', { id: 'inner' });
    const sym = createSymbolAsset({ id: 'sym', objects: [inner], width: 10, height: 10, duration: 0 });
    const inst = createSceneObject('sym', { id: 'inst', symbolTime: { startOffset: 0, loop: true, speed: 1 } });
    const project = createProject();
    project.assets = [rectAsset, sym];
    project.objects = [inst];
    const leaf = flattenInstances(project, 3).find((l) => l.renderId === 'inst/inner')!;
    expect(leaf.localTime).toBe(0);
  });
});

describe('remapLocalTime ping-pong (47c)', () => {
  const bounce = { startOffset: 0, loop: true, pingPong: true, speed: 1 };
  it('plays forward then mirrors back over a 2*duration period', () => {
    expect(remapLocalTime(2, bounce, 10)).toBeCloseTo(2, 6);
    expect(remapLocalTime(10, bounce, 10)).toBeCloseTo(10, 6);
    expect(remapLocalTime(12, bounce, 10)).toBeCloseTo(8, 6);
    expect(remapLocalTime(18, bounce, 10)).toBeCloseTo(2, 6);
    expect(remapLocalTime(20, bounce, 10)).toBeCloseTo(0, 6);
  });
  it('ping-pong with loop off falls through to one-shot', () => {
    expect(remapLocalTime(12, { startOffset: 0, loop: false, pingPong: true, speed: 1 }, 10)).toBeCloseTo(10, 6);
  });
  it('without pingPong the wrap path is unchanged (regression baseline)', () => {
    expect(remapLocalTime(12, { startOffset: 0, loop: true, speed: 1 }, 10)).toBeCloseTo(2, 6);
  });
});

describe('remapLocalTime play-count (47c)', () => {
  const dur = 10;
  it('wrap loop with playCount holds the last frame after N cycles', () => {
    const tm = { startOffset: 0, loop: true, speed: 1, playCount: 2 };
    expect(remapLocalTime(15, tm, dur)).toBeCloseTo(5, 4); // mid 2nd cycle
    expect(remapLocalTime(20, tm, dur)).toBeCloseTo(10, 4); // exhausted -> hold dur
    expect(remapLocalTime(100, tm, dur)).toBeCloseTo(10, 4);
  });
  it('wrap loop with playCount 1 plays once then holds the last frame', () => {
    const tm = { startOffset: 0, loop: true, speed: 1, playCount: 1 };
    expect(remapLocalTime(5, tm, dur)).toBeCloseTo(5, 4); // within the single cycle
    expect(remapLocalTime(10, tm, dur)).toBeCloseTo(10, 4); // exhausted at t===dur -> hold dur
    expect(remapLocalTime(25, tm, dur)).toBeCloseTo(10, 4);
  });
  it('ping-pong with playCount holds the start frame after N there-and-back cycles', () => {
    const tm = { startOffset: 0, loop: true, speed: 1, pingPong: true, playCount: 1 };
    expect(remapLocalTime(5, tm, dur)).toBeCloseTo(5, 4); // forward
    expect(remapLocalTime(15, tm, dur)).toBeCloseTo(5, 4); // reverse 2*10-15
    expect(remapLocalTime(20, tm, dur)).toBeCloseTo(0, 4); // exhausted -> hold 0
    expect(remapLocalTime(50, tm, dur)).toBeCloseTo(0, 4);
  });
  it('playCount absent leaves wrap/ping-pong unchanged (regression baseline)', () => {
    expect(remapLocalTime(25, { startOffset: 0, loop: true, speed: 1 }, dur)).toBeCloseTo(5, 4);
    expect(remapLocalTime(20, { startOffset: 0, loop: false, speed: 1, playCount: 2 }, dur)).toBeCloseTo(10, 4); // loop off -> one-shot
  });
});

describe('remapLocalTime phase (47c)', () => {
  const dur = 10;
  it('wrap loop with phase starts partway in and wraps', () => {
    const tm = { startOffset: 0, loop: true, speed: 1, phase: 3 };
    expect(remapLocalTime(0, tm, dur)).toBeCloseTo(3, 4);  // started 3 in
    expect(remapLocalTime(8, tm, dur)).toBeCloseTo(1, 4);  // (8+3) % 10
  });
  it('one-shot with phase starts partway and clamps to dur', () => {
    const tm = { startOffset: 0, loop: false, speed: 1, phase: 4 };
    expect(remapLocalTime(0, tm, dur)).toBeCloseTo(4, 4);
    expect(remapLocalTime(10, tm, dur)).toBeCloseTo(10, 4); // min(14,10)
  });
  it('phase is added after the speed scale', () => {
    const tm = { startOffset: 0, loop: true, speed: 2, phase: 1 };
    expect(remapLocalTime(2, tm, dur)).toBeCloseTo(5, 4); // 2*2 + 1
  });
  it('phase absent is unchanged (regression baseline)', () => {
    expect(remapLocalTime(3, { startOffset: 0, loop: true, speed: 1 }, dur)).toBeCloseTo(3, 4);
  });
  it('phase can overcome startOffset (the pre-start hold is bypassed once t>0)', () => {
    const tm = { startOffset: 2, loop: true, speed: 1, phase: 3 };
    expect(remapLocalTime(0, tm, dur)).toBeCloseTo(1, 4); // (0-2)*1 + 3 = 1 > 0 -> already started
    expect(remapLocalTime(1, tm, dur)).toBeCloseTo(2, 4);
  });
  it('phase advances toward the playCount budget', () => {
    const tm = { startOffset: 0, loop: true, speed: 1, playCount: 1, phase: 4 };
    expect(remapLocalTime(2, tm, dur)).toBeCloseTo(6, 4); // 2+4=6, within the single cycle
    expect(remapLocalTime(6, tm, dur)).toBeCloseTo(10, 4); // 6+4=10 -> cycle exhausted, hold dur
  });
});
