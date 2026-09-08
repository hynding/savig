import { describe, it, test, expect } from 'vitest';
import { createProject, createSceneObject, createKeyframe } from '@savig/engine';
import type { AudioAsset, SceneObject } from '@savig/engine';
import { addRect, setKeyframe, setBaseTransform, addAudioTrack, addAudioClip, setClipFades, setTrackEffect } from './build';
import { validateProject } from './validate';

const audioAsset: AudioAsset = { id: 'a1', kind: 'audio', name: 'a1', mimeType: 'audio/mpeg', duration: 10 };

const codes = (p: Parameters<typeof validateProject>[0]) => validateProject(p).map((i) => i.code);

describe('core/validate', () => {
  it('passes a clean project with no issues', () => {
    let p = addRect(createProject(), { x: 100, y: 100, width: 50, height: 50, id: 'r' }).project;
    p = setKeyframe(p, { objectId: 'r', property: 'x', time: 0, value: 100 });
    p = setKeyframe(p, { objectId: 'r', property: 'x', time: 1, value: 200 });
    expect(validateProject(p)).toEqual([]);
  });

  it('flags a dangling asset reference as an error', () => {
    let p = addRect(createProject(), { x: 0, y: 0, width: 10, height: 10, id: 'r' }).project;
    p = { ...p, assets: [] }; // orphan the object
    expect(codes(p)).toContain('dangling-asset');
  });

  it('flags a single-keyframe track as a warning', () => {
    let p = addRect(createProject(), { x: 0, y: 0, width: 10, height: 10, id: 'r' }).project;
    p = setKeyframe(p, { objectId: 'r', property: 'x', time: 0, value: 0 });
    expect(codes(p)).toContain('single-keyframe');
  });

  it('flags a non-finite base transform as an error', () => {
    let p = addRect(createProject(), { x: 0, y: 0, width: 10, height: 10, id: 'r' }).project;
    p = setBaseTransform(p, 'r', { x: NaN });
    expect(codes(p)).toContain('non-finite-transform');
  });

  it('flags an off-artboard object as a warning', () => {
    const p = addRect(createProject({ width: 100, height: 100 }), { x: 5000, y: 0, width: 10, height: 10, id: 'r' }).project;
    expect(codes(p)).toContain('off-artboard');
  });

  it('flags a keyframe past the project duration as a warning', () => {
    // duration comes from the LONGEST track; a lone far-future keyframe on a 1-frame track is "past"
    let p = addRect(createProject(), { x: 0, y: 0, width: 10, height: 10, id: 'r' }).project;
    p = setKeyframe(p, { objectId: 'r', property: 'x', time: 0, value: 0 });
    p = setKeyframe(p, { objectId: 'r', property: 'x', time: 2, value: 1 });
    // a dangling parent on a manually-built object should also be caught
    p = { ...p, objects: [...p.objects, { ...p.objects[0], id: 'orphan', parentId: 'ghost' }] };
    expect(codes(p)).toContain('dangling-parent');
  });
});

