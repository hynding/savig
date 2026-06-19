import type { Keyframe } from './types';

export const EPSILON = 1e-6;

export function snapToFrame(time: number, fps: number): number {
  if (fps <= 0) return time;
  return Math.round(time * fps) / fps;
}

export function upsertKeyframe(track: Keyframe[], keyframe: Keyframe): Keyframe[] {
  const withoutSameTime = track.filter(
    (k) => Math.abs(k.time - keyframe.time) > EPSILON,
  );
  withoutSameTime.push(keyframe);
  withoutSameTime.sort((a, b) => a.time - b.time);
  return withoutSameTime;
}

export function removeKeyframeAt(track: Keyframe[], time: number): Keyframe[] {
  return track.filter((k) => Math.abs(k.time - time) > EPSILON);
}
