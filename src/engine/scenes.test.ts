import { describe, expect, test } from 'vitest';
import { ROOT_SCENE_ID, projectScenes } from './scenes';
import { createProject, createSceneObject, createVectorAsset } from './project';
import type { Scene } from './types';

describe('projectScenes (8b-1a)', () => {
  test('synthesizes ONE root scene when project.scenes is absent', () => {
    const asset = createVectorAsset();
    const obj = createSceneObject(asset.id, { id: 'o1' });
    const project = { ...createProject({ duration: 3, durationMode: 'manual' }), assets: [asset], objects: [obj] };

    const scenes = projectScenes(project);

    expect(scenes).toHaveLength(1);
    expect(scenes[0].id).toBe(ROOT_SCENE_ID);
    expect(scenes[0].name).toBe('Scene 1');
    expect(scenes[0].objects).toBe(project.objects); // same reference, not a copy
    expect(scenes[0].duration).toBe(3); // = computeProjectDuration (manual)
  });

  test('returns project.scenes verbatim when present', () => {
    const sceneA: Scene = { id: 's-a', name: 'A', objects: [], duration: 2 };
    const project = { ...createProject(), scenes: [sceneA] };

    const scenes = projectScenes(project);

    expect(scenes).toBe(project.scenes); // same array reference
    expect(scenes[0].id).toBe('s-a');
  });
});
