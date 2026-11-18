// Variable-width strokes (spec 2026-11-18-variable-width, slice 2): the store verb.
import { beforeEach, describe, expect, it } from 'vitest';
import { createProject, type SceneObject, type VectorAsset } from '@savig/engine';
import { store } from './store';
import { selectActiveObjects } from './selectors';

const st = () => store.getState();
const objects = (): SceneObject[] => selectActiveObjects(st());
const assetOf = (id: string) => {
  const o = objects().find((x) => x.id === id)!;
  return st().history.present.assets.find((a) => a.id === o.assetId) as VectorAsset;
};

beforeEach(() => {
  st().setProject(createProject());
});

describe('setWidthProfile', () => {
  it('turns a stroked rect into a profiled path in one undo step', () => {
    st().addVectorShape('rect', { x: 10, y: 10, width: 100, height: 50 });
    const id = st().selectedObjectId!;
    st().setVectorStyle({ stroke: '#000000', strokeWidth: 4 });
    st().setWidthProfile([{ t: 0, w: 0 }, { t: 1, w: 2 }]);
    expect(assetOf(id).shapeType).toBe('path');
    expect(assetOf(id).style.widthProfile).toEqual([{ t: 0, w: 0 }, { t: 1, w: 2 }]);
    st().undo();
    expect(assetOf(id).shapeType).toBe('rect');
    expect(assetOf(id).style.widthProfile).toBeUndefined();
  });

  it('clearing a shape without a profile commits nothing', () => {
    st().addVectorShape('rect', { x: 10, y: 10, width: 100, height: 50 });
    const before = st().history.present;
    st().setWidthProfile(null);
    expect(st().history.present).toBe(before);
  });

  it('toasts when the shape has no stroke', () => {
    st().addVectorShape('rect', { x: 10, y: 10, width: 100, height: 50 });
    const before = st().history.present;
    st().setWidthProfile([{ t: 0, w: 2 }]);
    expect(st().history.present).toBe(before);
    expect(st().toasts[0].message).toMatch(/stroke first/);
  });
});
