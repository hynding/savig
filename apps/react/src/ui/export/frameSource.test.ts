import { describe, expect, it } from 'vitest';
import { createProject, createSceneObject, createKeyframe } from '@savig/engine';
import { createFrameSource } from './frameSource';

const svgAsset = {
  id: 'a', kind: 'svg' as const, name: 'box', viewBox: '0 0 10 10', width: 10, height: 10,
  normalizedContent: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
};

describe('createFrameSource', () => {
  it('bakes the sampled transform for the requested master time into the serialized frame', () => {
    const obj = createSceneObject('a', { id: 'o1', tracks: { x: [createKeyframe(0, 0), createKeyframe(1, 100)] } });
    const project = { ...createProject(), assets: [svgAsset], objects: [obj] };
    const src = createFrameSource(project);
    const at0 = src.frameSvg(0);
    const at1 = src.frameSvg(1);
    expect(at0).toContain('<svg'); // a real document
    expect(at0).not.toBe(at1); // animation visibly baked
    expect(at1).toContain('100'); // the keyframed x landed in the frame
  });

  it('parses ONCE: two frameSvg calls at the same t are byte-identical (stable serialization)', () => {
    const obj = createSceneObject('a', { id: 'o1' });
    const project = { ...createProject(), assets: [svgAsset], objects: [obj] };
    const src = createFrameSource(project);
    expect(src.frameSvg(0.5)).toBe(src.frameSvg(0.5));
  });
});
