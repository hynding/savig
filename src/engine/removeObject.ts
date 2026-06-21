import type { Project } from './types';

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
