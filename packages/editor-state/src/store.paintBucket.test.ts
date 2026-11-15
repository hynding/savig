// Paint bucket (spec 2026-11-15-paint-bucket-eraser): the store verb and its colour setting.
import { beforeEach, describe, expect, it } from 'vitest';
import { createProject, type SceneObject, type VectorAsset } from '@savig/engine';
import { store } from './store';
import { selectActiveObjects } from './selectors';

const st = () => store.getState();
const objects = (): SceneObject[] => selectActiveObjects(st());
const assetOf = (o: SceneObject) => st().history.present.assets.find((a) => a.id === o.assetId) as VectorAsset;
const rect = (x: number, y: number, w: number, h: number): SceneObject => {
  st().addVectorShape('rect', { x, y, width: w, height: h });
  return objects().find((o) => o.id === st().selectedObjectId)!;
};

beforeEach(() => {
  st().setProject(createProject());
  if (st().autoKey) st().toggleAutoKey();
  st().setBucketColor('#3366ff');
});

describe('setBucketColor', () => {
  it('keeps a valid hex colour, lowercased, and ignores anything else', () => {
    st().setBucketColor('#ABCDEF');
    expect(st().bucketColor).toBe('#abcdef');
    st().setBucketColor('red');
    st().setBucketColor('#12345');
    expect(st().bucketColor).toBe('#abcdef');
  });
});

describe('paintBucketAt', () => {
  it('recolours the shape under the point in one undo step', () => {
    const r = rect(0, 0, 100, 100);
    const before = assetOf(r).style.fill;
    st().paintBucketAt(50, 50);
    expect(assetOf(r).style.fill).toBe('#3366ff');
    st().undo();
    expect(assetOf(r).style.fill).toBe(before);
  });

  it('keys the colour at the playhead when auto-key is on', () => {
    const r = rect(0, 0, 100, 100);
    st().toggleAutoKey();
    st().paintBucketAt(50, 50);
    const o = objects().find((x) => x.id === r.id)!;
    expect(o.colorTracks?.fill?.[0]).toMatchObject({ value: '#3366ff' });
  });

  it('fills the ring between a shape and one drawn over it with a new shape', () => {
    rect(0, 0, 100, 100);
    rect(25, 25, 50, 50);
    const n = objects().length;
    st().paintBucketAt(10, 10);
    expect(objects()).toHaveLength(n + 1);
    const fill = objects().find((o) => o.name.startsWith('Fill'))!;
    expect(assetOf(fill).style).toMatchObject({ fill: '#3366ff', stroke: 'none' });
    expect(assetOf(fill).compoundRings).toHaveLength(1); // the hole for the inner square
  });

  it('explains a click on open canvas or a locked shape without changing history', () => {
    const r = rect(0, 0, 100, 100);
    const past = st().history.past.length;
    st().paintBucketAt(300, 300);
    expect(st().toasts[0]?.message).toMatch(/Nothing closed to fill/);
    st().toggleObjectLock(r.id);
    st().paintBucketAt(50, 50);
    expect(st().toasts[0]?.message).toMatch(/locked/);
    expect(st().history.past.length).toBe(past + 1); // only the lock
  });
});
