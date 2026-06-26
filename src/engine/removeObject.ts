import type { Project, SceneObject } from './types';

/** Every assetId referenced by an object across the WHOLE project — the root scene AND every
 *  SymbolAsset's objects[]. The basis for a cross-scene "is this asset still used?" check
 *  (author-in-symbol delete). */
export function collectReferencedAssetIds(project: Project): Set<string> {
  const ids = new Set<string>();
  const add = (objects: SceneObject[]): void => {
    for (const o of objects) if (o.assetId) ids.add(o.assetId);
  };
  add(project.objects);
  for (const a of project.assets) if (a.kind === 'symbol') add(a.objects);
  return ids;
}

/** Remove the object with `objectId`, and prune its asset if no remaining object
 *  references it (vector assets are 1:1 -> always pruned; a shared svg asset is
 *  kept). Returns the SAME project reference when the id is not found. */
export function removeObject(project: Project, objectId: string): Project {
  const obj = project.objects.find((o) => o.id === objectId);
  if (!obj) return project;
  const objects = project.objects.filter((o) => o.id !== objectId);
  const assetStillUsed = objects.some((o) => o.assetId === obj.assetId);
  const assets = assetStillUsed
    ? project.assets
    : project.assets.filter((a) => a.id !== obj.assetId);
  return { ...project, objects, assets };
}
