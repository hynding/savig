import { describe, expect, it } from 'vitest';
import { bakeShapeTween, freezeTweenedDrawing, layerLocalPath, rebakeLayerTweens, removeShapeTween, tweenableDrawing } from './frameTween';
import { createFrameLayer, createSceneObject, createVectorAsset } from './project';
import { samplePath } from './path';
import { sampleObject } from './sample';
import type { Asset, SceneObject, VectorAsset } from './types';

const rectAsset = createVectorAsset('rect', { id: 'ra', style: { fill: '#ff0000', stroke: 'none', strokeWidth: 0 } });
const ellAsset = createVectorAsset('ellipse', { id: 'ea', style: { fill: '#0000ff', stroke: 'none', strokeWidth: 0 } });

function scene(extra: SceneObject[] = []) {
  const L = createFrameLayer({
    id: 'L',
    zOrder: 0,
    keys: [
      { id: 'k1', time: 0 },
      { id: 'k2', time: 1 },
    ],
    end: 2,
  });
  const r = createSceneObject('ra', {
    id: 'r',
    parentId: 'L',
    frameKeyId: 'k1',
    zOrder: 1,
    anchorMode: 'fraction',
    shapeBase: { width: 10, height: 20 },
    base: { x: 100, y: 50, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
  });
  const e = createSceneObject('ea', {
    id: 'e',
    parentId: 'L',
    frameKeyId: 'k2',
    zOrder: 2,
    anchorMode: 'fraction',
    shapeBase: { radiusX: 5, radiusY: 5 },
    base: { x: 200, y: 50, scaleX: 1, scaleY: 1, rotation: 0, opacity: 0.5 },
  });
  return { objects: [L, r, e, ...extra], assets: [rectAsset, ellAsset] as Asset[] };
}

const ok = <T,>(r: T | { error: string }): T => {
  if ((r as { error?: string }).error) throw new Error((r as { error: string }).error);
  return r as T;
};

describe('layerLocalPath', () => {
  it('maps a rect through its own transform', () => {
    const { objects } = scene();
    const p = layerLocalPath(objects[1], rectAsset as VectorAsset, 0)!;
    expect(p.closed).toBe(true);
    expect(p.nodes.map((n) => n.anchor)).toEqual([
      { x: 100, y: 50 },
      { x: 110, y: 50 },
      { x: 110, y: 70 },
      { x: 100, y: 70 },
    ]);
  });

  it('rotates handles with the drawing (ellipse rotated 90°)', () => {
    const { objects } = scene();
    const e = { ...objects[2], anchorX: 0.5, anchorY: 0.5, base: { ...objects[2].base, rotation: 90 } };
    const p = layerLocalPath(e, ellAsset as VectorAsset, 0)!;
    expect(p.nodes).toHaveLength(4);
    // first node (rightmost before rotation) maps to the bottom; its out-handle now points left.
    expect(p.nodes[0].anchor.x).toBeCloseTo(205);
    expect(p.nodes[0].anchor.y).toBeCloseTo(60);
    expect(p.nodes[0].out!.x).toBeLessThan(0);
    expect(p.nodes[0].out!.y).toBeCloseTo(0);
  });

  it('rounded rects get 8 nodes', () => {
    const { objects } = scene();
    const r = { ...objects[1], shapeBase: { width: 10, height: 20, cornerRadius: 3 } };
    expect(layerLocalPath(r, rectAsset as VectorAsset, 0)!.nodes).toHaveLength(8);
  });

  it('is null for degenerate geometry', () => {
    const { objects } = scene();
    expect(layerLocalPath({ ...objects[1], shapeBase: { width: 0, height: 5 } }, rectAsset as VectorAsset, 0)).toBeNull();
  });
});

describe('tweenableDrawing', () => {
  it('accepts vector leaves and rejects groups, masks, compound paths', () => {
    const { objects } = scene();
    expect(tweenableDrawing(objects[1], rectAsset)).toBe(true);
    expect(tweenableDrawing({ ...objects[1], isMask: true }, rectAsset)).toBe(false);
    expect(tweenableDrawing({ ...objects[1], hidden: true }, rectAsset)).toBe(false);
    const compound = createVectorAsset('path', { path: { nodes: [], closed: true }, compoundRings: [{ nodes: [], closed: true }] });
    expect(tweenableDrawing(objects[1], compound)).toBe(false);
    expect(tweenableDrawing(objects[1], undefined)).toBe(false);
  });
});

describe('bakeShapeTween', () => {
  it('morphs key A drawing into key B drawing over the span', () => {
    const s = scene();
    const res = ok(bakeShapeTween(s.objects, s.assets, 'L', 'k1'));
    const r = res.objects.find((o) => o.id === 'r')!;
    const asset = res.assets.find((a) => a.id === r.assetId) as VectorAsset;
    expect(asset.shapeType).toBe('path');
    expect(asset.style.fill).toBe('#ff0000');
    expect(r.base).toMatchObject({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 });
    expect(r.shapeTrack).toHaveLength(2);
    expect(r.shapeTrack![0].time).toBe(0);
    expect(r.shapeTrack![1].time).toBe(1);
    // rect (4) → ellipse (4), both closed: index morph
    expect(r.shapeTrack![0].morph).toBeUndefined();
    expect(samplePath(r.shapeTrack!, 1).nodes[0].anchor).toEqual({ x: 210, y: 55 });
    // colour + opacity blend
    expect(r.colorTracks?.fill?.map((k) => k.value)).toEqual(['#ff0000', '#0000ff']);
    expect(r.tracks.opacity?.map((k) => k.value)).toEqual([1, 0.5]);
    expect(sampleObject(r, 0.5).opacity).toBeCloseTo(0.75);
    // the layer key records it, key B is untouched
    const L = res.objects.find((o) => o.id === 'L')!;
    expect(L.frames!.keys[0].tween).toEqual({ kind: 'shape' });
    expect(res.objects.find((o) => o.id === 'e')).toBe(s.objects[2]);
  });

  it('uses resampled morph when node counts differ, and carries easing', () => {
    const s = scene();
    const tri = createVectorAsset('path', {
      id: 'pa',
      path: { closed: true, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 5, y: 9 } }] },
    });
    const objects = s.objects.map((o) => (o.id === 'e' ? { ...o, assetId: 'pa', shapeBase: undefined } : o));
    const res = ok(bakeShapeTween(objects, [...s.assets, tri], 'L', 'k1', { easing: 'easeInOut' }));
    const r = res.objects.find((o) => o.id === 'r')!;
    expect(r.shapeTrack![0].morph).toBe('resampled');
    expect(r.shapeTrack![0].easing).toBe('easeInOut');
    expect(res.tween).toEqual({ kind: 'shape', easing: 'easeInOut' });
  });

  it('shrinks an unpartnered A drawing into its centre', () => {
    const s = scene();
    const objects = s.objects.filter((o) => o.id !== 'e');
    const res = ok(bakeShapeTween(objects, s.assets, 'L', 'k1'));
    const r = res.objects.find((o) => o.id === 'r')!;
    expect(r.shapeTrack![1].path.nodes.every((n) => n.anchor.x === 105 && n.anchor.y === 60)).toBe(true);
    expect(r.colorTracks).toBeUndefined();
  });

  it('grows an unpartnered B drawing out of its centre in key A', () => {
    const s = scene();
    const objects = s.objects.filter((o) => o.id !== 'r');
    const res = ok(bakeShapeTween(objects, s.assets, 'L', 'k1'));
    expect(res.tween.created).toHaveLength(1);
    const g = res.objects.find((o) => o.id === res.tween.created![0])!;
    expect(g.frameKeyId).toBe('k1');
    expect(g.shapeTrack![0].path.nodes.every((n) => n.anchor.x === 205 && n.anchor.y === 55)).toBe(true);
    expect(g.base.opacity).toBe(0.5);
  });

  it('refuses the last key and a key with nothing tweenable', () => {
    const s = scene();
    expect(bakeShapeTween(s.objects, s.assets, 'L', 'k2')).toEqual({ error: expect.stringMatching(/following/) });
    const bare = s.objects.filter((o) => o.id === 'L');
    expect(bakeShapeTween(bare, s.assets, 'L', 'k1')).toEqual({ error: expect.stringMatching(/Nothing/) });
  });

  it('re-baking is idempotent in shape', () => {
    const s = scene();
    const once = ok(bakeShapeTween(s.objects, s.assets, 'L', 'k1'));
    const twice = ok(bakeShapeTween(once.objects, once.assets, 'L', 'k1'));
    const a = once.objects.find((o) => o.id === 'r')!;
    const b = twice.objects.find((o) => o.id === 'r')!;
    expect(b.shapeTrack).toEqual(a.shapeTrack);
    expect(b.colorTracks).toEqual(a.colorTracks);
  });

  it('re-baking replaces previously created objects', () => {
    const s = scene();
    const objects = s.objects.filter((o) => o.id !== 'r');
    const once = ok(bakeShapeTween(objects, s.assets, 'L', 'k1'));
    const twice = ok(bakeShapeTween(once.objects, once.assets, 'L', 'k1'));
    expect(twice.objects.filter((o) => o.frameKeyId === 'k1')).toHaveLength(1);
    expect(twice.objects.some((o) => o.id === once.tween.created![0])).toBe(false);
  });
});

