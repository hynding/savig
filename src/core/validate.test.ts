import { describe, it, expect } from 'vitest';
import { createProject } from '../engine';
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
