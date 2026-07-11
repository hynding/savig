import { describe, it, expect, beforeEach } from 'vitest';
import { store } from './store';
import { createProject, createSceneObject, createVectorAsset, createTextAsset, createSymbolAsset } from '@savig/engine';

beforeEach(() => {
  store.getState().newProject();
});

const STRAIGHT_PATH = { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }] };

/** Seeds a text object + an eligible plain path object at root scope, selects the text object. */
function seedTextAndPath(): { textId: string; pathId: string } {
  const s = store.getState();
  const project = s.history.present;
  const textAsset = createTextAsset({ id: 'text-a' });
  const pathAsset = createVectorAsset('path', { id: 'path-a', path: STRAIGHT_PATH });
  const textObj = createSceneObject('text-a', { id: 'text1', zOrder: 0 });
  const pathObj = createSceneObject('path-a', { id: 'path1', zOrder: 1 });
  s.commit({ ...project, assets: [textAsset, pathAsset], objects: [textObj, pathObj] });
  s.selectObject('text1');
  return { textId: 'text1', pathId: 'path1' };
}

const obj = (id: string) => store.getState().history.present.objects.find((o) => o.id === id)!;

describe('bindTextPath', () => {
  it('case 1: binds the selected text object to an eligible path in one commit', () => {
    const { textId, pathId } = seedTextAndPath();
    const before = store.getState().history.past.length;
    store.getState().bindTextPath(pathId);
    expect(obj(textId).textPath).toEqual({ pathObjectId: pathId, startOffset: 0 });
    expect(store.getState().history.past.length).toBe(before + 1);
  });

  it('case 2: no-op + toast when the selected object is not a text asset', () => {
    const s = store.getState();
    s.addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    const rectId = store.getState().selectedObjectId!;
    const pathAsset = createVectorAsset('path', { id: 'path-a', path: STRAIGHT_PATH });
    const pathObj = createSceneObject('path-a', { id: 'path1', zOrder: 1 });
    const project = store.getState().history.present;
    s.commit({ ...project, assets: [...project.assets, pathAsset], objects: [...project.objects, pathObj] });
    s.selectObject(rectId);
    const before = store.getState().history.past.length;
    store.getState().bindTextPath('path1');
    expect(obj(rectId).textPath).toBeUndefined();
    expect(store.getState().history.past.length).toBe(before);
    expect(store.getState().toasts).toHaveLength(1);
    expect(store.getState().toasts[0].kind).toBe('error');
  });

  it('case 3: no-op + toast when the target id does not resolve in the active scope', () => {
    const { textId } = seedTextAndPath();
    const before = store.getState().history.past.length;
    store.getState().bindTextPath('nope');
    expect(obj(textId).textPath).toBeUndefined();
    expect(store.getState().history.past.length).toBe(before);
    expect(store.getState().toasts).toHaveLength(1);
  });

  it('case 4: no-op + toast when the target is not a vector path (e.g. a rect)', () => {
    const s = store.getState();
    const project = s.history.present;
    const textAsset = createTextAsset({ id: 'text-a' });
    const rectAsset = createVectorAsset('rect', { id: 'rect-a' });
    const textObj = createSceneObject('text-a', { id: 'text1', zOrder: 0 });
    const rectObj = createSceneObject('rect-a', { id: 'rect1', zOrder: 1 });
    s.commit({ ...project, assets: [textAsset, rectAsset], objects: [textObj, rectObj] });
    s.selectObject('text1');
    const before = store.getState().history.past.length;
    store.getState().bindTextPath('rect1');
    expect(obj('text1').textPath).toBeUndefined();
    expect(store.getState().history.past.length).toBe(before);
    expect(store.getState().toasts).toHaveLength(1);
  });

  it('case 5: no-op + toast when the target is a live-boolean node', () => {
    const s = store.getState();
    const project = s.history.present;
    const textAsset = createTextAsset({ id: 'text-a' });
    const pathAsset = createVectorAsset('path', { id: 'path-a', path: STRAIGHT_PATH });
    const textObj = createSceneObject('text-a', { id: 'text1', zOrder: 0 });
    const boolObj = createSceneObject('path-a', { id: 'bool1', zOrder: 1, boolean: { op: 'union', operandIds: ['x', 'y'] } });
    s.commit({ ...project, assets: [textAsset, pathAsset], objects: [textObj, boolObj] });
    s.selectObject('text1');
    const before = store.getState().history.past.length;
    store.getState().bindTextPath('bool1');
    expect(obj('text1').textPath).toBeUndefined();
    expect(store.getState().history.past.length).toBe(before);
    expect(store.getState().toasts).toHaveLength(1);
  });

  it('case 6: active-scene routed — binds inside a symbol without touching root objects', () => {
    const s = store.getState();
    const textAsset = createTextAsset({ id: 'text-a' });
    const pathAsset = createVectorAsset('path', { id: 'path-a', path: STRAIGHT_PATH });
    const textObj = createSceneObject('text-a', { id: 'text1', zOrder: 0 });
    const pathObj = createSceneObject('path-a', { id: 'path1', zOrder: 1 });
    const sym = createSymbolAsset({ id: 'sym', objects: [textObj, pathObj], width: 100, height: 100 });
    const p = createProject();
    p.assets = [textAsset, pathAsset, sym];
    p.objects = [createSceneObject('sym', { id: 'inst1' })];
    s.commit(p);
    s.enterSymbol('sym');
    s.selectObject('text1');
    store.getState().bindTextPath('path1');
    const symObj0 = (
      store.getState().history.present.assets.find((a) => a.id === 'sym') as { objects: import('@savig/engine').SceneObject[] }
    ).objects[0];
    expect(symObj0.textPath).toEqual({ pathObjectId: 'path1', startOffset: 0 });
    expect(store.getState().history.present.objects.map((o) => o.id)).toEqual(['inst1']); // root untouched
  });
});

