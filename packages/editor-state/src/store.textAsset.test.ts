import { describe, it, expect, beforeEach } from 'vitest';
import { store } from './store';
import { createProject, createSceneObject, createGroupObject, createTextAsset, createSymbolAsset } from '@savig/engine';

beforeEach(() => {
  store.getState().newProject();
});

/** Seeds a text object at root scope with a known-value asset, selects it. */
function seedText() {
  const s = store.getState();
  const project = s.history.present;
  const textAsset = createTextAsset({
    id: 'text-a',
    content: 'Hello',
    fontSize: 48,
    fill: '#000000',
  });
  const textObj = createSceneObject('text-a', { id: 'text1', zOrder: 0 });
  s.commit({ ...project, assets: [textAsset], objects: [textObj] });
  s.selectObject('text1');
}

const textAsset = () => store.getState().history.present.assets.find((a) => a.id === 'text-a')! as { content: string; fontSize: number; fill: string; fontFamily?: string; textAnchor?: string };

describe('setTextAssetFields', () => {
  it('case 1: mutates content in one commit', () => {
    seedText();
    const before = store.getState().history.past.length;
    store.getState().setTextAssetFields({ content: 'World' });
    expect(textAsset().content).toBe('World');
    expect(store.getState().history.past.length).toBe(before + 1);
  });

  it('case 2: mutates fontSize', () => {
    seedText();
    store.getState().setTextAssetFields({ fontSize: 72 });
    expect(textAsset().fontSize).toBe(72);
  });

  it('case 3: mutates fill', () => {
    seedText();
    store.getState().setTextAssetFields({ fill: '#ff0000' });
    expect(textAsset().fill).toBe('#ff0000');
  });

  it('case 4: mutates fontFamily', () => {
    seedText();
    store.getState().setTextAssetFields({ fontFamily: 'Georgia' });
    expect(textAsset().fontFamily).toBe('Georgia');
  });

  it('case 5: mutates textAnchor', () => {
    seedText();
    store.getState().setTextAssetFields({ textAnchor: 'middle' });
    expect(textAsset().textAnchor).toBe('middle');
  });

  it('case 6: a multi-field patch is still ONE commit', () => {
    seedText();
    const before = store.getState().history.past.length;
    store.getState().setTextAssetFields({ content: 'Hi', fontSize: 24, fill: '#0000ff' });
    expect(textAsset()).toMatchObject({ content: 'Hi', fontSize: 24, fill: '#0000ff' });
    expect(store.getState().history.past.length).toBe(before + 1);
  });

  it('case 7: no-op when nothing is selected', () => {
    seedText();
    store.getState().selectObject(null);
    const before = store.getState().history.past.length;
    store.getState().setTextAssetFields({ content: 'nope' });
    expect(textAsset().content).toBe('Hello');
    expect(store.getState().history.past.length).toBe(before);
  });

  it('case 8: silent no-op (no toast, no commit) when the selected object is not a text asset', () => {
    const s = store.getState();
    s.addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const before = store.getState().history.past.length;
    store.getState().setTextAssetFields({ content: 'nope' });
    expect(store.getState().history.past.length).toBe(before);
    expect(store.getState().toasts).toHaveLength(0);
  });

  describe('lock cascade gates', () => {
    it('case 9: directly-locked text object -> blocked (toast + no commit)', () => {
      seedText();
      const project = store.getState().history.present;
      store.getState().commit({
        ...project,
        objects: project.objects.map((o) => (o.id === 'text1' ? { ...o, locked: true } : o)),
      });
      const before = store.getState().history.past.length;
      store.getState().setTextAssetFields({ content: 'nope' });
      expect(textAsset().content).toBe('Hello');
      expect(store.getState().history.past.length).toBe(before);
      expect(store.getState().toasts).toHaveLength(1);
      expect(store.getState().toasts[0].kind).toBe('error');
      expect(store.getState().toasts[0].message).toBe("Can't edit a locked object.");
    });

    it('case 10: text object inside a locked group (lock cascade) -> blocked (toast + no commit)', () => {
      const textAssetObj = createTextAsset({ id: 'text-a', content: 'Hello' });
      const group = createGroupObject({ id: 'g', anchorX: 0, anchorY: 0, zOrder: 0 });
      group.locked = true;
      const textObj = createSceneObject('text-a', { id: 'text1', zOrder: 0, parentId: 'g' });
      const p = createProject();
      p.assets = [textAssetObj];
      p.objects = [group, textObj];
      store.getState().commit(p);
      store.getState().selectObject('text1');
      const before = store.getState().history.past.length;
      store.getState().setTextAssetFields({ content: 'nope' });
      expect(textAsset().content).toBe('Hello');
      expect(store.getState().history.past.length).toBe(before);
      expect(store.getState().toasts).toHaveLength(1);
      expect(store.getState().toasts[0].message).toBe("Can't edit a locked object.");
    });
  });

  it('case 11: active-scene routed — a text object inside a symbol still updates its (global) asset, root untouched', () => {
    const s = store.getState();
    const textAssetObj = createTextAsset({ id: 'text-a', content: 'Hello' });
    const textObj = createSceneObject('text-a', { id: 'text1', zOrder: 0 });
    const sym = createSymbolAsset({ id: 'sym', objects: [textObj], width: 100, height: 100 });
    const p = createProject();
    p.assets = [textAssetObj, sym];
    p.objects = [createSceneObject('sym', { id: 'inst1' })];
    s.commit(p);
    s.enterSymbol('sym');
    s.selectObject('text1');
    store.getState().setTextAssetFields({ content: 'Inside symbol' });
    expect(textAsset().content).toBe('Inside symbol');
    expect(store.getState().history.present.objects.map((o) => o.id)).toEqual(['inst1']); // root untouched
  });
});