describe('removeShapeTween', () => {
  it('restores a static path at the A shape and deletes created objects', () => {
    const s = scene();
    const baked = ok(bakeShapeTween(s.objects, s.assets, 'L', 'k1'));
    const out = removeShapeTween(baked.objects, baked.assets, 'L', 'k1');
    const r = out.objects.find((o) => o.id === 'r')!;
    expect(r.shapeTrack).toBeUndefined();
    expect(r.colorTracks).toBeUndefined();
    expect(r.tracks.opacity).toBeUndefined();
    const asset = out.assets.find((a) => a.id === r.assetId) as VectorAsset;
    expect(asset.path!.nodes[0].anchor).toEqual({ x: 100, y: 50 });
    expect(asset.style.fill).toBe('#ff0000');
    expect(out.objects.find((o) => o.id === 'L')!.frames!.keys[0].tween).toBeUndefined();
  });

  it('is a no-op without a tween', () => {
    const s = scene();
    const out = removeShapeTween(s.objects, s.assets, 'L', 'k1');
    expect(out.objects).toBe(s.objects);
  });
});

describe('freezeTweenedDrawing', () => {
  it('captures the mid-tween shape, colour and opacity', () => {
    const s = scene();
    const baked = ok(bakeShapeTween(s.objects, s.assets, 'L', 'k1'));
    const r = baked.objects.find((o) => o.id === 'r')!;
    const f = freezeTweenedDrawing(r, baked.assets.find((a) => a.id === r.assetId) as VectorAsset, 0.5)!;
    expect(f.object.shapeTrack).toBeUndefined();
    expect(f.object.base.opacity).toBeCloseTo(0.75);
    expect(f.asset.style.fill).not.toBe('#ff0000');
    expect(f.asset.path).toEqual(samplePath(r.shapeTrack!, 0.5));
    expect(freezeTweenedDrawing(s.objects[1], rectAsset as VectorAsset, 0)).toBeNull();
  });
});