describe('unbindTextPath', () => {
  it('case 7: clears textPath AND strips tracks.textPathOffset, byte-clean, one commit', () => {
    const { textId, pathId } = seedTextAndPath();
    store.getState().bindTextPath(pathId);
    store.getState().setTextPathOffset(0.4); // autoKey defaults ON -> seeds tracks.textPathOffset
    expect(obj(textId).tracks.textPathOffset).toBeDefined();
    const before = store.getState().history.past.length;
    store.getState().unbindTextPath();
    const o = obj(textId);
    expect('textPath' in o).toBe(false);
    expect('textPathOffset' in o.tracks).toBe(false);
    expect(store.getState().history.past.length).toBe(before + 1);
  });

  it('case 8: no-op when the selected object is not bound', () => {
    const { textId } = seedTextAndPath();
    const before = store.getState().history.past.length;
    store.getState().unbindTextPath();
    expect(obj(textId).textPath).toBeUndefined();
    expect(store.getState().history.past.length).toBe(before);
  });
});

describe('setTextPathOffset', () => {
  it('case 9: autoKey ON creates a frame-snapped textPathOffset keyframe at the playhead', () => {
    const { textId, pathId } = seedTextAndPath();
    store.getState().bindTextPath(pathId);
    store.getState().seek(1);
    store.getState().setTextPathOffset(0.3);
    expect(obj(textId).tracks.textPathOffset).toEqual([{ time: 1, value: 0.3, easing: 'linear' }]);
    expect(obj(textId).textPath!.startOffset).toBe(0); // base untouched
  });

  it('case 9b: a second setTextPathOffset at the same time preserves the keyframe\'s prior easing', () => {
    const { textId, pathId } = seedTextAndPath();
    store.getState().bindTextPath(pathId);
    store.getState().seek(1);
    store.getState().setTextPathOffset(0.3);
    const project = store.getState().history.present;
    store.getState().commit({
      ...project,
      objects: project.objects.map((o) =>
        o.id === textId ? { ...o, tracks: { ...o.tracks, textPathOffset: [{ time: 1, value: 0.3, easing: 'easeIn' as const }] } } : o,
      ),
    });
    store.getState().setTextPathOffset(0.8);
    expect(obj(textId).tracks.textPathOffset).toEqual([{ time: 1, value: 0.8, easing: 'easeIn' }]);
  });

  it('case 10: autoKey OFF writes textPath.startOffset (no track)', () => {
    const { textId, pathId } = seedTextAndPath();
    store.getState().bindTextPath(pathId);
    store.getState().toggleAutoKey(); // OFF
    store.getState().setTextPathOffset(0.6);
    expect(obj(textId).textPath).toEqual({ pathObjectId: pathId, startOffset: 0.6 });
    expect(obj(textId).tracks.textPathOffset).toBeUndefined();
  });

  it('case 11: no-op when the selected object is unbound (both autoKey states)', () => {
    const { textId } = seedTextAndPath();
    const before = store.getState().history.past.length;
    store.getState().setTextPathOffset(0.5);
    store.getState().toggleAutoKey(); // OFF
    store.getState().setTextPathOffset(0.5);
    expect(obj(textId).textPath).toBeUndefined();
    expect(obj(textId).tracks.textPathOffset).toBeUndefined();
    expect(store.getState().history.past.length).toBe(before);
  });

  it('case 12: active-scene routed — writes onto the symbol object, not root', () => {
    const s = store.getState();
    const textAsset = createTextAsset({ id: 'text-a' });
    const pathAsset = createVectorAsset('path', { id: 'path-a', path: STRAIGHT_PATH });
    const textObj = createSceneObject('text-a', { id: 'text1', zOrder: 0 });
    const pathObj = createSceneObject('path-a', { id: 'path1', zOrder: 1 });
    const sym = createSymbolAsset({ id: 'sym', objects: [textObj, pathObj], width: 100, height: 100 });
    const p = createProject();
    p.assets = [textAsset, pathAsset, sym];
    p.objects = [createSceneObject('sym', { id: 'inst1' })];
    s.commit(p);
    s.enterSymbol('sym');
    s.selectObject('text1');
    store.getState().bindTextPath('path1');
    store.getState().toggleAutoKey(); // OFF
    store.getState().setTextPathOffset(0.25);
    const symObj0 = (
      store.getState().history.present.assets.find((a) => a.id === 'sym') as { objects: import('@savig/engine').SceneObject[] }
    ).objects[0];
    expect(symObj0.textPath).toEqual({ pathObjectId: 'path1', startOffset: 0.25 });
    expect(store.getState().history.present.objects.map((o) => o.id)).toEqual(['inst1']); // root untouched
  });
});
