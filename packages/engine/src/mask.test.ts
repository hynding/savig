import { describe, expect, it } from 'vitest';
import {
  createFrameLayer,
  createGroupObject,
  createProject,
  createSceneObject,
  createSymbolAsset,
  createVectorAsset,
} from './project';
import { maskChainFor, maskContentRoot, maskDefId, maskedObjectIds, resolveMaskTarget } from './mask';
import { flattenInstances } from './symbol';
import type { Project, SceneObject } from './types';

const byId = (objs: SceneObject[]) => new Map(objs.map((o) => [o.id, o] as const));
const rect = (id: string, extra: Partial<SceneObject> = {}) =>
  createSceneObject('va', { id, shapeBase: { width: 10, height: 10 }, ...extra });

function project(objects: SceneObject[]): Project {
  const p = createProject();
  p.assets.push(createVectorAsset('rect', { id: 'va' }));
  p.objects.push(...objects);
  return p;
}

describe('resolveMaskTarget', () => {
  it('honours a link to a visible isMask object in the same list', () => {
    const objs = [rect('m', { isMask: true }), rect('a', { maskedBy: 'm' })];
    expect(resolveMaskTarget(objs[1], byId(objs))?.id).toBe('m');
  });

  it('ignores dangling, not-a-mask, self and hidden masks', () => {
    const objs = [
      rect('plain'),
      rect('hid', { isMask: true, hidden: true }),
      rect('a', { maskedBy: 'nope' }),
      rect('b', { maskedBy: 'plain' }),
      rect('c', { maskedBy: 'c', isMask: true }),
      rect('d', { maskedBy: 'hid' }),
    ];
    const m = byId(objs);
    for (const id of ['a', 'b', 'c', 'd']) expect(resolveMaskTarget(m.get(id)!, m)).toBeNull();
  });

  it('ignores a mask that is the object’s own ancestor or inside its subtree', () => {
    const g = { ...createGroupObject({ id: 'g', anchorX: 0, anchorY: 0, zOrder: 0 }), isMask: true, maskedBy: 'kid' };
    const kid = rect('kid', { parentId: 'g', maskedBy: 'g', isMask: true });
    const m = byId([g, kid]);
    expect(resolveMaskTarget(kid, m)).toBeNull();
    expect(resolveMaskTarget(g, m)).toBeNull();
  });

  it('a mask under a hidden group is not honoured', () => {
    const g = { ...createGroupObject({ id: 'g', anchorX: 0, anchorY: 0, zOrder: 0 }), hidden: true };
    const objs = [g, rect('m', { parentId: 'g', isMask: true }), rect('a', { maskedBy: 'm' })];
    expect(resolveMaskTarget(objs[2], byId(objs))).toBeNull();
  });
});

describe('maskContentRoot / maskChainFor', () => {
  it('the topmost isMask ancestor names the mask; content has no chain', () => {
    const g = { ...createGroupObject({ id: 'g', anchorX: 0, anchorY: 0, zOrder: 0 }), isMask: true };
    const kid = rect('kid', { parentId: 'g', maskedBy: 'other' });
    const m = byId([g, kid]);
    expect(maskContentRoot(kid, m)?.id).toBe('g');
    expect(maskChainFor(kid, m)).toEqual([]);
  });

  it('stacks group masks outermost first', () => {
    const g = { ...createGroupObject({ id: 'g', anchorX: 0, anchorY: 0, zOrder: 0 }), maskedBy: 'm1' };
    const objs = [g, rect('m1', { isMask: true }), rect('m2', { isMask: true }), rect('a', { parentId: 'g', maskedBy: 'm2' })];
    expect(maskChainFor(objs[3], byId(objs)).map((o) => o.id)).toEqual(['m1', 'm2']);
  });

  it('maskDefId namespaces by instance path; maskedObjectIds lists links', () => {
    expect(maskDefId('', 'm')).toBe('savig-mask-m');
    expect(maskDefId('inst', 'm')).toBe('savig-mask-inst/m');
    expect(maskedObjectIds([rect('a', { maskedBy: 'm' }), rect('b'), rect('c', { maskedBy: 'm' })], 'm')).toEqual(['a', 'c']);
  });
});

