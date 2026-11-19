// Pure unit tests for `assetPanelViewModel` — no React. Drives the real vanilla
// `@savig/editor-state` store through its actions (same store the app uses) and asserts on
// the resulting descriptor, mirroring how `AssetPanel.tsx` consumes it at runtime.
import { store } from '@savig/editor-state';
import { createProject, createSceneObject, createSymbolAsset, createVectorAsset } from '@savig/engine';
import { assetPanelViewModel } from './assetPanel';

beforeEach(() => {
  store.getState().newProject();
});

describe('assetPanelViewModel — library assets (svg/audio)', () => {
  it('lists svg and audio assets, excluding per-shape vector assets', () => {
    const s = store.getState();
    s.addAsset(createVectorAsset('rect', { id: 'v', name: 'Rectangle', shapeType: 'rect' }));
    s.addAsset({ id: 'a', kind: 'svg', name: 'box.svg', normalizedContent: '<rect/>', viewBox: '0 0 10 10', width: 10, height: 10 });
    s.addAsset({ id: 'snd', kind: 'audio', name: 'beep.wav', mimeType: 'audio/wav' });

    const vm = assetPanelViewModel(store.getState());
    expect(vm.libraryAssets.map((r) => r.id).sort()).toEqual(['a', 'snd']);
    expect(vm.libraryAssets.find((r) => r.id === 'a')).toEqual({ id: 'a', name: 'box.svg', kind: 'svg' });
    expect(vm.libraryAssets.find((r) => r.id === 'snd')).toEqual({ id: 'snd', name: 'beep.wav', kind: 'audio' });
  });
});

describe('assetPanelViewModel — symbols: instance count + cyclic guard', () => {
  it('reports a non-zero instance count across root objects and symbol-internal objects', () => {
    const s = store.getState();
    const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
    const sym = createSymbolAsset({ id: 'sym', name: 'Star', objects: [createSceneObject('rect-asset', { id: 'leaf' })], width: 10, height: 10 });
    const p = createProject();
    p.assets = [rectAsset, sym];
    p.objects = [createSceneObject('sym', { id: 'inst1' }), createSceneObject('sym', { id: 'inst2' })];
    s.commit(p);

    const vm = assetPanelViewModel(store.getState());
    const row = vm.symbols.find((r) => r.id === 'sym');
    expect(row?.instanceCount).toBe(2);
    expect(row?.name).toBe('Star');
    expect(row?.cyclic).toBe(false); // not editing inside any symbol
  });

  it('marks a symbol cyclic while editing inside it (self-containment)', () => {
    const s = store.getState();
    const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
    const sym = createSymbolAsset({ id: 'sym', name: 'Self', objects: [createSceneObject('rect-asset', { id: 'leaf' })], width: 10, height: 10 });
    const p = createProject();
    p.assets = [rectAsset, sym];
    p.objects = [createSceneObject('sym', { id: 'inst' })];
    s.commit(p);
    s.enterSymbol('sym');

    const vm = assetPanelViewModel(store.getState());
    expect(vm.symbols.find((r) => r.id === 'sym')?.cyclic).toBe(true);
  });

  it('marks a symbol cyclic when it transitively contains the symbol being edited', () => {
    const s = store.getState();
    const rectAsset = createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' });
    const inner = createSymbolAsset({ id: 'inner', name: 'Inner', objects: [createSceneObject('rect-asset', { id: 'leaf' })], width: 10, height: 10 });
    const outer = createSymbolAsset({ id: 'outer', name: 'Outer', objects: [createSceneObject('inner', { id: 'nested' })], width: 10, height: 10 });
    const p = createProject();
    p.assets = [rectAsset, inner, outer];
    p.objects = [createSceneObject('outer', { id: 'inst' })];
    s.commit(p);
    s.enterSymbol('outer');
    s.enterSymbol('inner'); // now editing 'inner', reached by drilling into 'outer'

    const vm = assetPanelViewModel(store.getState());
    // 'outer' contains 'inner' (the symbol being edited) -> placing another 'outer' would cycle.
    expect(vm.symbols.find((r) => r.id === 'outer')?.cyclic).toBe(true);
    // 'inner' itself IS the active symbol -> also cyclic (self-containment guard).
    expect(vm.symbols.find((r) => r.id === 'inner')?.cyclic).toBe(true);
  });
});

