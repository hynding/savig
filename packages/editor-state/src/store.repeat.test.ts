import { describe, it, expect, beforeEach } from 'vitest';
import { store } from './store';
import { createProject, createSceneObject, createVectorAsset, createSymbolAsset } from '@savig/engine';

beforeEach(() => {
  store.getState().newProject();
});

function seedRect(): string {
  const s = store.getState();
  s.addVectorShape('rect', { x: 0, y: 0, width: 100, height: 60 });
  return store.getState().selectedObjectId!;
}

const obj = (id: string) => store.getState().history.present.objects.find((o) => o.id === id)!;

describe('toggleRepeat', () => {
  it('case 1: toggles a rect on to defaults, then off to undefined', () => {
    const id = seedRect();
    store.getState().toggleRepeat();
    expect(obj(id).repeat).toEqual({ count: 2, dx: 0, dy: 0, rotate: 0, scale: 1, stagger: 0 });
    store.getState().toggleRepeat();
    expect(obj(id).repeat).toBeUndefined();
  });
});

describe('setRepeat', () => {
  it('case 2: merges a partial over defaults; count 1 normalizes back to undefined', () => {
    const id = seedRect();
    store.getState().toggleRepeat();
    store.getState().setRepeat({ count: 5, dx: 40 });
    expect(obj(id).repeat).toEqual({ count: 5, dx: 40, dy: 0, rotate: 0, scale: 1, stagger: 0 });
    store.getState().setRepeat({ count: 1 });
    expect(obj(id).repeat).toBeUndefined();
  });

  it('case 3: clamps count/scale/stagger; a non-finite field rejects the whole write', () => {
    const id = seedRect();
    store.getState().toggleRepeat();
    store.getState().setRepeat({ count: 500 });
    expect(obj(id).repeat!.count).toBe(64);

    store.getState().setRepeat({ scale: 0 });
    expect(obj(id).repeat!.scale).toBe(0.01);

    store.getState().setRepeat({ stagger: -1 });
    expect(obj(id).repeat!.stagger).toBe(0);

    const before = obj(id).repeat;
    store.getState().setRepeat({ dx: NaN });
    expect(obj(id).repeat).toEqual(before); // whole write rejected, unchanged
  });

  it('case 4: no-op when the selected object is a group', () => {
    const id1 = seedRect();
    store.getState().addVectorShape('rect', { x: 10, y: 10, width: 20, height: 20 });
    const id2 = store.getState().selectedObjectId!;
    store.getState().selectObjects([id1, id2]);
    store.getState().groupSelected();
    const groupId = store.getState().selectedObjectId!;
    expect(obj(groupId).isGroup).toBe(true);
    store.getState().toggleRepeat();
    expect(obj(groupId).repeat).toBeUndefined();
  });

  it('case 4: no-op when the selected object is a symbol instance', () => {
    seedRect();
    store.getState().selectObjects([store.getState().history.present.objects[0].id]);
    store.getState().createSymbol();
    const instId = store.getState().selectedObjectId!;
    expect(store.getState().history.present.objects.find((o) => o.id === instId)).toBeDefined();
    store.getState().toggleRepeat();
    expect(obj(instId).repeat).toBeUndefined();
  });

  describe('in-symbol scope', () => {
    function symbolWithRect() {
      const s = store.getState();
      s.newProject();
      const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
      const rectObj = createSceneObject('rect-asset', { id: 'r', zOrder: 0 });
      rectObj.shapeBase = { width: 10, height: 10 };
      const sym = createSymbolAsset({ id: 'sym', objects: [rectObj], width: 10, height: 10 });
      const p = createProject();
      p.assets = [rectAsset, sym];
      p.objects = [createSceneObject('sym', { id: 'inst1' }), createSceneObject('sym', { id: 'inst2' })];
      s.commit(p);
      s.enterSymbol('sym');
      s.selectObject('r');
    }
    const symObj0 = () =>
      (store.getState().history.present.assets.find((a) => a.id === 'sym') as { objects: import('@savig/engine').SceneObject[] })
        .objects[0];

    it('case 5: toggleRepeat writes to the SYMBOL object, not root', () => {
      symbolWithRect();
      store.getState().toggleRepeat();
      expect(symObj0().repeat).toEqual({ count: 2, dx: 0, dy: 0, rotate: 0, scale: 1, stagger: 0 });
      expect(store.getState().history.present.objects.map((o) => o.id)).toEqual(['inst1', 'inst2']); // root untouched
    });
  });
});

describe('duplicateSelected', () => {
  it('case 6: clones the repeat spec (JSON deep-clone)', () => {
    const id = seedRect();
    store.getState().toggleRepeat();
    store.getState().setRepeat({ count: 5, dx: 40 });
    store.getState().selectObjects([id]);
    store.getState().duplicateSelected();
    const dupId = store.getState().selectedObjectId!;
    expect(dupId).not.toBe(id);
    expect(obj(dupId).repeat).toEqual(obj(id).repeat);
    // pin deep-clone: mutating the source's repeat object must not affect the duplicate
    expect(obj(dupId).repeat).not.toBe(obj(id).repeat);
  });
});
