import { describe, it, test, expect } from 'vitest';
import { createProject, createSceneObject, createKeyframe } from '@savig/engine';
import { addRect, setKeyframe, setBaseTransform } from './build';
import { validateProject } from './validate';

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
