// Frame-by-frame slice 2 (spec 2026-11-07): the F5/F6/F7 store verbs and drawing into keys.
import { describe, it, expect, beforeEach } from 'vitest';
import { store } from './store';
import { createProject, createSymbolAsset, exposedFrameKeyId, flattenInstances } from '@savig/engine';
import type { FrameLayer, SceneObject } from '@savig/engine';
import { selectActiveObjects, selectTargetFrameLayer } from './selectors';

const FPS = 10;
const f = (n: number) => n / FPS;

beforeEach(() => {
  store.getState().setProject(createProject({ fps: FPS, duration: 2, durationMode: "manual" }));
});

const st = () => store.getState();
const objects = (): SceneObject[] => selectActiveObjects(st());
const layerObj = (): SceneObject & { frames: FrameLayer } => objects().find((o) => o.frames) as SceneObject & { frames: FrameLayer };
const keyTimes = () => layerObj().frames.keys.map((k) => k.time);
const drawingAt = (t: number) => {
  const L = layerObj();
  const id = exposedFrameKeyId(L.frames, t);
  return objects().filter((o) => o.parentId === L.id && o.frameKeyId === id);
};
const rect = (x = 0) => st().addVectorShape('rect', { x, y: 0, width: 10, height: 10 });

/** Shorten/extend the target layer's end directly (the default end is the 2s project length). */
function setEnd(t: number) {
  const L = layerObj();
  st().commit({
    ...st().history.present,
    objects: st().history.present.objects.map((o) => (o.id === L.id ? { ...o, frames: { ...L.frames, end: t } } : o)),
  });
}

/** New layer at frame 0, one frame long, with one rect drawn into its key. */
function layerWithDrawing() {
  st().newFrameLayer();
  setEnd(f(1));
  rect();
}

describe('newFrameLayer / convertToFrameLayer', () => {
  it('adds an empty layer with one key at the playhead, selected and targeted', () => {
    st().seek(f(3));
    st().newFrameLayer();
    const L = layerObj();
    expect(L.isGroup).toBe(true);
    expect(L.frames.keys.map((k) => k.time)).toEqual([f(3)]);
    expect(L.frames.end).toBeCloseTo(2); // holds to the end of the timeline
    expect(st().selectedObjectId).toBe(L.id);
    expect(selectTargetFrameLayer(st())?.id).toBe(L.id);
  });

  it('converts the selection into a layer whose first key holds it', () => {
    rect(0);
    const a = st().selectedObjectId!;
    rect(20);
    const b = st().selectedObjectId!;
    st().selectObjects([a, b]);
    st().convertToFrameLayer();
    const L = layerObj();
    const key = L.frames.keys[0].id;
    for (const id of [a, b]) {
      const o = objects().find((x) => x.id === id)!;
      expect(o.parentId).toBe(L.id);
      expect(o.frameKeyId).toBe(key);
    }
  });

  it('refuses to convert nothing (toast, no commit)', () => {
    const before = st().history.present;
    st().convertToFrameLayer();
    expect(st().history.present).toBe(before);
    expect(st().toasts[0]?.message).toMatch(/frame layer/i);
  });
});

describe('drawing into keys', () => {
  it('a shape drawn with a layer targeted lands in the key under the playhead', () => {
    layerWithDrawing();
    const L = layerObj();
    const drawn = objects().find((o) => o.id === st().selectedObjectId)!;
    expect(drawn.parentId).toBe(L.id);
    expect(drawn.frameKeyId).toBe(L.frames.keys[0].id);
    expect(selectTargetFrameLayer(st())?.id).toBe(L.id); // still targeted for the next stroke
  });

  it('auto-creates a blank key when drawing past the layer end', () => {
    layerWithDrawing();
    st().seek(f(5)); // past the one-frame layer
    rect(30);
    expect(keyTimes()).toEqual([0, f(5)]);
    expect(layerObj().frames.end).toBeCloseTo(f(6));
    expect(drawingAt(f(5))).toHaveLength(1);
  });

  it('draws at the root when nothing frame-related is selected', () => {
    layerWithDrawing();
    st().selectObject(null);
    rect(40);
    expect(objects().find((o) => o.id === st().selectedObjectId)!.parentId).toBeUndefined();
  });

  it('keeps the drawing where it was drawn inside a moved layer (local-space bake)', () => {
    st().newFrameLayer();
    const L = layerObj();
    store.getState().commit({
      ...st().history.present,
      objects: st().history.present.objects.map((o) => (o.id === L.id ? { ...o, base: { ...o.base, x: 100, y: 50 } } : o)),
    });
    st().selectObject(L.id);
    st().addVectorShape('rect', { x: 120, y: 60, width: 10, height: 10 });
    const drawn = objects().find((o) => o.id === st().selectedObjectId)!;
    expect(drawn.base.x).toBeCloseTo(20);
    expect(drawn.base.y).toBeCloseTo(10);
  });
});

