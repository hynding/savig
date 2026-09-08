/** ONE owner of multitrack mix math (the trim.ts pattern). The services audioEngine, the editor
 *  transport, and the export runtime all consume these outputs; loudness is computed nowhere else.
 *  Effective loudness = clip.volume × clipFadeGainAt × track.gain × audible. */
import type { AudioClip, AudioFilter, AudioTrack } from './types';

export interface TrackState {
  audible: boolean;
  gain: number;
  pan: number;
  filter?: AudioFilter;
}

const DEFAULT_STATE: TrackState = { audible: true, gain: 1, pan: 0 };

export function resolveTrackState(
  tracks: AudioTrack[] | undefined,
  trackId: string | undefined,
): TrackState {
  const anySolo = (tracks ?? []).some((t) => t.solo);
  const track = trackId ? tracks?.find((t) => t.id === trackId) : undefined;
  if (!track) return anySolo ? { ...DEFAULT_STATE, audible: false } : DEFAULT_STATE;
  const audible = !track.muted && (!anySolo || track.solo);
  return {
    audible,
    gain: track.gain,
    pan: track.pan ?? 0,
    ...(track.filter ? { filter: track.filter } : {}),
  };
}

/** Linear fade multiplier at a timeline time: 0 outside [start, end), min(in-ramp, out-ramp)
 *  inside — each fade clamped to the clip length so overlapping fades on short clips compose. */
export function clipFadeGainAt(clip: AudioClip, timelineTime: number): number {
  const len = clip.outPoint - clip.inPoint;
  const end = clip.startTime + len;
  if (timelineTime < clip.startTime || timelineTime >= end || len <= 0) return 0;
  const fadeIn = Math.min(clip.fadeIn ?? 0, len);
  const fadeOut = Math.min(clip.fadeOut ?? 0, len);
  const inRamp = fadeIn > 0 ? Math.min(1, (timelineTime - clip.startTime) / fadeIn) : 1;
  const outRamp = fadeOut > 0 ? Math.min(1, (end - timelineTime) / fadeOut) : 1;
  return Math.min(inRamp, outRamp);
}

/** Piecewise-linear fade envelope from max(clip.startTime, fromTime) to clip end, as
 *  {timeline second, fade gain} breakpoints. Consumers map these 1:1 onto WebAudio
 *  setValueAtTime + linearRampToValueAtTime. Volume is NOT folded in. [] if already finished. */
export function fadeEnvelopePoints(
  clip: AudioClip,
  fromTime: number,
): Array<{ t: number; gain: number }> {
  const len = clip.outPoint - clip.inPoint;
  const end = clip.startTime + len;
  const start = Math.max(clip.startTime, fromTime);
  if (end <= start || len <= 0) return [];
  const fadeIn = Math.min(clip.fadeIn ?? 0, len);
  const fadeOut = Math.min(clip.fadeOut ?? 0, len);
  // clipFadeGainAt is 0 at the EXCLUSIVE end; the envelope's end value must instead be the
  // limit from the left: 0 when fading out, else the value just inside the window.
  const gainAt = (t: number): number => {
    if (t < end) return clipFadeGainAt(clip, t);
    return fadeOut > 0 ? 0 : clipFadeGainAt(clip, Math.max(start, end - Math.min(1e-9, len)));
  };
  const breakpoints = [start, clip.startTime + fadeIn, end - fadeOut, end]
    .filter((t, i, a) => t >= start && t <= end && a.indexOf(t) === i)
    .sort((a, b) => a - b);
  return breakpoints.map((t) => ({ t, gain: gainAt(t) }));
}
