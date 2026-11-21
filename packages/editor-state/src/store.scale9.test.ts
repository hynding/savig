import { describe, it, expect, beforeEach } from 'vitest';
import { createSceneObject, createSymbolAsset } from '@savig/engine';
import type { SymbolAsset } from '@savig/engine';
import { store } from './store';

beforeEach(() => {
  store.getState().newProject();
  const p = store.getState().history.present;
  const sym = createSymbolAsset({ id: 'btn', name: 'Button', width: 120, height: 40 });
  store.getState().commit({ ...p, assets: [...p.assets, sym], objects: [createSceneObject('btn', { id: 'b1', zOrder: 0 })] });
});

const sym = () => store.getState().history.present.assets.find((a) => a.id === 'btn') as SymbolAsset;

describe('setSymbolScale9 (roadmap 13)', () => {
  it('turns on a default grid, edits one inset, and turns off; each one undo step', () => {
    const steps = () => store.getState().history.past.length;
    const before = steps();
    store.getState().setSymbolScale9('btn', true);
    expect(sym().scale9).toEqual({ left: 10, top: 10, right: 10, bottom: 10, x: 0, y: 0, width: 120, height: 40 });
    store.getState().setSymbolScale9('btn', { left: 30 });
    expect(sym().scale9).toMatchObject({ left: 30, top: 10, right: 10, bottom: 10 });
    store.getState().setSymbolScale9('btn', { left: 30 }); // no-op: no new step
    expect(steps()).toBe(before + 2);
    expect(store.getState().historyLabels.present).toBe('9-slice scaling');
    store.getState().setSymbolScale9('btn', null);
    expect('scale9' in sym()).toBe(false);
    store.getState().undo();
    expect(sym().scale9!.left).toBe(30);
  });

  it('clamps insets so a middle remains, and refuses a symbol too small', () => {
    store.getState().setSymbolScale9('btn', { left: 100, right: 100 });
    const g = sym().scale9!;
    expect(g.left + g.right).toBeCloseTo(119, 9);
    const p = store.getState().history.present;
    store.getState().commit({ ...p, assets: [...p.assets, createSymbolAsset({ id: 'dot', name: 'Dot', width: 0, height: 0 })] });
    store.getState().setSymbolScale9('dot', true);
    expect(store.getState().toasts.at(-1)?.message).toMatch(/too small/);
  });

  it('measures the grid in the content box, wherever the content sits', () => {
    store.getState().newProject();
    store.getState().addVectorShape('rect', { x: 150, y: 100, width: 80, height: 40 });
    store.getState().createSymbol();
    const inst = store.getState().history.present.objects[0]!;
    store.getState().setSymbolScale9(inst.assetId, true);
    const s = store.getState().history.present.assets.find((a) => a.id === inst.assetId) as SymbolAsset;
    expect(s.scale9).toMatchObject({ x: 150, y: 100, width: 80, height: 40, left: 10, right: 10 });
  });
});
