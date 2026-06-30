import { computeProjectDuration } from './duration';
import type { Project, Scene } from './types';

export interface SceneSpan {
  scene: Scene;
  index: number;
  start: number;
  end: number;
}

export interface SceneSample {
  primary: { scene: Scene; localTime: number };
  /** Present only mid-transition (8b-4); always undefined in 8b-1a (cuts only). */
  outgoing?: { scene: Scene; localTime: number; progress: number };
}

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

/** Cumulative scene layout on the master timeline. Cut-only: `start[i] = Σ duration[0..i-1]`.
 *  (8b-4 will subtract transition overlaps here.) */
export function resolveTimeline(project: Project): SceneSpan[] {
  const scenes = projectScenes(project);
  const spans: SceneSpan[] = [];
  let cursor = 0;
  scenes.forEach((scene, index) => {
    const start = cursor;
    const end = start + scene.duration;
    spans.push({ scene, index, start, end });
    cursor = end;
  });
  return spans;
}

/** Promote a single-scene project to multi-scene: the root objects/camera/duration become
 *  `scenes[0]` (id ROOT_SCENE_ID), and the root `objects`/`camera` are cleared so `scenes` is the
 *  sole source of truth (§3 of the spec). Idempotent. Assets stay project-global. */
export function promoteToMultiScene(project: Project): Project {
  if (project.scenes) return project;
  const scene0: Scene = {
    id: ROOT_SCENE_ID,
    name: 'Scene 1',
    objects: project.objects,
    camera: project.camera,
    duration: computeProjectDuration(project),
  };
  return { ...project, objects: [], camera: undefined, scenes: [scene0] };
}

/** The scene(s) on screen at master time `t`. Cut-only: the active span's scene, `localTime = t -
 *  start`. `t` past the end pins to the last scene's final frame (matches single-scene clamp). */
export function sceneAtTime(project: Project, t: number): SceneSample {
  const spans = resolveTimeline(project);
  const last = spans[spans.length - 1];
  for (const span of spans) {
    // A boundary time belongs to the NEXT scene: [start, end). The last span owns its end.
    if (t < span.end || span === last) {
      const localTime = Math.min(Math.max(0, t - span.start), span.scene.duration);
      return { primary: { scene: span.scene, localTime } };
    }
  }
  // Unreachable (spans is non-empty), but satisfy the type.
  return { primary: { scene: last.scene, localTime: last.scene.duration } };
}

/** Master-timeline length of a multi-scene project: `max(Σ scene durations, Σ audioClip ends)`.
 *  Audio lives on the master timeline (per-scene audio is deferred), so a clip tail past the last
 *  scene still extends the project. Cut-only in 8b-1a (8b-4 subtracts transition overlaps). */
export function computeProjectDurationMulti(project: Project): number {
  const scenes = project.scenes ?? [];
  let max = 0;
  for (const scene of scenes) max += scene.duration;
  for (const clip of project.audioClips) {
    const end = clip.startTime + (clip.outPoint - clip.inPoint);
    if (end > max) max = end;
  }
  return max;
}
