import { describe, it, expect, beforeEach } from 'vitest';
import { store } from './store';
import { createProject, createSceneObject, createSymbolAsset, createVectorAsset } from '@savig/engine';
import type { TextAsset } from '@savig/engine';

beforeEach(() => {
  store.getState().newProject();
});

const obj = (id: string) => store.getState().history.present.objects.find((o) => o.id === id)!;
const asset = (id: string): TextAsset => {
  const a = store.getState().history.present.assets.find((x) => x.id === obj(id).assetId)!;
  if (a.kind !== 'text') throw new Error('not text');
  return a;
};

describe('addTextObject', () => {
  it('creates a text asset (default content/fontSize/fill) + a scene object anchored at (x, y)', () => {
    store.getState().addTextObject(20, 30);
    const id = store.getState().selectedObjectId!;
    expect(asset(id).kind).toBe('text');
    expect(asset(id).content).toBe('Text');
    expect(asset(id).fontSize).toBe(48);
    expect(asset(id).fill).toBe('#000000');
    expect(obj(id).anchorMode).toBe('absolute');
    expect(obj(id).anchorX).toBe(0);
    expect(obj(id).anchorY).toBe(0);
    expect(obj(id).base.x).toBe(20);
    expect(obj(id).base.y).toBe(30);
  });

  it('selects the new object and reverts activeTool to select', () => {
    store.getState().setActiveTool('text');
    store.getState().addTextObject(5, 5);
    const s = store.getState();
    const id = s.selectedObjectId!;
    expect(s.selectedObjectIds).toEqual([id]);
    expect(s.selectedKeyframe).toBeNull();
    expect(s.activeTool).toBe('select');
  });

  it('performs exactly ONE commit', () => {
    const before = store.getState().history.past.length;
    store.getState().addTextObject(1, 2);
    expect(store.getState().history.past.length).toBe(before + 1);
  });

  it('in-symbol scope: creating while inside an entered symbol lands the object on the SYMBOL, not root', () => {
    const s = store.getState();
    const rectAsset = createVectorAsset('rect', { id: 'rect-asset' });
    const rectObj = createSceneObject('rect-asset', { id: 'rect1', zOrder: 0 });
    const sym = createSymbolAsset({ id: 'sym', objects: [rectObj], width: 10, height: 10 });
    const p = createProject();
    p.assets = [rectAsset, sym];
    p.objects = [createSceneObject('sym', { id: 'inst1' })];
    s.commit(p);
    s.enterSymbol('sym');
    s.addTextObject(7, 9);

    const symObjects = () =>
      (store.getState().history.present.assets.find((a) => a.id === 'sym') as unknown as { objects: ReturnType<typeof createSceneObject>[] })
        .objects;
    expect(symObjects().map((o) => o.id)).toEqual(['rect1', store.getState().selectedObjectId]);
    expect(store.getState().history.present.objects.map((o) => o.id)).toEqual(['inst1']); // root untouched
  });
});