describe('F6 insertFrameKeyframe', () => {
  it('copies the shown drawing into a new key with cloned assets', () => {
    layerWithDrawing();
    st().insertFrames(4); // hold frames 0..4
    st().seek(f(2));
    st().insertFrameKeyframe();
    expect(keyTimes()).toEqual([0, f(2)]);
    const [orig] = drawingAt(0);
    const [copy] = drawingAt(f(2));
    expect(copy.id).not.toBe(orig.id);
    expect(copy.assetId).not.toBe(orig.assetId);
    expect(copy.zOrder).toBe(orig.zOrder);
    expect(st().selectedObjectIds).toEqual([copy.id]);
  });

  it('past the end copies the last drawing and extends the layer', () => {
    layerWithDrawing();
    st().seek(f(3));
    st().insertFrameKeyframe();
    expect(keyTimes()).toEqual([0, f(3)]);
    expect(layerObj().frames.end).toBeCloseTo(f(4));
    expect(drawingAt(f(3))).toHaveLength(1);
  });

  it('is a no-op on an existing key and behaves like F7 before the first key', () => {
    st().seek(f(2));
    st().newFrameLayer();
    const before = st().history.present;
    st().insertFrameKeyframe(); // key already at f(2)
    expect(st().history.present).toBe(before);
    st().seek(0);
    st().insertFrameKeyframe(); // nothing to copy before the first key
    expect(keyTimes()).toEqual([0, f(2)]);
    expect(drawingAt(0)).toHaveLength(0);
  });

  it('deep-copies a group drawing, relinking descendants', () => {
    st().newFrameLayer();
    const L = layerObj();
    rect(0);
    const a = st().selectedObjectId!;
    st().selectObject(L.id);
    rect(20);
    const b = st().selectedObjectId!;
    // group the two drawings inside the key, then re-tag the new group into the key
    const objs = objects();
    const gid = 'grp';
    store.getState().commit({
      ...st().history.present,
      objects: [
        ...objs.map((o) => (o.id === a || o.id === b ? { ...o, parentId: gid, frameKeyId: undefined } : o)),
        { ...objs.find((o) => o.id === a)!, id: gid, assetId: '', isGroup: true, parentId: L.id, frameKeyId: L.frames.keys[0].id },
      ],
    });
    st().selectObject(gid);
    st().seek(f(3));
    st().insertFrameKeyframe();
    const [groupCopy] = drawingAt(f(3));
    expect(groupCopy.isGroup).toBe(true);
    expect(objects().filter((o) => o.parentId === groupCopy.id)).toHaveLength(2);
  });
});

describe('F7 / F5 / Shift+F5 / Shift+F6', () => {
  it('F7 inserts an empty key and keeps the layer targeted', () => {
    layerWithDrawing();
    st().seek(f(2));
    st().insertBlankFrameKeyframe();
    expect(keyTimes()).toEqual([0, f(2)]);
    expect(drawingAt(f(2))).toHaveLength(0);
    expect(st().selectedObjectId).toBe(layerObj().id);
  });

  it('F5 pushes later keys right; Shift+F5 pulls them back', () => {
    layerWithDrawing();
    st().seek(f(2));
    st().insertBlankFrameKeyframe(); // keys 0, 2 ; end 3
    st().seek(f(1));
    st().insertFrames();
    expect(keyTimes()).toEqual([0, f(3)]);
    expect(layerObj().frames.end).toBeCloseTo(f(4));
    st().removeFrames();
    expect(keyTimes()).toEqual([0, f(2)]);
    expect(layerObj().frames.end).toBeCloseTo(f(3));
  });

  it('F5 past the end extends the layer to the playhead', () => {
    layerWithDrawing();
    st().seek(f(6));
    st().insertFrames();
    expect(layerObj().frames.end).toBeCloseTo(f(7));
  });

  it('Shift+F5 on a one-frame key clears it and its drawing', () => {
    layerWithDrawing();
    st().seek(f(1));
    st().insertFrameKeyframe(); // keys 0, 1 ; key 0 spans one frame
    const doomed = drawingAt(0)[0].id;
    st().seek(0);
    st().removeFrames();
    expect(keyTimes()).toEqual([0]);
    expect(objects().some((o) => o.id === doomed)).toBe(false);
    expect(drawingAt(0)).toHaveLength(1); // the copy slid into frame 0
  });

  it('Shift+F5 refuses to collapse the only key', () => {
    layerWithDrawing();
    const before = st().history.present;
    st().removeFrames();
    expect(st().history.present).toBe(before);
  });

  it('Shift+F6 clears the key at the playhead and prunes its assets', () => {
    layerWithDrawing();
    st().seek(f(2));
    st().insertFrameKeyframe();
    const copy = drawingAt(f(2))[0];
    st().clearFrameKeyframe();
    expect(keyTimes()).toEqual([0]);
    expect(objects().some((o) => o.id === copy.id)).toBe(false);
    expect(st().history.present.assets.some((a) => a.id === copy.assetId)).toBe(false);
    // previous key now holds across the old span
    expect(drawingAt(f(2))).toHaveLength(1);
  });

  it('Shift+F6 on the only key empties it but keeps the key', () => {
    layerWithDrawing();
    st().clearFrameKeyframe();
    expect(keyTimes()).toEqual([0]);
    expect(drawingAt(0)).toHaveLength(0);
  });

  it('Shift+F6 needs a key exactly at the playhead', () => {
    layerWithDrawing();
    st().insertFrames(3);
    st().seek(f(2));
    const before = st().history.present;
    st().clearFrameKeyframe();
    expect(st().history.present).toBe(before);
  });
});

