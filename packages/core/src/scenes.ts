/** Headless, id-addressed scene-sequencing builders over a `Project` (the multi-scene analog of
 *  build.ts). Pure `Project → Project` (or `{ project, sceneId }`); FAIL LOUD on bad references.
 *  Reuses the engine promote/demote so the absent-scenes parity discipline is preserved. */
import { promoteToMultiScene, demoteToSingleScene, newId } from '@savig/engine';
import type { Project, Scene, Transition } from '@savig/engine';

const MIN_SCENE_DURATION = 1 / 240;

function requireScene(project: Project, sceneId: string): Scene {
  const s = project.scenes?.find((x) => x.id === sceneId);
  if (!s) throw new Error(`savig/core: no scene with id "${sceneId}"`);
  return s;
}

/** Add a new empty scene. Auto-promotes a single-scene project so scene 0 holds the old root.
 *  Inserts after `afterIndex` (clamped; default = end). */
export function addScene(
  project: Project,
  opts: { name?: string; duration?: number; afterIndex?: number } = {},
): { project: Project; sceneId: string } {
  const promoted = project.scenes ? project : promoteToMultiScene(project);
  const scenes = promoted.scenes!;
  const scene: Scene = {
    id: newId(),
    name: opts.name ?? `Scene ${scenes.length + 1}`,
    objects: [],
    duration: opts.duration ?? 1,
  };
  const at = opts.afterIndex === undefined ? scenes.length - 1 : Math.max(0, Math.min(opts.afterIndex, scenes.length - 1));
  const next = [...scenes.slice(0, at + 1), scene, ...scenes.slice(at + 1)];
  return { project: { ...promoted, objects: [], camera: undefined, scenes: next }, sceneId: scene.id };
}

/** Remove a scene. Throws if single-scene or id unknown or it is the last scene. Demotes back to a
 *  single-scene project (parity form) when exactly one scene remains. */
export function removeScene(project: Project, sceneId: string): Project {
  if (!project.scenes) throw new Error('savig/core: removeScene on a single-scene project');
  requireScene(project, sceneId);
  if (project.scenes.length <= 1) throw new Error('savig/core: cannot remove the last scene');
  const next = project.scenes.filter((s) => s.id !== sceneId);
  return next.length === 1 ? demoteToSingleScene({ ...project, scenes: next }) : { ...project, scenes: next };
}

export function reorderScene(project: Project, sceneId: string, toIndex: number): Project {
  if (!project.scenes) throw new Error('savig/core: reorderScene on a single-scene project');
  const from = project.scenes.findIndex((s) => s.id === sceneId);
  if (from < 0) throw new Error(`savig/core: no scene with id "${sceneId}"`);
  const clamped = Math.max(0, Math.min(toIndex, project.scenes.length - 1));
  const next = [...project.scenes];
  const [moved] = next.splice(from, 1);
  next.splice(clamped, 0, moved);
  return { ...project, scenes: next };
}

export function setSceneDuration(project: Project, sceneId: string, duration: number): Project {
  if (!project.scenes) throw new Error('savig/core: setSceneDuration on a single-scene project');
  requireScene(project, sceneId);
  const d = Math.max(MIN_SCENE_DURATION, duration);
  return { ...project, scenes: project.scenes.map((s) => (s.id === sceneId ? { ...s, duration: d } : s)) };
}

/** Set the transition INTO a scene (data only; crossfade/dip RENDERING lands in 8b-4). */
export function setSceneTransition(project: Project, sceneId: string, transition: Transition): Project {
  if (!project.scenes) throw new Error('savig/core: setSceneTransition on a single-scene project');
  requireScene(project, sceneId);
  return { ...project, scenes: project.scenes.map((s) => (s.id === sceneId ? { ...s, transitionIn: transition } : s)) };
}

/** Apply a project transform WITHIN one scene: run `fn` on a scene-view (objects + camera swapped,
 *  scenes stripped), then merge the resulting objects + camera back into that scene; assets are
 *  global so they carry straight through. When `sceneId` is undefined or the project is single-scene,
 *  `fn` runs on the project directly (byte-identical parity). The single seam that lets the unchanged
 *  object/camera builders target the current scene. */
export function withScene<T extends { project: Project }>(
  project: Project,
  sceneId: string | undefined,
  fn: (p: Project) => T,
): T {
  if (!project.scenes || !sceneId) return fn(project);
  const scene = requireScene(project, sceneId);
  const view: Project = { ...project, objects: scene.objects, camera: scene.camera, scenes: undefined };
  const r = fn(view);
  const merged: Project = {
    ...project,
    assets: r.project.assets,
    scenes: project.scenes.map((s) => (s.id === sceneId ? { ...s, objects: r.project.objects, camera: r.project.camera } : s)),
  };
  return { ...r, project: merged };
}
