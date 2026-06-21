import type { SceneObject } from './types';

const EPS = 1e-6;

/** Sorted, de-duped union of every keyframe time on the object (all track sources). */
export function objectKeyframeTimes(obj: SceneObject): number[] {
  const times: number[] = [];
  for (const track of Object.values(obj.tracks)) {
    for (const k of track ?? []) times.push(k.time);
  }
  for (const k of obj.shapeTrack ?? []) times.push(k.time);
  for (const track of Object.values(obj.colorTracks ?? {})) {
    for (const k of track ?? []) times.push(k.time);
  }
  for (const track of Object.values(obj.gradientTracks ?? {})) {
    for (const k of track ?? []) times.push(k.time);
  }
  for (const k of obj.dashOffsetTrack ?? []) times.push(k.time);
  for (const k of obj.motionPath?.progress ?? []) times.push(k.time);
  times.sort((a, b) => a - b);
  const out: number[] = [];
  for (const t of times) {
    if (out.length === 0 || Math.abs(t - out[out.length - 1]) > EPS) out.push(t);
  }
  return out;
}

/** The `count` times immediately before and after the playhead, nearest first,
 *  excluding any within `eps` of the playhead (the live frame). */
export function onionSkinTimes(
  times: number[],
  playhead: number,
  count: number,
  eps = EPS,
): { before: number[]; after: number[] } {
  const before = times
    .filter((t) => t < playhead - eps)
    .sort((a, b) => b - a)
    .slice(0, count);
  const after = times
    .filter((t) => t > playhead + eps)
    .sort((a, b) => a - b)
    .slice(0, count);
  return { before, after };
}