describe('move / label / step / guards', () => {
  it('moves a key frame-snapped and clamped between neighbours', () => {
    layerWithDrawing();
    st().seek(f(4));
    st().insertBlankFrameKeyframe(); // 0, 4 ; end 5
    const k = layerObj().frames.keys[1].id;
    st().moveFrameKeyTo(k, f(2.4));
    expect(keyTimes()).toEqual([0, f(2)]);
    st().moveFrameKeyTo(k, -5);
    expect(keyTimes()).toEqual([0, f(1)]);
    st().moveFrameKeyTo(k, 99);
    expect(keyTimes()).toEqual([0, f(4)]); // last key stays before end
  });

  it('labels a key and clears it with an empty label', () => {
    layerWithDrawing();
    const k = layerObj().frames.keys[0].id;
    st().setFrameKeyLabel(k, '  walk ');
    expect(layerObj().frames.keys[0].label).toBe('walk');
    st().setFrameKeyLabel(k, '');
    expect('label' in layerObj().frames.keys[0]).toBe(false);
  });

  it('steps the playhead between keys', () => {
    layerWithDrawing();
    st().seek(f(3));
    st().insertBlankFrameKeyframe();
    st().seek(f(1));
    st().stepFrameKey(1);
    expect(st().time).toBeCloseTo(f(3));
    st().stepFrameKey(-1);
    expect(st().time).toBeCloseTo(0);
  });

  it('every verb no-ops with a toast when no layer is targeted or it is locked', () => {
    rect();
    const before = st().history.present;
    st().insertFrameKeyframe();
    expect(st().history.present).toBe(before);
    expect(st().toasts[0]?.message).toMatch(/frame-by-frame layer/);

    st().newFrameLayer();
    const L = layerObj();
    st().toggleObjectLock(L.id);
    st().selectObject(L.id);
    const locked = st().history.present;
    st().insertBlankFrameKeyframe();
    expect(st().history.present).toBe(locked);
    expect(st().toasts[0]?.message).toMatch(/locked/);
  });

  it('undo restores the previous key list in one step', () => {
    layerWithDrawing();
    st().seek(f(2));
    st().insertFrameKeyframe();
    st().undo();
    expect(keyTimes()).toEqual([0]);
  });

  it('works inside an edited symbol', () => {
    const sym = createSymbolAsset({ id: 'S', objects: [] });
    store.getState().setProject({ ...createProject({ fps: FPS }), assets: [sym] });
    st().enterSymbol('S');
    st().newFrameLayer();
    rect();
    st().seek(f(2));
    st().insertFrameKeyframe();
    const S = st().history.present.assets.find((a) => a.id === 'S');
    expect(S?.kind === 'symbol' && S.objects.find((o) => o.frames)?.frames?.keys).toHaveLength(2);
    expect(st().history.present.objects).toHaveLength(0);
  });

  it('renders the swap: only the current key is exposed', () => {
    layerWithDrawing();
    st().seek(f(2));
    st().insertBlankFrameKeyframe();
    rect(50);
    const shown = (t: number) => flattenInstances(st().history.present, t).filter((l) => l.exposed).length;
    expect(shown(0)).toBe(1);
    expect(shown(f(2))).toBe(1);
    const first = flattenInstances(st().history.present, 0).find((l) => l.exposed)!.renderId;
    const second = flattenInstances(st().history.present, f(2)).find((l) => l.exposed)!.renderId;
    expect(first).not.toBe(second);
  });
});
