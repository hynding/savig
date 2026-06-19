import { applyEasing } from './easing';
import type { Keyframe } from './types';

function shortestAngleTarget(from: number, to: number): number {
  const delta = ((((to - from) % 360) + 540) % 360) - 180;
  return from + delta;
}

export function interpolate(track: Keyframe[], time: number): number {
  if (track.length === 0) {
    throw new Error('interpolate: track must contain at least one keyframe');
  }

  const first = track[0];
  const last = track[track.length - 1];
  if (time <= first.time) return first.value;
  if (time >= last.time) return last.value;

  let a = first;
  let b = last;
  for (let i = 0; i < track.length - 1; i++) {
    if (time >= track[i].time && time < track[i + 1].time) {
      a = track[i];
      b = track[i + 1];
      break;
    }
  }

  const span = b.time - a.time;
  const rawProgress = span === 0 ? 0 : (time - a.time) / span;
  const progress = applyEasing(a.easing, rawProgress);

  const target =
    a.rotationMode === 'shortest' ? shortestAngleTarget(a.value, b.value) : b.value;

  return a.value + (target - a.value) * progress;
}
