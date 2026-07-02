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

/** Seconds the transition INTO `scene` overlaps `prevScene`'s tail. `cut`/absent ⇒ 0. Clamped so a
 *  transition never consumes more than the shorter adjacent scene. */
export function transitionOverlap(scene: Scene, prevScene: Scene): number {
  const t = scene.transitionIn;
  if (!t || t.kind === 'cut') return 0;
  return Math.max(0, Math.min(t.duration, prevScene.duration, scene.duration));
}

/** Cumulative scene layout on the master timeline. Cut-only: `start[i] = Σ duration[0..i-1]`.
 *  Transition overlaps pull the incoming scene's start back over the previous scene's tail. */
export function resolveTimeline(project: Project): SceneSpan[] {
  const scenes = projectScenes(project);
  const spans: SceneSpan[] = [];
  let cursor = 0;
  scenes.forEach((scene, index) => {
    const overlap = index > 0 ? transitionOverlap(scene, scenes[index - 1]) : 0;
    const start = cursor - overlap;            // pull the incoming scene back over the prev tail
    const end = start + scene.duration;
    spans.push({ scene, index, start, end });
    cursor = end;
  });
  return spans;
}

/** Inverse of promoteToMultiScene: when EXACTLY ONE scene remains, fold it back to the root
 *  (objects/camera restored, `scenes` removed) so the project returns to byte-parity single-scene
 *  form. No-op for 0/2+ scenes or an already single-scene project. */
export function demoteToSingleScene(project: Project): Project {
  if (!project.scenes || project.scenes.length !== 1) return project;
  const only = project.scenes[0];
  const next: Project = { ...project, objects: only.objects, camera: only.camera };
  delete (next as { scenes?: Scene[] }).scenes;
  return next;
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

/** The scene(s) on screen at master time `t`. Primary = the LAST span whose start ≤ t (the
 *  INCOMING scene wins mid-overlap), clamped to the last span when `t` is past the end.
 *  For cut-only (contiguous spans, overlap 0) this equals the old "first span with t < end" rule
 *  at every point including boundaries (boundary belongs to the next scene). `t` past the end pins
 *  to the last scene's final frame (matches single-scene clamp). */
export function sceneAtTime(project: Project, t: number): SceneSample {
  const spans = resolveTimeline(project);
  if (spans.length === 0) {
    // Invalid state (validateProject flags `empty-scenes`); degrade to an empty scene so callers
    // (8b-1b computeFrame) fail soft instead of throwing.
    return { primary: { scene: { id: ROOT_SCENE_ID, name: 'Scene 1', objects: [], duration: 0 }, localTime: 0 } };
  }
  // Primary = the LAST span whose start <= t (incoming scene wins mid-overlap).
  let pi = 0;
  for (let i = 0; i < spans.length; i++) {
    if (spans[i].start <= t) pi = i;
    else break;
  }
  const primarySpan = spans[pi];
  const localTime = Math.min(Math.max(0, t - primarySpan.start), primarySpan.scene.duration);
  const sample: SceneSample = { primary: { scene: primarySpan.scene, localTime } };
  // Mid-transition? The overlap window for the incoming scene is [start, start + overlap).
  if (pi > 0) {
    const overlap = transitionOverlap(primarySpan.scene, spans[pi - 1].scene);
    if (overlap > 0 && t < primarySpan.start + overlap) {
      const prev = spans[pi - 1];
      sample.outgoing = {
        scene: prev.scene,
        localTime: Math.min(Math.max(0, t - prev.start), prev.scene.duration),
        progress: (t - primarySpan.start) / overlap, // 0 at overlap start → 1 at overlap end
      };
    }
  }
  return sample;
}

/** Master-timeline length of a multi-scene project: `max(last span end, Σ audioClip ends)`.
 *  Overlaps are already folded into cumulative starts via resolveTimeline. Audio lives on the
 *  master timeline (per-scene audio is deferred), so a clip tail past the last scene extends it. */
export function computeProjectDurationMulti(project: Project): number {
  const spans = resolveTimeline(project);
  let max = spans.length ? spans[spans.length - 1].end : 0;
  for (const clip of project.audioClips) {
    const end = clip.startTime + (clip.outPoint - clip.inPoint);
    if (end > max) max = end;
  }
  return max;
}
