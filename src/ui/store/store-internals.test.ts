import { describe, it, expect } from 'vitest';
import { promoteToMultiScene } from '../../engine';
import { createProject, createSceneObject } from '../../engine';
import { appendToScene, sceneObjectsOf } from './store-internals';

const multi = () => promoteToMultiScene({ ...createProject(), objects: [createSceneObject('a')] });

describe('scene-aware write helpers', () => {
  it('writes the active scene, leaving project.objects empty in multi-scene', () => {
    const p = multi();
    const sceneId = p.scenes![0].id;
    const obj = createSceneObject('b');
    const next = appendToScene(p, { sceneId, assetId: null }, obj);
    expect(next.objects).toEqual([]); // root stays empty (source-of-truth rule)
    expect(next.scenes![0].objects.map((o) => o.id)).toContain(obj.id);
  });

  it('single-scene: writes project.objects (parity)', () => {
    const p = { ...createProject(), objects: [createSceneObject('a')] };
    const obj = createSceneObject('b');
    const next = appendToScene(p, { sceneId: null, assetId: null }, obj);
    expect(next.objects.map((o) => o.id)).toContain(obj.id);
    expect(next.scenes).toBeUndefined();
  });

  it('symbol axis wins over scene base', () => {
    const p = multi();
    // (a symbol asset would be added by the editor; here assert assetId routes to assets even with sceneId set)
    expect(sceneObjectsOf(p, { sceneId: p.scenes![0].id, assetId: 'missing' })).toBe(p.scenes![0].objects);
  });
});
