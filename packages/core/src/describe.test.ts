import { describe, it, expect } from 'vitest';
import { createProject, createVectorAsset, createSceneObject } from '@savig/engine';
import { addRect, setKeyframe } from './build';
import { describeProject } from './describe';

describe('core/describe', () => {
  it('summarizes meta, assets, and objects with their animated track times', () => {
    let p = createProject({ name: 'Demo', width: 640, height: 480, fps: 24 });
    ({ project: p } = addRect(p, { x: 10, y: 20, width: 100, height: 50, id: 'r1', name: 'Box' }));
    p = setKeyframe(p, { objectId: 'r1', property: 'x', time: 0, value: 10 });
    p = setKeyframe(p, { objectId: 'r1', property: 'x', time: 2, value: 300 });

    const text = describeProject(p);
    expect(text).toContain('"Demo"');
    expect(text).toContain('640×480 @ 24fps');
    expect(text).toContain('1 vector');
    expect(text).toContain('r1');
    expect(text).toContain('Box');
    expect(text).toContain('x@[0,2]'); // animated track times
  });

  it('reflects the computed duration (longest keyframe time, auto mode)', () => {
    let p = addRect(createProject(), { x: 0, y: 0, width: 10, height: 10, id: 'r' }).project;
    p = setKeyframe(p, { objectId: 'r', property: 'opacity', time: 0, value: 0 });
    p = setKeyframe(p, { objectId: 'r', property: 'opacity', time: 3, value: 1 });
    expect(describeProject(p)).toContain('duration 3s');
  });
});

describe('describeProject — scenes (8b-2d)', () => {
  it('lists scenes with name, duration, and object count when present', () => {
    const a = createVectorAsset('rect', { id: 'aRect' });
    const project = { ...createProject(), assets: [a], objects: [], scenes: [
      { id: 'scA', name: 'Intro', objects: [createSceneObject('aRect', { id: 'oa' })], duration: 2 },
      { id: 'scB', name: 'Outro', objects: [], duration: 1 },
    ] };
    const out = describeProject(project);
    expect(out).toContain('Scenes (2)');
    expect(out).toContain('Intro');
    expect(out).toMatch(/Intro.*2/);   // duration or obj count present on the Intro line
  });
  it('single-scene project description is unchanged (no Scenes section)', () => {
    const a = createVectorAsset('rect', { id: 'r' });
    const p = { ...createProject(), assets: [a], objects: [createSceneObject('r', { id: 'o' })] };
    expect(describeProject(p)).not.toContain('Scenes (');
  });
});