describe('rebakeLayerTweens', () => {
  const moveKey = (objects: SceneObject[], keyId: string, time: number) =>
    objects.map((o) => (o.id === 'L' ? { ...o, frames: { ...o.frames!, keys: o.frames!.keys.map((k) => (k.id === keyId ? { ...k, time } : k)) } } : o));

  it('re-times the morph to the moved key', () => {
    const s = scene();
    const baked = ok(bakeShapeTween(s.objects, s.assets, 'L', 'k1'));
    const out = rebakeLayerTweens(moveKey(baked.objects, 'k2', 1.5), baked.assets, 'L');
    const r = out.objects.find((o) => o.id === 'r')!;
    expect(r.shapeTrack!.map((k) => k.time)).toEqual([0, 1.5]);
    expect(r.shapeTrack![0].path).toEqual(baked.objects.find((o) => o.id === 'r')!.shapeTrack![0].path);
  });

  it('removes a tween whose key became last', () => {
    const s = scene();
    const baked = ok(bakeShapeTween(s.objects, s.assets, 'L', 'k1'));
    const objects = baked.objects
      .filter((o) => o.id !== 'e')
      .map((o) => (o.id === 'L' ? { ...o, frames: { ...o.frames!, keys: o.frames!.keys.filter((k) => k.id === 'k1') } } : o));
    const out = rebakeLayerTweens(objects, baked.assets, 'L');
    expect(out.objects.find((o) => o.id === 'r')!.shapeTrack).toBeUndefined();
    expect(out.objects.find((o) => o.id === 'L')!.frames!.keys[0].tween).toBeUndefined();
  });

  it('is a no-op on a layer without tweens', () => {
    const s = scene();
    expect(rebakeLayerTweens(s.objects, s.assets, 'L').objects).toBe(s.objects);
  });
});
