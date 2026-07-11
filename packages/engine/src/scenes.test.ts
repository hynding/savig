import { describe, expect, it, test } from 'vitest';
import { ROOT_SCENE_ID, projectScenes, resolveTimeline, sceneAtTime, promoteToMultiScene, computeProjectDurationMulti, demoteToSingleScene } from './scenes';
import { createKeyframe, createProject, createSceneObject, createVectorAsset } from './project';
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

  test('scenes: [] (invalid state) does not throw; returns empty-object scene', () => {
    const p = { ...createProject(), scenes: [] };
    const result = sceneAtTime(p, 0);
    expect(result.primary.scene.objects).toHaveLength(0);
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

  test('transfers root camera into scenes[0].camera; clears project.camera', () => {
    const camera = { base: { x: 0, y: 0, zoom: 1, rotation: 0 }, tracks: {} };
    const base = { ...createProject({ duration: 2, durationMode: 'manual' }), camera };

    const promoted = promoteToMultiScene(base);

    expect(promoted.scenes![0].camera).toEqual(camera);
    expect(promoted.camera).toBeUndefined();
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

describe('transitions (8b-4)', () => {
  const sc = (id: string, duration: number, transitionIn?: Scene['transitionIn']): Scene =>
    ({ id, name: id, objects: [], duration, ...(transitionIn ? { transitionIn } : {}) });

  function multiTrans(scenes: Scene[]) {
    return { ...createProject(), objects: [], camera: undefined, scenes };
  }

  it('crossfade overlaps the previous scene: starts d before it ends', () => {
    const p = multiTrans([sc('a', 2), sc('b', 3, { kind: 'crossfade', duration: 1 })]);
    const spans = resolveTimeline(p);
    expect(spans[0]).toMatchObject({ start: 0, end: 2 });
    expect(spans[1].start).toBe(1);          // 2 - overlap(1)
    expect(spans[1].end).toBe(4);            // 1 + duration(3)
    expect(computeProjectDurationMulti(p)).toBe(4); // 2+3 - 1 overlap
  });

  it('overlap clamps to the shorter adjacent scene', () => {
    const p = multiTrans([sc('a', 1), sc('b', 5, { kind: 'dip', duration: 4, color: '#000' })]);
    expect(resolveTimeline(p)[1].start).toBe(0); // overlap clamped to min(1,5)=1 → start 1-1=0
    expect(computeProjectDurationMulti(p)).toBe(5);
  });

  it('cut / scenes[0].transitionIn → no overlap (parity)', () => {
    const p = multiTrans([sc('a', 2, { kind: 'crossfade', duration: 1 }), sc('b', 3)]); // transitionIn on [0] ignored
    expect(resolveTimeline(p).map((s) => [s.start, s.end])).toEqual([[0, 2], [2, 5]]);
    expect(computeProjectDurationMulti(p)).toBe(5);
  });

  it('sceneAtTime returns outgoing with progress during the overlap window', () => {
    const p = multiTrans([sc('a', 2), sc('b', 3, { kind: 'crossfade', duration: 1 })]); // overlap [1,2]
    const mid = sceneAtTime(p, 1.5);
    expect(mid.primary.scene.id).toBe('b');          // incoming is primary mid-transition
    expect(mid.primary.localTime).toBeCloseTo(0.5);  // 1.5 - start_b(1)
    expect(mid.outgoing!.scene.id).toBe('a');
    expect(mid.outgoing!.localTime).toBeCloseTo(1.5); // 1.5 - start_a(0)
    expect(mid.outgoing!.progress).toBeCloseTo(0.5);  // (1.5 - 1) / 1
  });

  it('sceneAtTime: before & after the overlap there is no outgoing', () => {
    const p = multiTrans([sc('a', 2), sc('b', 3, { kind: 'crossfade', duration: 1 })]);
    expect(sceneAtTime(p, 0.5).outgoing).toBeUndefined();        // pure scene a
    expect(sceneAtTime(p, 0.5).primary.scene.id).toBe('a');
    expect(sceneAtTime(p, 3).outgoing).toBeUndefined();          // pure scene b (past overlap)
    expect(sceneAtTime(p, 3).primary.scene.id).toBe('b');
  });
});

describe('demoteToSingleScene (8b-3)', () => {
  it('folds a single remaining scene back to root (inverse of promote)', () => {
    const p0 = { ...createProject(), objects: [createSceneObject('a')] };
    const promoted = promoteToMultiScene(p0);
    const demoted = demoteToSingleScene(promoted);
    expect(demoted.scenes).toBeUndefined();
    expect(demoted.objects).toBe(promoted.scenes![0].objects);
    expect(demoted.camera).toBe(promoted.scenes![0].camera);
  });

  it('is a no-op with 2+ scenes or already single-scene', () => {
    const p = createProject();
    expect(demoteToSingleScene(p)).toBe(p);
    const two = { ...promoteToMultiScene(p), scenes: [{ id: ROOT_SCENE_ID, name: 'A', objects: [], duration: 1 }, { id: 'x', name: 'B', objects: [], duration: 1 }] };
    expect(demoteToSingleScene(two)).toBe(two);
  });
});

// ── repeat extends scene-local duration (Task 2) ────────────────────────────
// computeProjectDurationMulti (above) sums already-stored scene.duration fields; it does no
// per-object math of its own. The repeat->duration extension lives entirely in
// objectsMaxKeyframeTime (duration.ts), reached by BOTH scene-synthesis paths below via the
// SAME shared computeProjectDuration call (projectScenes:31, promoteToMultiScene:81) — so no
// separate repeat-aware code is needed in scenes.ts.
describe('repeat extends scene-local duration (Task 2)', () => {
  function repeatedObject() {
    const asset = createVectorAsset('rect');
    const obj = createSceneObject(asset.id, {
      id: 'o1',
      tracks: { y: [createKeyframe(0, 0), createKeyframe(2, 100)] },
      repeat: { count: 4, dx: 0, dy: 0, rotate: 0, scale: 1, stagger: 0.5 },
    });
    return { asset, obj };
  }

  test('projectScenes synthesizes a root scene whose duration reflects the repeat extension', () => {
    const { asset, obj } = repeatedObject();
    const project = { ...createProject(), assets: [asset], objects: [obj] };

    const scenes = projectScenes(project);

    expect(scenes[0].duration).toBeGreaterThanOrEqual(3.5);
  });

  test('promoteToMultiScene carries the repeat-extended duration into scenes[0]', () => {
    const { asset, obj } = repeatedObject();
    const project = { ...createProject(), assets: [asset], objects: [obj] };

    const promoted = promoteToMultiScene(project);

    expect(promoted.scenes![0].duration).toBeGreaterThanOrEqual(3.5);
  });

  test('computeProjectDurationMulti sums whatever scene.duration already carries (no double math)', () => {
    const p = multi([3.5, 1]); // scene[0].duration already reflects a repeat-extended object
    expect(computeProjectDurationMulti(p)).toBeCloseTo(4.5, 6);
  });
});