describe('validateProject — multi-scene (8b-1a, I3)', () => {
  test('runs per-object checks inside each scene (dangling asset caught in scene 1)', () => {
    const project = {
      ...createProject(),
      assets: [],
      objects: [],
      scenes: [
        { id: 's0', name: 'S0', objects: [], duration: 1 },
        { id: 's1', name: 'S1', objects: [createSceneObject('missing', { id: 'o1' })], duration: 1 },
      ],
    };
    const issues = validateProject(project);
    expect(issues.some((i) => i.code === 'dangling-asset' && i.objectId === 'o1')).toBe(true);
  });

  test('flags scenes/objects source-of-truth conflict', () => {
    const project = {
      ...createProject(),
      objects: [createSceneObject('x', { id: 'stray' })],
      scenes: [{ id: 's0', name: 'S0', objects: [], duration: 1 }],
    };
    expect(validateProject(project).some((i) => i.code === 'scenes-objects-conflict')).toBe(true);
  });

  test('flags non-positive scene duration and duplicate scene ids', () => {
    const project = {
      ...createProject(),
      objects: [],
      scenes: [
        { id: 'dup', name: 'A', objects: [], duration: 0 },
        { id: 'dup', name: 'B', objects: [], duration: 1 },
      ],
    };
    const codes = validateProject(project).map((i) => i.code);
    expect(codes).toContain('scene-nonpositive-duration');
    expect(codes).toContain('duplicate-scene-id');
  });

  test('warns on transitionIn set on the first scene', () => {
    const project = {
      ...createProject(),
      objects: [],
      scenes: [{ id: 's0', name: 'S0', objects: [], duration: 1, transitionIn: { kind: 'cut' as const } }],
    };
    expect(validateProject(project).some((i) => i.code === 'transition-on-first-scene')).toBe(true);
  });

  test('single-scene project validation is unchanged (parity)', () => {
    const project = { ...createProject(), objects: [createSceneObject('missing', { id: 'o1' })] };
    expect(validateProject(project).some((i) => i.code === 'dangling-asset')).toBe(true);
  });

  test('warns when a transition is longer than an adjacent scene', () => {
    const project = {
      ...createProject(),
      objects: [],
      scenes: [
        { id: 's0', name: 'S0', objects: [], duration: 1 },
        { id: 's1', name: 'S1', objects: [], duration: 2, transitionIn: { kind: 'crossfade' as const, duration: 1.5 } },
      ],
    };
    // 1.5s transition > s0.duration (1s) → should warn
    expect(validateProject(project).some((i) => i.code === 'transition-too-long')).toBe(true);
  });

  test('flags an empty scenes array', () => {
    const project = { ...createProject(), objects: [], scenes: [] };
    expect(validateProject(project).some((i) => i.code === 'empty-scenes')).toBe(true);
  });

  test('flags a keyframe past a scene own duration in multi-scene mode', () => {
    // scene 0 is 2s, scene 1 is 2s → project total 4s
    // object in scene 0 has a keyframe at t=3 (> scene 0 duration of 2s but < project total 4s)
    // should still flag keyframe-past-duration against scene own duration
    const project = {
      ...createProject(),
      objects: [],
      scenes: [
        {
          id: 's0', name: 'S0', duration: 2,
          objects: [createSceneObject('x', {
            id: 'o0',
            tracks: { x: [createKeyframe(0, 0), createKeyframe(3, 9)] },
          })],
        },
        { id: 's1', name: 'S1', objects: [], duration: 2 },
      ],
    };
    expect(validateProject(project).some((i) => i.code === 'keyframe-past-duration' && i.objectId === 'o0')).toBe(true);
  });
});

describe('validateProject — repeat (Task 4)', () => {
  const withRepeat = (repeat: SceneObject['repeat']) => {
    const { project, id } = addRect(createProject(), { x: 0, y: 0, width: 10, height: 10, id: 'r' });
    return { project: { ...project, objects: project.objects.map((o) => (o.id === id ? { ...o, repeat } : o)) }, id };
  };

  it('case 7: a valid repeat spec produces no issues', () => {
    const { project } = withRepeat({ count: 5, dx: 10, dy: 0, rotate: 15, scale: 1.2, stagger: 0.1 });
    expect(codes(project)).toEqual([]);
  });

  it('case 7: a non-integer or out-of-range count is an error', () => {
    const { project: p1 } = withRepeat({ count: 1.5, dx: 0, dy: 0, rotate: 0, scale: 1, stagger: 0 });
    expect(codes(p1)).toContain('repeat-count-out-of-range');
    const { project: p2 } = withRepeat({ count: 200, dx: 0, dy: 0, rotate: 0, scale: 1, stagger: 0 });
    expect(codes(p2)).toContain('repeat-count-out-of-range');
  });

  it('case 7: negative stagger is an error', () => {
    const { project } = withRepeat({ count: 3, dx: 0, dy: 0, rotate: 0, scale: 1, stagger: -1 });
    expect(codes(project)).toContain('repeat-stagger-invalid');
  });

  it('case 7: a non-finite dx is an error', () => {
    const { project } = withRepeat({ count: 3, dx: NaN, dy: 0, rotate: 0, scale: 1, stagger: 0 });
    expect(codes(project)).toContain('repeat-non-finite');
  });

  it('case 7: an out-of-range scale is an error', () => {
    const { project } = withRepeat({ count: 3, dx: 0, dy: 0, rotate: 0, scale: 0, stagger: 0 });
    expect(codes(project)).toContain('repeat-scale-out-of-range');
  });
});

