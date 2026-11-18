import { describe, expect, it } from 'vitest';
import { applyWidthProfile } from './widthApply';
import { removeWidthStation, setWidthStation, widthAtPoint } from './widthStroke';
import { flattenPath } from './arcLength';
import { createSceneObject, createVectorAsset } from '../project';
import type { Asset, SceneObject, VectorAsset } from '../types';

const stroke = { fill: 'none', stroke: '#000', strokeWidth: 4 };
const line = { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }] };

function scene(asset: VectorAsset, extra: Partial<SceneObject> = {}): { objects: SceneObject[]; assets: Asset[] } {
  return { objects: [createSceneObject(asset.id, { id: 'o', ...extra })], assets: [asset] };
}
const ok = (r: ReturnType<typeof applyWidthProfile>) => {
  if ('refused' in r) throw new Error(r.refused);
  return r;
};

describe('applyWidthProfile', () => {
  it('puts a normalized profile on a path asset, and clears it', () => {
    const { objects, assets } = scene(createVectorAsset('path', { id: 'a', path: line, style: stroke }));
    const set = ok(applyWidthProfile(objects, assets, 'o', [{ t: 1, w: 0 }, { t: 0, w: 2 }], 0));
    expect((set.assets[0] as VectorAsset).style.widthProfile).toEqual([{ t: 0, w: 2 }, { t: 1, w: 0 }]);
    expect(set.objects).toBe(objects);
    const cleared = ok(applyWidthProfile(set.objects, set.assets, 'o', null, 0));
    expect('widthProfile' in (cleared.assets[0] as VectorAsset).style).toBe(false);
    // clearing something with no profile changes nothing
    expect(ok(applyWidthProfile(objects, assets, 'o', [], 0)).assets).toBe(assets);
  });

  it('turns a rect into a path first, pinning the pivot', () => {
    const { objects, assets } = scene(createVectorAsset('rect', { id: 'a', style: stroke }), { shapeBase: { width: 40, height: 20 }, anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5 });
    const r = ok(applyWidthProfile(objects, assets, 'o', [{ t: 0, w: 2 }], 0));
    const a = r.assets[0] as VectorAsset;
    expect(a.shapeType).toBe('path');
    expect(a.path!.closed).toBe(true);
    expect(r.objects[0]).toMatchObject({ anchorMode: 'absolute', anchorX: 20, anchorY: 10 });
    expect(r.objects[0].shapeBase).toBeUndefined();
  });

  it('copies a shared asset before converting', () => {
    const asset = createVectorAsset('ellipse', { id: 'a', style: stroke });
    const objects = [createSceneObject('a', { id: 'o', shapeBase: { radiusX: 10, radiusY: 10 } }), createSceneObject('a', { id: 'p' })];
    const r = ok(applyWidthProfile(objects, [asset], 'o', [{ t: 0, w: 2 }], 0));
    expect(r.assets).toHaveLength(2);
    expect(r.objects[0].assetId).toBe('a-o');
    expect(r.objects[1].assetId).toBe('a');
  });

  it('refuses no stroke, live booleans, locks and animated rect sizes', () => {
    const plain = scene(createVectorAsset('path', { id: 'a', path: line }));
    expect(applyWidthProfile(plain.objects, plain.assets, 'o', [{ t: 0, w: 2 }], 0)).toEqual({ refused: 'no-stroke' });
    const locked = scene(createVectorAsset('path', { id: 'a', path: line, style: stroke }), { locked: true });
    expect(applyWidthProfile(locked.objects, locked.assets, 'o', [{ t: 0, w: 2 }], 0)).toEqual({ refused: 'locked' });
    const bool = scene(createVectorAsset('path', { id: 'a', path: line, style: stroke }), { boolean: { op: 'union', operands: [] } as never });
    expect(applyWidthProfile(bool.objects, bool.assets, 'o', [{ t: 0, w: 2 }], 0)).toEqual({ refused: 'live-boolean' });
    const anim = scene(createVectorAsset('rect', { id: 'a', style: stroke }), { tracks: { width: [{ time: 0, value: 5, easing: 'linear' }] } });
    expect(applyWidthProfile(anim.objects, anim.assets, 'o', [{ t: 0, w: 2 }], 0)).toEqual({ refused: 'animated-shape' });
    expect(applyWidthProfile(anim.objects, anim.assets, 'nope', [], 0)).toEqual({ refused: 'not-a-drawing' });
  });
});

describe('width station editing', () => {
  it('moves a nearby station, else adds one; uniform comes back empty', () => {
    const p = [{ t: 0, w: 1 }, { t: 1, w: 0 }];
    expect(setWidthStation(p, 0.99, 2)).toEqual([{ t: 0, w: 1 }, { t: 1, w: 2 }]);
    expect(setWidthStation(p, 0.5, 3)).toEqual([{ t: 0, w: 1 }, { t: 0.5, w: 3 }, { t: 1, w: 0 }]);
    expect(setWidthStation(undefined, 0.5, 1)).toEqual([]);
    expect(setWidthStation([], 0.5, 2)).toEqual([{ t: 0, w: 1 }, { t: 0.5, w: 2 }, { t: 1, w: 1 }]);
    expect(removeWidthStation(p, 1)).toEqual([]);
    expect(removeWidthStation([...p, { t: 0.5, w: 3 }], 1)).toEqual([{ t: 0, w: 1 }, { t: 0.5, w: 3 }]);
  });

  it('widthAtPoint finds the spot along the stroke and the width reaching the pointer', () => {
    expect(widthAtPoint(flattenPath(line), 4, { x: 25, y: 6 })).toEqual({ t: 0.25, w: 3 });
  });
});
