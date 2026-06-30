import { describe, expect, test } from 'vitest';
import { ROOT_SCENE_ID, projectScenes, resolveTimeline, sceneAtTime, promoteToMultiScene, computeProjectDurationMulti } from './scenes';
import { createProject, createSceneObject, createVectorAsset } from './project';
import type { Scene } from './types';

describe('projectScenes (8b-1a)', () => {
  test('synthesizes ONE root scene when project.scenes is absent', () => {
    const asset = createVectorAsset('rect');
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

function multi(durations: number[]) {
  const scenes: Scene[] = durations.map((d, i) => ({ id: `s${i}`, name: `S${i}`, objects: [], duration: d }));
  return { ...createProject(), scenes };
}

describe('resolveTimeline (8b-1a, cut-only)', () => {
  test('cumulative spans, Σ durations', () => {
    const spans = resolveTimeline(multi([2, 3, 1]));
    expect(spans.map((s) => [s.start, s.end])).toEqual([[0, 2], [2, 5], [5, 6]]);
    expect(spans.map((s) => s.index)).toEqual([0, 1, 2]);
  });

  test('single-scene (scenes absent) → one span [0, duration]', () => {
    const p = { ...createProject({ duration: 4, durationMode: 'manual' }) };
    const spans = resolveTimeline(p);
    expect(spans).toHaveLength(1);
    expect([spans[0].start, spans[0].end]).toEqual([0, 4]);
  });
});

describe('sceneAtTime (8b-1a, cut-only)', () => {
  test('picks the active scene and local time within it', () => {
    const p = multi([2, 3, 1]);
    expect(sceneAtTime(p, 0).primary).toMatchObject({ localTime: 0 });
    expect(sceneAtTime(p, 0).primary.scene.id).toBe('s0');
    expect(sceneAtTime(p, 2.5).primary.scene.id).toBe('s1');
    expect(sceneAtTime(p, 2.5).primary.localTime).toBeCloseTo(0.5, 6);
    expect(sceneAtTime(p, 5).primary.scene.id).toBe('s2'); // boundary belongs to the next scene
    expect(sceneAtTime(p, 5).primary.localTime).toBeCloseTo(0, 6);
  });

  test('clamps past-end to the last scene final frame; never returns outgoing in 8b-1a', () => {
    const p = multi([2, 3, 1]); // total 6
    const s = sceneAtTime(p, 99);
    expect(s.primary.scene.id).toBe('s2');
    expect(s.primary.localTime).toBeCloseTo(1, 6); // = last scene duration
    expect(s.outgoing).toBeUndefined();
  });

  test('single-scene → localTime = t', () => {
    const p = { ...createProject({ duration: 4, durationMode: 'manual' }) };
    expect(sceneAtTime(p, 1.5).primary.localTime).toBeCloseTo(1.5, 6);
  });
});

describe('promoteToMultiScene (8b-1a)', () => {
  test('moves root objects/camera into scenes[0]; clears root', () => {
    const asset = createVectorAsset('rect');
    const obj = createSceneObject(asset.id, { id: 'o1' });
    const base = { ...createProject({ duration: 5, durationMode: 'manual' }), assets: [asset], objects: [obj] };

    const promoted = promoteToMultiScene(base);

    expect(promoted.scenes).toHaveLength(1);
    expect(promoted.scenes![0].id).toBe(ROOT_SCENE_ID);
    expect(promoted.scenes![0].objects).toEqual([obj]);
    expect(promoted.scenes![0].duration).toBe(5);
    expect(promoted.objects).toEqual([]);
    expect(promoted.camera).toBeUndefined();
    expect(promoted.assets).toBe(base.assets); // assets stay global, untouched
  });

  test('is idempotent on an already multi-scene project', () => {
    const p = { ...createProject(), scenes: [{ id: 's0', name: 'S0', objects: [], duration: 1 }] };
    expect(promoteToMultiScene(p)).toBe(p);
  });
});

describe('computeProjectDurationMulti (8b-1a, cut-only)', () => {
  test('Σ scene durations', () => {
    expect(computeProjectDurationMulti(multi([2, 3, 1]))).toBeCloseTo(6, 6);
  });

  test('audio tail past the last scene extends the master duration', () => {
    const p = multi([1, 1]); // scenes total 2
    p.audioClips = [{ id: 'a', assetId: 'au', startTime: 1.5, inPoint: 0, outPoint: 3 } as never]; // ends at 4.5
    expect(computeProjectDurationMulti(p)).toBeCloseTo(4.5, 6);
  });
});
