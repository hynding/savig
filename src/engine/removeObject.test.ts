import { describe, it, expect } from 'vitest';
import { removeObject } from './removeObject';
import { createProject, createSceneObject, createVectorAsset } from './project';
import type { Project, SvgAsset } from './types';

describe('removeObject', () => {
  it('vector: removes the object and prunes its 1:1 asset', () => {
    const asset = createVectorAsset('rect', { id: 'va' });
    const obj = createSceneObject('va', { id: 'o1' });
    const project: Project = { ...createProject(), assets: [asset], objects: [obj] };
    const next = removeObject(project, 'o1');
    expect(next.objects).toHaveLength(0);
    expect(next.assets).toHaveLength(0); // asset pruned
  });

  it('shared svg asset: removes the object but KEEPS the asset (sibling still uses it)', () => {
    const asset: SvgAsset = {
      id: 'sa',
      kind: 'svg',
      name: 'box',
      normalizedContent: '<svg/>',
      viewBox: '0 0 1 1',
      width: 1,
      height: 1,
    };
    const o1 = createSceneObject('sa', { id: 'o1' });
    const o2 = createSceneObject('sa', { id: 'o2' });
    const project: Project = { ...createProject(), assets: [asset], objects: [o1, o2] };
    const next = removeObject(project, 'o1');
    expect(next.objects.map((o) => o.id)).toEqual(['o2']);
    expect(next.assets).toHaveLength(1); // kept, still referenced by o2
  });

  it('unknown id: returns the same project reference (no-op signal)', () => {
    const project = createProject();
    expect(removeObject(project, 'nope')).toBe(project);
  });
});
