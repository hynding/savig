import type { Project, SceneObject } from './types';

/** The latest keyframe time across an objects[] list (transform/shape/color/gradient/dash/motion).
 *  Shared by computeProjectDuration (root) and the symbol intrinsic-duration lookup (slice 47c). */
export function objectsMaxKeyframeTime(objects: SceneObject[]): number {
  let max = 0;
  for (const obj of objects) {
    for (const track of Object.values(obj.tracks)) {
      if (!track) continue;
      for (const keyframe of track) if (keyframe.time > max) max = keyframe.time;
    }
    for (const keyframe of obj.shapeTrack ?? []) if (keyframe.time > max) max = keyframe.time;
    for (const track of Object.values(obj.colorTracks ?? {})) {
      for (const keyframe of track ?? []) if (keyframe.time > max) max = keyframe.time;
    }
    for (const track of Object.values(obj.gradientTracks ?? {})) {
      for (const keyframe of track ?? []) if (keyframe.time > max) max = keyframe.time;
    }
    for (const keyframe of obj.dashOffsetTrack ?? []) if (keyframe.time > max) max = keyframe.time;
    for (const keyframe of obj.motionPath?.progress ?? []) if (keyframe.time > max) max = keyframe.time;
  }
  return max;
}

export function computeProjectDuration(project: Project): number {
  if (project.meta.durationMode === 'manual') {
    return project.meta.duration;
  }
  let max = objectsMaxKeyframeTime(project.objects);
  for (const clip of project.audioClips) {
    const end = clip.startTime + (clip.outPoint - clip.inPoint);
    if (end > max) max = end;
  }
  return max;
}