describe('flattenInstances with masks', () => {
  it('parity: no mask fields → no mask fields on leaves', () => {
    const leaves = flattenInstances(project([rect('a'), rect('b', { zOrder: 1 })]), 0);
    for (const l of leaves) {
      expect(l).not.toHaveProperty('maskChain');
      expect(l).not.toHaveProperty('maskOf');
    }
  });

  it('marks mask content with maskOf and masked leaves with maskChain', () => {
    const leaves = flattenInstances(
      project([rect('a', { zOrder: 0, maskedBy: 'm' }), rect('m', { zOrder: 1, isMask: true }), rect('free', { zOrder: 2 })]),
      0,
    );
    const by = new Map(leaves.map((l) => [l.renderId, l]));
    expect(by.get('m')!.maskOf).toBe('savig-mask-m');
    expect(by.get('m')!.maskChain).toBeUndefined();
    expect(by.get('a')!.maskChain).toEqual(['savig-mask-m']);
    expect(by.get('free')!.maskChain).toBeUndefined();
  });

  it('a hidden mask: its content vanishes and its targets render unmasked', () => {
    const leaves = flattenInstances(project([rect('a', { maskedBy: 'm' }), rect('m', { isMask: true, hidden: true })]), 0);
    expect(leaves.map((l) => l.renderId)).toEqual(['a']);
    expect(leaves[0].maskChain).toBeUndefined();
  });

  it('a group mask: every descendant leaf is content; a masked group masks its subtree', () => {
    const mg = { ...createGroupObject({ id: 'mg', anchorX: 0, anchorY: 0, zOrder: 0 }), isMask: true };
    const tg = { ...createGroupObject({ id: 'tg', anchorX: 0, anchorY: 0, zOrder: 3 }), maskedBy: 'mg' };
    const leaves = flattenInstances(
      project([mg, rect('m1', { parentId: 'mg', zOrder: 1 }), rect('m2', { parentId: 'mg', zOrder: 2 }), tg, rect('t1', { parentId: 'tg', zOrder: 4 })]),
      0,
    );
    const by = new Map(leaves.map((l) => [l.renderId, l]));
    expect(by.get('m1')!.maskOf).toBe('savig-mask-mg');
    expect(by.get('m2')!.maskOf).toBe('savig-mask-mg');
    expect(by.get('t1')!.maskChain).toEqual(['savig-mask-mg']);
  });

  it('a frame-layer mask keeps per-key exposure on its content', () => {
    const L = { ...createFrameLayer({ id: 'L', zOrder: 0, keys: [{ id: 'k1', time: 0 }, { id: 'k2', time: 0.5 }], end: 1 }), isMask: true };
    const p = project([L, rect('d1', { parentId: 'L', frameKeyId: 'k1', zOrder: 1 }), rect('d2', { parentId: 'L', frameKeyId: 'k2', zOrder: 2 }), rect('a', { maskedBy: 'L', zOrder: 3 })]);
    const at = (t: number) => new Map(flattenInstances(p, t).map((l) => [l.renderId, l]));
    expect(at(0).get('d1')).toMatchObject({ maskOf: 'savig-mask-L', exposed: true });
    expect(at(0.6).get('d1')).toMatchObject({ maskOf: 'savig-mask-L', exposed: false });
    expect(at(0.6).get('a')!.maskChain).toEqual(['savig-mask-L']);
  });

  it('symbol instances: internal masks are namespaced per instance and nest inside the instance mask', () => {
    const sym = createSymbolAsset({
      id: 'S',
      objects: [rect('im', { isMask: true, zOrder: 0 }), rect('ia', { maskedBy: 'im', zOrder: 1 })],
    });
    const p = project([
      createSceneObject('S', { id: 'i1', zOrder: 0, maskedBy: 'win' }),
      createSceneObject('S', { id: 'i2', zOrder: 1 }),
      rect('win', { isMask: true, zOrder: 2 }),
    ]);
    p.assets.push(sym);
    const by = new Map(flattenInstances(p, 0).map((l) => [l.renderId, l]));
    expect(by.get('i1/im')!.maskOf).toBe('savig-mask-i1/im');
    expect(by.get('i1/ia')!.maskChain).toEqual(['savig-mask-win', 'savig-mask-i1/im']);
    expect(by.get('i2/ia')!.maskChain).toEqual(['savig-mask-i2/im']);
    expect(by.get('win')!.maskOf).toBe('savig-mask-win');
  });

  it('a symbol instance used as a mask: all its leaves are content, inner masks draw nowhere, no clip/tint', () => {
    const sym = createSymbolAsset({
      id: 'S',
      clip: true,
      width: 5,
      height: 5,
      objects: [rect('s1', { zOrder: 0 }), rect('innerMask', { isMask: true, zOrder: 1 })],
    });
    const p = project([
      createSceneObject('S', { id: 'mi', zOrder: 0, isMask: true, tint: { color: '#f00', amount: 1 } }),
      rect('a', { maskedBy: 'mi', zOrder: 1 }),
    ]);
    p.assets.push(sym);
    const leaves = flattenInstances(p, 0);
    expect(leaves.map((l) => l.renderId)).toEqual(['mi/s1', 'a']);
    expect(leaves[0]).toMatchObject({ maskOf: 'savig-mask-mi' });
    expect(leaves[0].clipId).toBeUndefined();
    expect(leaves[0].tintId).toBeUndefined();
    expect(leaves[1].maskChain).toEqual(['savig-mask-mi']);
  });
});
