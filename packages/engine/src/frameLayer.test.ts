import { describe, expect, it } from 'vitest';
import {
  createFrameLayer,
  createGroupObject,
  createProject,
  createSceneObject,
  createSymbolAsset,
  createVectorAsset,
} from './project';
import { exposedFrameKeyId, frameKeySpans, isExposedAt, isFrameLayer } from './frameLayer';
import { flattenInstances } from './symbol';
import { computeProjectDuration, isStaticSymbol, symbolEffectiveDuration } from './duration';
import { objectKeyframeTimes } from './onionSkin';
import type { FrameLayer, Project, SceneObject } from './types';

const layer: FrameLayer = {
  keys: [
    { id: 'k1', time: 0 },
    { id: 'k2', time: 0.5 },
    { id: 'k3', time: 1 }, // blank key: nothing references it
  ],
  end: 1.5,
};

/** Layer L (keys above) holding r1 in k1 and r2 in k2, plus a free rect `free` outside any layer. */
function fixture(): Project {
  const p = createProject({ fps: 10 });
  const asset = createVectorAsset('rect', { id: 'va' });
  p.assets.push(asset);
  const L = createFrameLayer({ id: 'L', zOrder: 0, keys: layer.keys, end: layer.end });
  const r1 = createSceneObject('va', { id: 'r1', parentId: 'L', frameKeyId: 'k1', zOrder: 1, shapeBase: { width: 10, height: 10 } });
  const r2 = createSceneObject('va', { id: 'r2', parentId: 'L', frameKeyId: 'k2', zOrder: 2, shapeBase: { width: 10, height: 10 } });
  const free = createSceneObject('va', { id: 'free', zOrder: 3, shapeBase: { width: 10, height: 10 } });
  p.objects.push(L, r1, r2, free);
  return p;
}

const byId = (objs: SceneObject[]) => new Map(objs.map((o) => [o.id, o] as const));

describe('frameKeySpans / exposedFrameKeyId', () => {
  it('derives half-open spans from sorted keys, the last ending at `end`', () => {
    expect(frameKeySpans(layer)).toEqual([
      { id: 'k1', start: 0, end: 0.5 },
      { id: 'k2', start: 0.5, end: 1 },
      { id: 'k3', start: 1, end: 1.5 },
    ]);
  });

  it('sorts unsorted input without mutating it', () => {
    const shuffled: FrameLayer = { keys: [layer.keys[2], layer.keys[0], layer.keys[1]], end: 1.5 };
    expect(frameKeySpans(shuffled).map((s) => s.id)).toEqual(['k1', 'k2', 'k3']);
    expect(shuffled.keys[0].id).toBe('k3');
  });

  it('picks the key under the playhead: start inclusive, next start / end exclusive', () => {
    expect(exposedFrameKeyId(layer, 0)).toBe('k1');
    expect(exposedFrameKeyId(layer, 0.4999)).toBe('k1');
    expect(exposedFrameKeyId(layer, 0.5)).toBe('k2');
    expect(exposedFrameKeyId(layer, 0.5 - 1e-9)).toBe('k2'); // float frame math lands on the key
    expect(exposedFrameKeyId(layer, 1.2)).toBe('k3');
    expect(exposedFrameKeyId(layer, 1.5)).toBeNull();
    expect(exposedFrameKeyId(layer, 9)).toBeNull();
  });

  it('shows nothing before the first key', () => {
    expect(exposedFrameKeyId({ keys: [{ id: 'a', time: 1 }], end: 2 }, 0.5)).toBeNull();
  });
});

describe('isExposedAt', () => {
  it('is undefined for an object outside any frame layer (parity)', () => {
    const p = fixture();
    const m = byId(p.objects);
    expect(isExposedAt(m.get('free')!, m, 0)).toBeUndefined();
    expect(isExposedAt(m.get('L')!, m, 0)).toBeUndefined(); // the layer itself is not keyed
  });

  it('tracks each child key window', () => {
    const p = fixture();
    const m = byId(p.objects);
    const r1 = m.get('r1')!;
    const r2 = m.get('r2')!;
    expect([isExposedAt(r1, m, 0), isExposedAt(r2, m, 0)]).toEqual([true, false]);
    expect([isExposedAt(r1, m, 0.7), isExposedAt(r2, m, 0.7)]).toEqual([false, true]);
    expect([isExposedAt(r1, m, 1.2), isExposedAt(r2, m, 1.2)]).toEqual([false, false]); // blank key
    expect([isExposedAt(r1, m, 2), isExposedAt(r2, m, 2)]).toEqual([false, false]); // past end
  });

  it('treats a missing or dangling frameKeyId as always exposed (not frame-controlled)', () => {
    const p = fixture();
    const loose = createSceneObject('va', { id: 'loose', parentId: 'L' });
    const dangling = createSceneObject('va', { id: 'dang', parentId: 'L', frameKeyId: 'nope' });
    p.objects.push(loose, dangling);
    const m = byId(p.objects);
    expect(isExposedAt(loose, m, 0.7)).toBeUndefined();
    expect(isExposedAt(dangling, m, 0.7)).toBeUndefined();
  });

  it('ignores frameKeyId when the parent is an ordinary group', () => {
    const g = createGroupObject({ id: 'g', anchorX: 0, anchorY: 0, zOrder: 0 });
    const c = createSceneObject('va', { id: 'c', parentId: 'g', frameKeyId: 'k1' });
    const m = byId([g, c]);
    expect(isExposedAt(c, m, 0)).toBeUndefined();
  });

  it('cascades through nested groups and nested frame layers', () => {
    const outer = createFrameLayer({ id: 'O', zOrder: 0, keys: [{ id: 'a', time: 0 }, { id: 'b', time: 1 }], end: 2 });
    // inner layer lives in outer key 'a'; its own keys swap at 0.5
    const inner = { ...createFrameLayer({ id: 'I', zOrder: 1, keys: [{ id: 'x', time: 0 }, { id: 'y', time: 0.5 }], end: 2 }), parentId: 'O', frameKeyId: 'a' };
    const grp = { ...createGroupObject({ id: 'G', anchorX: 0, anchorY: 0, zOrder: 2 }), parentId: 'I', frameKeyId: 'y' };
    const leaf = createSceneObject('va', { id: 'leaf', parentId: 'G' });
    const m = byId([outer, inner, grp, leaf]);
    expect(isExposedAt(leaf, m, 0.2)).toBe(false); // inner shows x
    expect(isExposedAt(leaf, m, 0.7)).toBe(true); // inner shows y, outer shows a
    expect(isExposedAt(leaf, m, 1.2)).toBe(false); // outer moved on to b
  });

  it('terminates on a corrupt parentId cycle', () => {
    const a = { ...createFrameLayer({ id: 'A', zOrder: 0, keys: [{ id: 'k', time: 0 }], end: 1 }), parentId: 'B', frameKeyId: 'k' };
    const b = { ...createFrameLayer({ id: 'B', zOrder: 0, keys: [{ id: 'k', time: 0 }], end: 1 }), parentId: 'A', frameKeyId: 'k' };
    const m = byId([a, b]);
    expect(isExposedAt(a, m, 0.5)).toBe(true);
    expect(isExposedAt(a, m, 5)).toBe(false);
  });

  it('isFrameLayer recognises only groups with frames', () => {
    const p = fixture();
    const m = byId(p.objects);
    expect(isFrameLayer(m.get('L')!)).toBe(true);
    expect(isFrameLayer(m.get('r1')!)).toBe(false);
  });
});

