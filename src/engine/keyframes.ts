import type { ColorKeyframe, Keyframe, ShapeKeyframe } from './types';

// Internal float-comparison tolerance for the continuous-seconds model.
const EPSILON = 1e-6;

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

export function upsertShapeKeyframe(
  track: ShapeKeyframe[],
  keyframe: ShapeKeyframe,
): ShapeKeyframe[] {
  return [
    ...track.filter((k) => Math.abs(k.time - keyframe.time) > EPSILON),
    keyframe,
  ].sort((a, b) => a.time - b.time);
}

export function removeShapeKeyframeAt(track: ShapeKeyframe[], time: number): ShapeKeyframe[] {
  return track.filter((k) => Math.abs(k.time - time) > EPSILON);
}

export function upsertColorKeyframe(track: ColorKeyframe[], keyframe: ColorKeyframe): ColorKeyframe[] {
  return [
    ...track.filter((k) => Math.abs(k.time - keyframe.time) > EPSILON),
    keyframe,
  ].sort((a, b) => a.time - b.time);
}

export function removeColorKeyframeAt(track: ColorKeyframe[], time: number): ColorKeyframe[] {
  return track.filter((k) => Math.abs(k.time - time) > EPSILON);
}
