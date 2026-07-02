import type { SceneObject } from '@savig/engine';

/** Build the id→object map that `isLockedInTree` / `isRenderHidden` walk to resolve lock/hide
 *  topology up the parent chain. Shared by the view-models that filter by lock/hide state
 *  (inspector, layersPanel, timeline) so the lookup index is defined once. */
export function buildLockIndex(objects: SceneObject[]): Map<string, SceneObject> {
  return new Map(objects.map((o) => [o.id, o]));
}
