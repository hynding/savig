import type { Asset, SceneObject, TextAsset, VectorAsset } from './types';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Deep-clone a scene object for duplication. The clone gets `ids.objectId`, name
 *  "<name> copy", and its base translation offset by `offset` in x and y. For a
 *  VECTOR or TEXT asset, also returns a cloned asset with `ids.assetId` and re-points
 *  the object at it (independent path/style, or independent text content/fields);
 *  otherwise the object keeps its original `assetId` and no asset is returned
 *  (svg/symbol/audio stay shared/instanced — same imported graphic or symbol).
 *  `zOrder` is left as-cloned; the caller places the copy. */
export function duplicateObject(
  obj: SceneObject,
  asset: Asset | undefined,
  ids: { objectId: string; assetId: string },
  offset: number,
): { object: SceneObject; clonedAsset?: VectorAsset | TextAsset } {
  const object = clone(obj);
  delete object.parentId; // a clone is detached from its source's group container (slice 45)
  object.id = ids.objectId;
  object.name = `${obj.name} copy`;
  object.base = { ...object.base, x: object.base.x + offset, y: object.base.y + offset };
  if (asset && (asset.kind === 'vector' || asset.kind === 'text')) {
    const clonedAsset: VectorAsset | TextAsset = { ...clone(asset), id: ids.assetId };
    object.assetId = ids.assetId;
    return { object, clonedAsset };
  }
  return { object };
}
