import { computeProjectDuration } from './duration';
import type { Project, Scene } from './types';

/** Stable sentinel id for the single scene synthesized from a single-scene project's root. */
export const ROOT_SCENE_ID = 'scene-root';

/** The project's scenes, or a single synthesized scene from the root when `scenes` is absent.
 *  THE one seam every scene-aware consumer reads through, so the absent case stays parity-safe.
 *  The synthesized scene is a read-only projection — never write it back. */
export function projectScenes(project: Project): Scene[] {
  if (project.scenes) return project.scenes;
  return [
    {
      id: ROOT_SCENE_ID,
      name: 'Scene 1',
      objects: project.objects,
      camera: project.camera,
      duration: computeProjectDuration(project),
    },
  ];
}
