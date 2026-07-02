import type { AudioClip } from './types';

export interface ActiveClip {
  clip: AudioClip;
  /** Seconds into the source audio asset to play at the queried timeline time. */
  sourceOffset: number;
}

export function resolveActiveClips(clips: AudioClip[], time: number): ActiveClip[] {
  const active: ActiveClip[] = [];
  for (const clip of clips) {
    const clipDuration = clip.outPoint - clip.inPoint;
    const end = clip.startTime + clipDuration;
    if (time >= clip.startTime && time < end) {
      active.push({ clip, sourceOffset: clip.inPoint + (time - clip.startTime) });
    }
  }
  return active;
}
