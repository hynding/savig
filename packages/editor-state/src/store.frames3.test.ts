// Frame-by-frame slice 3 (spec 2026-11-07): paste / duplicate / import / symbol placement route
// into the current keyframe; selection stops at a drawing; reparent/ungroup keep key tags sane.
import { describe, it, expect, beforeEach } from 'vitest';
import { store } from './store';
import { createProject, createSymbolAsset, createSceneObject, exposedFrameKeyId } from '@savig/engine';
import type { FrameLayer, SceneObject, SvgAsset } from '@savig/engine';
import { selectActiveObjects, selectTargetFrameLayer } from './selectors';

const FPS = 10;
const f = (n: number) => n / FPS;

beforeEach(() => {
  store.getState().setProject(createProject({ fps: FPS, duration: 2, durationMode: 'manual' }));
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
/** The model invariants core's validateFrameLayers checks for key tags (no cross-package dep):
 *  a frame layer's children name one of its keys; nothing else carries a frameKeyId. */
const frameIssues = (): string[] => {
  const all = objects();
  const byId = new Map(all.map((o) => [o.id, o] as const));
  const out: string[] = [];
  for (const o of all) {
    const p = o.parentId ? byId.get(o.parentId) : undefined;
    if (p?.frames) {
      if (!o.frameKeyId || !p.frames.keys.some((k) => k.id === o.frameKeyId)) out.push(`unkeyed ${o.id}`);
    } else if (o.frameKeyId !== undefined) out.push(`orphan ${o.id}`);
  }
  return out;
};

/** Layer at frame 0 lasting one frame, with one rect drawn into its key (selected). */
function layerWithDrawing() {
  st().newFrameLayer();
  const L = layerObj();
  st().commit({
    ...st().history.present,
    objects: st().history.present.objects.map((o) => (o.id === L.id ? { ...o, frames: { ...L.frames, end: f(1) } } : o)),
  });
  rect();
}

describe('paste into keys', () => {
  it('pastes a copied drawing into a new key past the end, in layer space', () => {
    layerWithDrawing();
    const original = objects().find((o) => o.id === st().selectedObjectId)!;
    st().copySelected();
    st().seek(f(4));
    st().paste();
    expect(keyTimes()).toEqual([0, f(4)]);
    const pasted = drawingAt(f(4));
    expect(pasted).toHaveLength(1);
    expect(pasted[0].id).not.toBe(original.id);
    expect(pasted[0].base.x).toBeCloseTo(original.base.x + 10); // DUP_OFFSET only, no re-bake
    expect(st().selectedObjectIds).toEqual([pasted[0].id]);
    expect(frameIssues()).toEqual([]);
  });

  it('several roots pasted at once share one auto-created key', () => {
    layerWithDrawing();
    rect(30);
    st().selectObjects(drawingAt(0).map((o) => o.id));
    st().copySelected();
    st().seek(f(3));
    st().paste();
    expect(keyTimes()).toEqual([0, f(3)]);
    expect(drawingAt(f(3))).toHaveLength(2);
  });

  it('a drawing pasted with no layer targeted lands at the root without a key tag', () => {
    layerWithDrawing();
    st().copySelected();
    st().selectObject(null);
    st().paste();
    const pasted = objects().find((o) => o.id === st().selectedObjectId)!;
    expect(pasted.parentId).toBeUndefined();
    expect(pasted.frameKeyId).toBeUndefined();
    expect(frameIssues()).toEqual([]);
  });

  it('pastes an ordinary object into the targeted layer', () => {
    rect(50);
    st().copySelected();
    st().newFrameLayer();
    st().paste();
    const pasted = objects().find((o) => o.id === st().selectedObjectId)!;
    expect(pasted.parentId).toBe(layerObj().id);
    expect(pasted.frameKeyId).toBe(layerObj().frames.keys[0].id);
  });
});

describe('duplicate / import / symbols', () => {
  it('duplicating a drawing keeps it in the same layer and key', () => {
    layerWithDrawing();
    const key = layerObj().frames.keys[0].id;
    st().duplicateSelected();
    const dup = objects().find((o) => o.id === st().selectedObjectId)!;
    expect(dup.parentId).toBe(layerObj().id);
    expect(dup.frameKeyId).toBe(key);
    expect(drawingAt(0)).toHaveLength(2);
    expect(frameIssues()).toEqual([]);
  });

  it('imports an svg asset into the current key', () => {
    st().newFrameLayer();
    const asset: SvgAsset = { id: 'svg-1', kind: 'svg', name: 'SVG', normalizedContent: '<g></g>', viewBox: '0 0 10 10', width: 10, height: 10 };
    st().addAsset(asset);
    st().addObject('svg-1');
    const placed = objects().find((o) => o.id === st().selectedObjectId)!;
    expect(placed.assetId).toBe('svg-1');
    expect(placed.parentId).toBe(layerObj().id);
    expect(placed.frameKeyId).toBe(layerObj().frames.keys[0].id);
  });

  it('places a symbol instance into the current key (both placement verbs)', () => {
    const sym = createSymbolAsset({ id: 'S', objects: [createSceneObject('none', { id: 'inner', zOrder: 0 })] });
    store.getState().setProject({ ...createProject({ fps: FPS, duration: 2, durationMode: 'manual' }), assets: [sym] });
    st().newFrameLayer();
    st().placeSymbolInstance('S');
    expect(objects().find((o) => o.id === st().selectedObjectId)!.frameKeyId).toBe(layerObj().frames.keys[0].id);
    st().selectObject(layerObj().id);
    st().seek(f(5)); // still inside the layer's only key (it holds to the 2s end)
    st().placeSymbolInstanceAt('S', 40, 40);
    expect(keyTimes()).toEqual([0]);
    expect(drawingAt(f(5))).toHaveLength(2);
  });
});

describe('selection and structure', () => {
  it('clicking a drawing selects the drawing, which still targets its layer', () => {
    layerWithDrawing();
    const drawn = st().selectedObjectId!;
    st().selectObject(null);
    st().selectObjectOrGroup(drawn);
    expect(st().selectedObjectId).toBe(drawn);
    expect(selectTargetFrameLayer(st())?.id).toBe(layerObj().id);
  });

  it('an ordinary group above a frame layer still selects as a whole from its other children', () => {
    rect(0);
    const a = st().selectedObjectId!;
    rect(30);
    const b = st().selectedObjectId!;
    st().selectObjects([a, b]);
    st().groupSelected();
    const g = objects().find((o) => o.isGroup)!;
    st().selectObject(null);
    st().selectObjectOrGroup(a);
    expect(st().selectedObjectId).toBe(g.id);
  });

  it('dragging an object into a frame layer files it under the current key; out drops the tag', () => {
    rect(50);
    const id = st().selectedObjectId!;
    st().newFrameLayer();
    const L = layerObj();
    st().seek(f(3)); // inside the layer's single (0 → end) key
    st().reparentObject(id, L.id);
    expect(objects().find((o) => o.id === id)!.frameKeyId).toBe(L.frames.keys[0].id);
    st().reparentObject(id, null);
    const out = objects().find((o) => o.id === id)!;
    expect(out.parentId).toBeUndefined();
    expect(out.frameKeyId).toBeUndefined();
    expect(frameIssues()).toEqual([]);
  });

  it('refuses to ungroup a frame layer', () => {
    layerWithDrawing();
    st().selectObject(layerObj().id);
    const before = st().history.present;
    st().ungroupSelected();
    expect(st().history.present).toBe(before);
    expect(st().toasts.at(-1)?.message).toMatch(/can't be ungrouped/);
  });

  it('ungrouping a group drawn in a key hands its key to the freed children', () => {
    layerWithDrawing();
    rect(30);
    const ids = drawingAt(0).map((o) => o.id);
    // Group the two drawings by hand (groupSelected only groups top-level objects).
    const key = layerObj().frames.keys[0].id;
    const L = layerObj();
    const g: SceneObject = { ...createSceneObject('none', { id: 'g', zOrder: 9 }), isGroup: true, parentId: L.id, frameKeyId: key };
    st().commit({
      ...st().history.present,
      objects: [
        ...st().history.present.objects.map((o) => (ids.includes(o.id) ? (({ frameKeyId: _k, ...rest }) => ({ ...rest, parentId: 'g' }))(o) : o)),
        g,
      ],
    });
    st().selectObject('g');
    st().ungroupSelected();
    for (const id of ids) {
      const o = objects().find((x) => x.id === id)!;
      expect(o.parentId).toBe(L.id);
      expect(o.frameKeyId).toBe(key);
    }
    expect(frameIssues()).toEqual([]);
  });
});
