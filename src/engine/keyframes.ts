import type { Keyframe } from './types';

export const EPSILON = 1e-6;

export function snapToFrame(time: number, fps: number): number {
  if (fps <= 0) return time;
  return Math.round(time * fps) / fps;
}

export function upsertKeyframe(track: Keyframe[], keyframe: Keyframe): Keyframe[] {
  // Build a brand-new array (replacing any keyframe within EPSILON of the new
  // time), then sort it ascending — never mutating the caller's track.
  return [
    ...track.filter((k) => Math.abs(k.time - keyframe.time) > EPSILON),
    keyframe,
  ].sort((a, b) => a.time - b.time);
}

export function removeKeyframeAt(track: Keyframe[], time: number): Keyframe[] {
  return track.filter((k) => Math.abs(k.time - time) > EPSILON);
}