describe('assetPanelViewModel — thumbnail passthrough', () => {
  it('exposes the raw symbol asset + project assets/meta for the component to render a thumbnail', () => {
    const s = store.getState();
    const pathAsset = createVectorAsset('path', {
      id: 'pa-asset',
      path: { closed: true, nodes: [{ anchor: { x: 100, y: 100 } }, { anchor: { x: 110, y: 100 } }, { anchor: { x: 110, y: 110 } }, { anchor: { x: 100, y: 110 } }] },
    });
    const sym = createSymbolAsset({ id: 'sym', name: 'Star', objects: [createSceneObject('pa-asset', { id: 'leaf' })], width: 10, height: 10 });
    const p = createProject();
    p.assets = [pathAsset, sym];
    p.objects = [createSceneObject('sym', { id: 'inst' })];
    s.commit(p);

    const vm = assetPanelViewModel(store.getState());
    const row = vm.symbols.find((r) => r.id === 'sym');
    expect(row?.symbol).toBe(store.getState().history.present.assets.find((a) => a.id === 'sym'));
    expect(vm.assets).toBe(store.getState().history.present.assets);
    expect(vm.meta).toBe(store.getState().history.present.meta);
  });
});

describe('assetPanelViewModel — bitmap images (spec 2026-11-15-bitmap-import)', () => {
  it('lists image assets as library rows', () => {
    store.getState().addAsset({ id: 'img', kind: 'image', name: 'Photo', mimeType: 'image/png', dataUrl: 'data:image/png;base64,iVBORw0KGgo=', width: 4, height: 4 });
    expect(assetPanelViewModel(store.getState()).libraryAssets).toEqual([{ id: 'img', name: 'Photo', kind: 'image' }]);
  });
});

describe('assetPanelViewModel — library folders (roadmap 11)', () => {
  it('files items into a folder tree sorted by name, with item counts; root lists only unfiled items', () => {
    const s = store.getState();
    s.addAsset({ id: 'a', kind: 'svg', name: 'tree.svg', normalizedContent: '<rect/>', viewBox: '0 0 10 10', width: 10, height: 10 });
    s.addAsset({ id: 'b', kind: 'svg', name: 'rock.svg', normalizedContent: '<rect/>', viewBox: '0 0 10 10', width: 10, height: 10 });
    s.addAsset(createSymbolAsset({ id: 'sym', name: 'Hero', objects: [], width: 10, height: 10 }));
    const props = s.createLibraryFolder('Props');
    const chars = s.createLibraryFolder('Characters');
    const walk = s.createLibraryFolder('Walk', chars);
    s.moveToLibraryFolder(['a'], props);
    s.moveToLibraryFolder(['sym'], walk);

    const vm = assetPanelViewModel(store.getState());
    expect(vm.libraryAssets.map((r) => r.id)).toEqual(['b']);
    expect(vm.symbols).toEqual([]);
    expect(vm.folders.map((f) => f.name)).toEqual(['Characters', 'Props']);
    const [c, p] = vm.folders;
    expect(p).toMatchObject({ id: props, itemCount: 1, assets: [{ id: 'a' }], symbols: [], folders: [] });
    expect(c.itemCount).toBe(1);
    expect(c.folders[0]).toMatchObject({ id: walk, name: 'Walk', symbols: [{ id: 'sym', name: 'Hero' }] });
  });

  it('with no folders the library is flat, as before', () => {
    expect(assetPanelViewModel(store.getState()).folders).toEqual([]);
  });
});
