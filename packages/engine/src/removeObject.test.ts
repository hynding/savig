import { describe, it, expect } from 'vitest';
import { removeObject, collectReferencedAssetIds } from './removeObject';
import { createProject, createSceneObject, createVectorAsset, createSymbolAsset } from './project';
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

describe('collectReferencedAssetIds (author-in-symbol delete)', () => {
  it('collects assetIds from the root scene and symbol scenes', () => {
    const v = createVectorAsset('rect', { id: 'v', shapeType: 'rect' });
    const sym = createSymbolAsset({ id: 'sym', objects: [createSceneObject('v', { id: 'inner' })], width: 10, height: 10 });
    const project = { ...createProject(), assets: [v, sym], objects: [createSceneObject('sym', { id: 'inst' })] };
    const ids = collectReferencedAssetIds(project);
    expect(ids.has('sym')).toBe(true); // referenced by the root instance
    expect(ids.has('v')).toBe(true);   // referenced ONLY inside the symbol
  });
  it('omits a wholly-unused asset', () => {
    const v = createVectorAsset('rect', { id: 'v', shapeType: 'rect' });
    const project = { ...createProject(), assets: [v], objects: [] };
    expect(collectReferencedAssetIds(project).has('v')).toBe(false);
  });
});

describe('collectReferencedAssetIds — scene-aware (8b-1a, C3)', () => {
  it('collects assetIds referenced inside project.scenes', () => {
    const a1 = createVectorAsset('rect');
    const a2 = createVectorAsset('rect');
    const project = {
      ...createProject(),
      assets: [a1, a2],
      objects: [],
      scenes: [
        { id: 's0', name: 'S0', objects: [createSceneObject(a1.id, { id: 'o1' })], duration: 1 },
        { id: 's1', name: 'S1', objects: [createSceneObject(a2.id, { id: 'o2' })], duration: 1 },
      ],
    };
    const ids = collectReferencedAssetIds(project);
    expect(ids.has(a1.id)).toBe(true);
    expect(ids.has(a2.id)).toBe(true);
  });
});
