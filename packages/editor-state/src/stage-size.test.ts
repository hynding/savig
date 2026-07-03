import { describe, it, expect, beforeEach } from 'vitest';
import { store } from './store';
import { createSymbolAsset } from '@savig/engine';

beforeEach(() => {
  store.getState().newProject();
});

describe('setStageSize', () => {
  it('resizes the root artboard (meta) and is undoable', () => {
    store.getState().setStageSize(800, 600);
    expect(store.getState().history.present.meta.width).toBe(800);
    expect(store.getState().history.present.meta.height).toBe(600);
    store.getState().undo();
    expect(store.getState().history.present.meta.width).toBe(1280);
    expect(store.getState().history.present.meta.height).toBe(720);
  });

  it('clamps to integers >= 1', () => {
    store.getState().setStageSize(0, -5);
    expect(store.getState().history.present.meta.width).toBe(1);
    expect(store.getState().history.present.meta.height).toBe(1);
    store.getState().setStageSize(640.6, 360.2);
    expect(store.getState().history.present.meta.width).toBe(641);
    expect(store.getState().history.present.meta.height).toBe(360);
  });

  it('no-ops (no history push) when the size is unchanged', () => {
    const before = store.getState().history.past.length;
    store.getState().setStageSize(1280, 720); // already the default
    expect(store.getState().history.past.length).toBe(before);
  });

  it('in symbol-edit mode, resizes the symbol asset, not meta', () => {
    const sym = createSymbolAsset({ id: 'sym', objects: [], width: 100, height: 100 });
    store.getState().addAsset(sym);
    store.getState().enterSymbol('sym');
    store.getState().setStageSize(300, 200);
    const asset = store.getState().history.present.assets.find((a) => a.id === 'sym');
    expect(asset).toMatchObject({ width: 300, height: 200 });
    expect(store.getState().history.present.meta.width).toBe(1280); // meta untouched
  });
});