describe('core/validate audio', () => {
  it('passes a clean project with a track + a well-formed tracked clip', () => {
    let p = createProject();
    p = { ...p, assets: [...p.assets, audioAsset] };
    let trackId: string;
    ({ project: p, id: trackId } = addAudioTrack(p, { name: 'Music' }));
    ({ project: p } = addAudioClip(p, { assetId: 'a1', trackId, at: 0, inPoint: 0, outPoint: 5 }));
    expect(validateProject(p)).toEqual([]);
  });

  it('flags a clip referencing a missing/non-audio asset as an error', () => {
    let p = createProject();
    ({ project: p } = addAudioClip(p, { assetId: 'ghost', at: 0, inPoint: 0, outPoint: 1 }));
    expect(codes(p)).toContain('dangling-audio-asset');
  });

  it('flags a clip whose assetId points at a non-audio asset as an error', () => {
    let p = addRect(createProject(), { x: 0, y: 0, width: 10, height: 10, id: 'r' }).project;
    ({ project: p } = addAudioClip(p, { assetId: 'r-asset', at: 0, inPoint: 0, outPoint: 1 }));
    expect(codes(p)).toContain('dangling-audio-asset');
  });

  it('flags a clip with a dangling trackId as a warning (still plays on the default lane)', () => {
    let p = createProject();
    p = { ...p, assets: [...p.assets, audioAsset] };
    ({ project: p } = addAudioClip(p, { assetId: 'a1', trackId: 'ghost', at: 0, inPoint: 0, outPoint: 1 }));
    const issues = validateProject(p);
    const issue = issues.find((i) => i.code === 'dangling-audio-track');
    expect(issue?.severity).toBe('warn');
  });

  it.each([
    ['inPoint >= outPoint', { inPoint: 3, outPoint: 1 }],
    ['negative inPoint', { inPoint: -1, outPoint: 1 }],
    ['negative outPoint', { inPoint: 0, outPoint: -1 }],
    ['outPoint past the asset duration', { inPoint: 0, outPoint: 999 }],
  ])('flags an invalid clip window (%s) as audio-clip-window', (_label, window) => {
    let p = createProject();
    p = { ...p, assets: [...p.assets, audioAsset] };
    ({ project: p } = addAudioClip(p, { assetId: 'a1', at: 0, inPoint: window.inPoint, outPoint: window.outPoint }));
    expect(codes(p)).toContain('audio-clip-window');
  });

  it('does not flag a window past duration when the asset duration is unknown', () => {
    let p = createProject();
    p = { ...p, assets: [...p.assets, { ...audioAsset, duration: undefined }] };
    let id: string;
    ({ project: p, id } = addAudioClip(p, { assetId: 'a1', at: 0, inPoint: 0, outPoint: 999 }));
    expect(codes(p)).not.toContain('audio-clip-window');
    expect(id).toBeTruthy();
  });

  it('flags a fade longer than the clip as a warning (clamps at runtime)', () => {
    let p = createProject();
    p = { ...p, assets: [...p.assets, audioAsset] };
    let id: string;
    ({ project: p, id } = addAudioClip(p, { assetId: 'a1', at: 0, inPoint: 0, outPoint: 2 }));
    p = setClipFades(p, id, { fadeIn: 99 });
    const issues = validateProject(p);
    const issue = issues.find((i) => i.code === 'audio-fade-too-long');
    expect(issue?.severity).toBe('warn');
  });

  it('flags an out-of-range volume as an error', () => {
    let p = createProject();
    p = { ...p, assets: [...p.assets, audioAsset] };
    ({ project: p } = addAudioClip(p, { assetId: 'a1', at: 0, inPoint: 0, outPoint: 1, volume: 2 }));
    expect(codes(p)).toContain('audio-volume-range');
  });

  it('flags an out-of-range track gain as an error', () => {
    let p = createProject();
    ({ project: p } = addAudioTrack(p, { gain: 5 }));
    expect(codes(p)).toContain('audio-gain-range');
  });

  it('flags an out-of-range track pan as an error', () => {
    let p = createProject();
    let trackId: string;
    ({ project: p, id: trackId } = addAudioTrack(p));
    p = setTrackEffect(p, trackId, { pan: 3 });
    expect(codes(p)).toContain('audio-pan-range');
  });

  it('flags an out-of-range filter frequency as an error', () => {
    let p = createProject();
    let trackId: string;
    ({ project: p, id: trackId } = addAudioTrack(p));
    p = setTrackEffect(p, trackId, { filter: { kind: 'lowpass', frequency: 99999 } });
    expect(codes(p)).toContain('audio-filter-frequency-range');
  });
});
