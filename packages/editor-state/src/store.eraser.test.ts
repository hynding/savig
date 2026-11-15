// Eraser (spec 2026-11-15-paint-bucket-eraser, slice 2): the store verb and its size setting.
import { beforeEach, describe, expect, it } from 'vitest';
import { createProject, type SceneObject, type VectorAsset } from '@savig/engine';
import { store } from './store';
import { selectActiveObjects } from './selectors';

const st = () => store.getState();
const objects = (): SceneObject[] => selectActiveObjects(st());
const assetOf = (o: SceneObject) => st().history.present.assets.find((a) => a.id === o.assetId) as VectorAsset | undefined;
const rect = (x: number, y: number, w: number, h: number): SceneObject => {
  st().addVectorShape('rect', { x, y, width: w, height: h });
  return objects().find((o) => o.id === st().selectedObjectId)!;
};

beforeEach(() => {
  st().setProject(createProject());
  st().setEraserSize(10);
});

describe('setEraserSize', () => {
  it('clamps to 1..500 and ignores non-numbers', () => {
    st().setEraserSize(0);
    expect(st().eraserSize).toBe(1);
    st().setEraserSize(9999);
    expect(st().eraserSize).toBe(500);
    st().setEraserSize(Number.NaN);
    expect(st().eraserSize).toBe(500);
  });
});

describe('eraseAlong', () => {
  it('cuts a rect in two in one undo step', () => {
    const r = rect(0, 0, 100, 100);
    st().eraseAlong([{ x: 50, y: -20 }, { x: 50, y: 120 }]);
    const a = assetOf(objects().find((o) => o.id === r.id)!)!;
    expect(a.shapeType).toBe('path');
    expect(a.compoundRings).toHaveLength(1);
    st().undo();
    expect(assetOf(objects().find((o) => o.id === r.id)!)!.shapeType).toBe('rect');
  });

  it('removes a shape erased away (and its asset), dropping it from the selection', () => {
    const r = rect(0, 0, 4, 4);
    st().eraseAlong([{ x: 2, y: 2 }]);
    expect(objects()).toHaveLength(0);
    expect(st().history.present.assets.some((a) => a.id === r.assetId)).toBe(false);
    expect(st().selectedObjectIds).toEqual([]);
  });

  it('a miss changes nothing; a locked shape explains itself', () => {
    const r = rect(0, 0, 100, 100);
    const past = st().history.past.length;
    st().eraseAlong([{ x: 400, y: 400 }]);
    expect(st().history.past.length).toBe(past);
    st().toggleObjectLock(r.id);
    st().eraseAlong([{ x: 50, y: 50 }]);
    expect(st().toasts[0]?.message).toMatch(/locked/);
    expect(st().history.past.length).toBe(past + 1); // only the lock
  });
});
