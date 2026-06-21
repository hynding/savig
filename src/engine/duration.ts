import type { Project } from './types';

export function computeProjectDuration(project: Project): number {
  if (project.meta.durationMode === 'manual') {
    return project.meta.duration;
  }

  let max = 0;
  for (const obj of project.objects) {
    for (const track of Object.values(obj.tracks)) {
      if (!track) continue;
      for (const keyframe of track) {
        if (keyframe.time > max) max = keyframe.time;
      }
    }
    for (const keyframe of obj.shapeTrack ?? []) {
      if (keyframe.time > max) max = keyframe.time;
    }
    for (const track of Object.values(obj.colorTracks ?? {})) {
      for (const keyframe of track ?? []) {
        if (keyframe.time > max) max = keyframe.time;
      }
    }
    for (const track of Object.values(obj.gradientTracks ?? {})) {
      for (const keyframe of track ?? []) {
        if (keyframe.time > max) max = keyframe.time;
      }
    }
    for (const keyframe of obj.motionPath?.progress ?? []) {
      if (keyframe.time > max) max = keyframe.time;
    }
  }
  for (const clip of project.audioClips) {
    const end = clip.startTime + (clip.outPoint - clip.inPoint);
    if (end > max) max = end;
  }
  return max;
}
