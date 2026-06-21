import { describe, it, expect } from 'vitest';
import { duplicateObject } from './duplicate';
import { createSceneObject, createVectorAsset } from './project';
import type { SvgAsset } from './types';

describe('duplicateObject', () => {
  const ids = { objectId: 'new-obj', assetId: 'new-asset' };

  it('vector: clones the asset, re-points the object, offsets + renames', () => {
    const asset = createVectorAsset('rect', {
      id: 'va',
      name: 'Rectangle',
      style: { fill: '#ff0000', stroke: 'none', strokeWidth: 1 },
    });
    const obj = createSceneObject('va', {
      id: 'o1',
      name: 'Rectangle 1',
      base: { x: 5, y: 7, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    });
    const { object, clonedAsset } = duplicateObject(obj, asset, ids, 10);
    expect(object.id).toBe('new-obj');
    expect(object.name).toBe('Rectangle 1 copy');
    expect([object.base.x, object.base.y]).toEqual([15, 17]);
    expect(clonedAsset?.id).toBe('new-asset');
    expect(object.assetId).toBe('new-asset'); // points at the clone
    expect(clonedAsset?.style.fill).toBe('#ff0000');
  });

  it('vector: the clone is deeply independent of the original', () => {
    const asset = createVectorAsset('rect', { id: 'va' });
    const obj = createSceneObject('va', {
      id: 'o1',
      tracks: { x: [{ time: 0, value: 0, easing: 'linear' }] },
    });
    const { object, clonedAsset } = duplicateObject(obj, asset, ids, 10);
    object.tracks.x![0].value = 999;
    clonedAsset!.style.fill = '#000000';
    expect(obj.tracks.x![0].value).toBe(0); // original untouched
    expect(asset.style.fill).not.toBe('#000000');
  });

  it('svg: shares the asset (same assetId, no clonedAsset)', () => {
    const asset: SvgAsset = {
      id: 'sa',
      kind: 'svg',
      name: 'box',
      normalizedContent: '<svg/>',
      viewBox: '0 0 1 1',
      width: 1,
      height: 1,
    };
    const obj = createSceneObject('sa', { id: 'o1', name: 'box 1' });
    const { object, clonedAsset } = duplicateObject(obj, asset, ids, 10);
    expect(object.assetId).toBe('sa');
    expect(clonedAsset).toBeUndefined();
    expect(object.name).toBe('box 1 copy');
  });
});
