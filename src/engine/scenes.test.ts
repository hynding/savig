import { describe, expect, test } from 'vitest';
import { ROOT_SCENE_ID, projectScenes, resolveTimeline, sceneAtTime } from './scenes';
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
