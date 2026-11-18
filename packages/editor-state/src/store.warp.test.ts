// Distort / envelope (spec 2026-11-18-skew-distort, slice 3): the store mode and verb.
import { beforeEach, describe, expect, it } from 'vitest';
import { boxCorners, boxMesh, createProject, type SceneObject, type VectorAsset } from '@savig/engine';
import { store } from './store';
import { selectActiveObjects } from './selectors';

const st = () => store.getState();
const objects = (): SceneObject[] => selectActiveObjects(st());
const assetOf = (o: SceneObject) => st().history.present.assets.find((a) => a.id === o.assetId) as VectorAsset | undefined;

beforeEach(() => {
  st().setProject(createProject());
  st().setWarpMode(null);
});

describe('warp', () => {
  it('toggles the mode', () => {
    st().setWarpMode('envelope');
    expect(st().warpMode).toBe('envelope');
    st().setWarpMode(null);
    expect(st().warpMode).toBeNull();
  });

  it('distorts the selected rect into a path in one undo step', () => {
    st().addVectorShape('rect', { x: 10, y: 10, width: 100, height: 50 });
    const id = st().selectedObjectId!;
    const box = { x: 0, y: 0, width: 100, height: 50 };
    const corners = boxCorners(box);
    corners[1] = { x: 120, y: -20 };
    st().warpSelected({ kind: 'distort', corners });
    const o = objects().find((x) => x.id === id)!;
    expect(assetOf(o)!.shapeType).toBe('path');
    expect(assetOf(o)!.path!.nodes[1].anchor).toEqual({ x: 120, y: -20 });
    st().undo();
    expect(assetOf(objects().find((x) => x.id === id)!)!.shapeType).toBe('rect');
  });

  it('toasts instead of warping a shape with an animated size', () => {
    st().addVectorShape('rect', { x: 10, y: 10, width: 100, height: 50 });
    const id = st().selectedObjectId!;
    const p = st().history.present;
    st().setProject({ ...p, objects: p.objects.map((o) => (o.id === id ? { ...o, tracks: { ...o.tracks, width: [{ time: 0, value: 80, easing: 'linear' as const }] } } : o)) });
    st().selectObject(id);
    const before = st().history.present;
    st().warpSelected({ kind: 'envelope', mesh: boxMesh({ x: 0, y: 0, width: 80, height: 50 }) });
    expect(st().history.present).toBe(before);
    expect(st().toasts[0].message).toMatch(/animated size/);
  });

});
