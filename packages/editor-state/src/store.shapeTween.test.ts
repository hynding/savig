// Shape tween slice 1 (spec 2026-11-13-shape-tween): createShapeTween / removeShapeTween and the
// re-bake that keeps a tween in step with key timing edits.
import { describe, it, expect, beforeEach } from 'vitest';
import { store } from './store';
import { createProject, exposedFrameKeyId, samplePath } from '@savig/engine';
import type { FrameLayer, SceneObject, VectorAsset } from '@savig/engine';
import { selectActiveObjects } from './selectors';

const FPS = 10;
const f = (n: number) => n / FPS;

beforeEach(() => {
  store.getState().setProject(createProject({ fps: FPS, duration: 2, durationMode: 'manual' }));
});

const st = () => store.getState();
const objects = (): SceneObject[] => selectActiveObjects(st());
const layerObj = () => objects().find((o) => o.frames) as SceneObject & { frames: FrameLayer };
const drawingOf = (keyIndex: number) => {
  const L = layerObj();
  const k = L.frames.keys[keyIndex];
  return objects().filter((o) => o.parentId === L.id && o.frameKeyId === k.id);
};

/** Layer with a 10×10 rect on key 0 (frame 0) and a 20×20 ellipse on key 1 (frame 10). */
function twoKeys() {
  st().newFrameLayer();
  st().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  st().seek(f(10));
  st().insertBlankFrameKeyframe();
  st().addVectorShape('ellipse', { x: 50, y: 0, width: 20, height: 20 });
  st().selectObject(layerObj().id);
  st().seek(f(3));
}

describe('createShapeTween', () => {
  it('bakes key A into a morph toward key B in one undo step', () => {
    twoKeys();
    const before = st().history.present;
    st().createShapeTween();
    const L = layerObj();
    expect(L.frames.keys[0].tween).toEqual({ kind: 'shape' });
    const [a] = drawingOf(0);
    expect(a.shapeTrack!.map((k) => k.time)).toEqual([0, 1]);
    const assets = st().history.present.assets;
    expect((assets.find((x) => x.id === a.assetId) as VectorAsset).shapeType).toBe('path');
    // the replaced rect asset is pruned
    expect(assets.filter((x) => x.kind === 'vector')).toHaveLength(2);
    const mid = samplePath(a.shapeTrack!, 0.5);
    expect(mid).not.toEqual(a.shapeTrack![0].path);
    st().undo();
    expect(st().history.present).toBe(before);
  });

  it('re-running updates the tween from the current drawings and keeps the easing', () => {
    twoKeys();
    st().createShapeTween('easeIn');
    st().createShapeTween();
    expect(layerObj().frames.keys[0].tween).toEqual({ kind: 'shape', easing: 'easeIn' });
    expect(drawingOf(0)[0].shapeTrack![0].easing).toBe('easeIn');
  });

  it('refuses on the last key with a toast', () => {
    twoKeys();
    st().seek(f(12));
    const before = st().history.present;
    st().createShapeTween();
    expect(st().history.present).toBe(before);
    expect(st().toasts.at(-1)?.message).toMatch(/following keyframe/);
  });
});

describe('removeShapeTween', () => {
  it('restores the static drawing', () => {
    twoKeys();
    st().createShapeTween();
    st().removeShapeTween();
    expect(layerObj().frames.keys[0].tween).toBeUndefined();
    const [a] = drawingOf(0);
    expect(a.shapeTrack).toBeUndefined();
    const asset = st().history.present.assets.find((x) => x.id === a.assetId) as VectorAsset;
    expect(asset.path!.nodes.map((n) => n.anchor)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]);
  });

  it('toasts when there is no tween', () => {
    twoKeys();
    st().removeShapeTween();
    expect(st().toasts.at(-1)?.message).toMatch(/No shape tween/);
  });
});

describe('key timing keeps tweens in step', () => {
  it('F5 inside the span stretches the morph to the moved key', () => {
    twoKeys();
    st().createShapeTween();
    st().insertFrames(5);
    expect(drawingOf(0)[0].shapeTrack!.map((k) => k.time)).toEqual([0, 1.5]);
  });

  it('moving key B re-times the morph', () => {
    twoKeys();
    st().createShapeTween();
    st().moveFrameKeyTo(layerObj().frames.keys[1].id, f(15));
    expect(drawingOf(0)[0].shapeTrack!.map((k) => k.time)).toEqual([0, 1.5]);
  });

  it('F6 inside the span splits the tween at the in-between drawing', () => {
    twoKeys();
    st().createShapeTween();
    const whole = drawingOf(0)[0].shapeTrack!;
    st().seek(f(5));
    st().insertFrameKeyframe();
    st().selectObject(layerObj().id);
    const keys = layerObj().frames.keys;
    expect(keys).toHaveLength(3);
    expect(keys[0].tween).toBeTruthy();
    expect(keys[1].tween).toBeTruthy();
    const first = drawingOf(0)[0].shapeTrack!;
    const second = drawingOf(1)[0].shapeTrack!;
    expect(first.map((k) => k.time)).toEqual([0, 0.5]);
    expect(second.map((k) => k.time)).toEqual([0.5, 1]);
    const halfway = samplePath(whole, 0.5).nodes.map((n) => n.anchor);
    second[0].path.nodes.forEach((n, i) => {
      expect(n.anchor.x).toBeCloseTo(halfway[i].x);
      expect(n.anchor.y).toBeCloseTo(halfway[i].y);
    });
  });

  it('clearing key B drops the now-last tween', () => {
    twoKeys();
    st().createShapeTween();
    st().seek(f(10));
    st().clearFrameKeyframe();
    expect(layerObj().frames.keys).toHaveLength(1);
    expect(layerObj().frames.keys[0].tween).toBeUndefined();
    expect(drawingOf(0)[0].shapeTrack).toBeUndefined();
    expect(exposedFrameKeyId(layerObj().frames, 0)).toBe(layerObj().frames.keys[0].id);
  });
});