describe('flattenInstances exposure flag', () => {
  it('emits every leaf at every time, flagging only frame-controlled ones', () => {
    const p = fixture();
    const at = (t: number) => Object.fromEntries(flattenInstances(p, t).map((l) => [l.renderId, l.exposed]));
    expect(at(0)).toEqual({ r1: true, r2: false, free: undefined });
    expect(at(0.7)).toEqual({ r1: false, r2: true, free: undefined });
    expect(at(1.2)).toEqual({ r1: false, r2: false, free: undefined });
  });

  it('adds no `exposed` key at all in a project without frame layers (parity)', () => {
    const p = fixture();
    p.objects = p.objects.filter((o) => o.id === 'free');
    expect(flattenInstances(p, 0).every((l) => !('exposed' in l))).toBe(true);
  });

  it('propagates an instance key exposure to all of its leaves', () => {
    const p = fixture();
    const sym = createSymbolAsset({ id: 'S', objects: [createSceneObject('va', { id: 's1', shapeBase: { width: 1, height: 1 } })] });
    p.assets.push(sym);
    p.objects.push(createSceneObject('S', { id: 'inst', parentId: 'L', frameKeyId: 'k2' }));
    const leaf = (t: number) => flattenInstances(p, t).find((l) => l.renderId === 'inst/s1')!;
    expect(leaf(0).exposed).toBe(false);
    expect(leaf(0.7).exposed).toBe(true);
  });

  it('runs a frame layer inside a symbol on the instance remapped clock (looping walk cycle)', () => {
    const p = createProject({ fps: 10 });
    p.assets.push(createVectorAsset('rect', { id: 'va' }));
    const walk = createSymbolAsset({
      id: 'W',
      objects: [
        createFrameLayer({ id: 'WL', zOrder: 0, keys: [{ id: 'a', time: 0 }, { id: 'b', time: 0.2 }], end: 0.4 }),
        createSceneObject('va', { id: 'pa', parentId: 'WL', frameKeyId: 'a' }),
        createSceneObject('va', { id: 'pb', parentId: 'WL', frameKeyId: 'b' }),
      ],
    });
    p.assets.push(walk);
    p.objects.push(createSceneObject('W', { id: 'w', symbolTime: { startOffset: 0, loop: true, speed: 1 } }));
    const shown = (t: number) => flattenInstances(p, t).filter((l) => l.exposed).map((l) => l.renderId);
    expect(shown(0.1)).toEqual(['w/pa']);
    expect(shown(0.3)).toEqual(['w/pb']);
    expect(shown(0.5)).toEqual(['w/pa']); // looped (cycle = end = 0.4)
    expect(shown(0.7)).toEqual(['w/pb']);
  });
});

describe('duration + keyframe times', () => {
  it('auto duration runs to the layer end', () => {
    expect(computeProjectDuration(fixture())).toBeCloseTo(1.5);
  });

  it('a symbol with a frame layer has an effective duration and is not static', () => {
    const sym = createSymbolAsset({
      id: 'S',
      objects: [createFrameLayer({ id: 'L', zOrder: 0, keys: [{ id: 'a', time: 0 }], end: 0.3 })],
    });
    expect(symbolEffectiveDuration(sym)).toBeCloseTo(0.3);
    expect(isStaticSymbol(sym, new Map([[sym.id, sym]]))).toBe(false);
  });

  it('objectKeyframeTimes includes frame key times', () => {
    const L = fixture().objects[0];
    expect(objectKeyframeTimes(L)).toEqual([0, 0.5, 1]);
  });
});
