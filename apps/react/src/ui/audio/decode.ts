import { computePeaks } from '@savig/services';

/** Gesture-free decode: OfflineAudioContext.decodeAudioData works before any user gesture
 *  (the PLAYBACK context is created lazily on Play — never reuse it here). */
export async function decodeAudioBuffer(bytes: Uint8Array): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(1, 1, 44100);
  return ctx.decodeAudioData(bytes.slice().buffer as ArrayBuffer);
}

export async function decodeAudioDuration(bytes: Uint8Array): Promise<number | undefined> {
  try {
    return (await decodeAudioBuffer(bytes)).duration;
  } catch {
    return undefined; // undecodable → asset lands without duration (legacy behavior)
  }
}

// Assets are content-addressed (see importAudio) so this cache — keyed by assetId:bins — never
// goes stale: the same assetId always maps to the same bytes.
const peaksCache = new Map<string, Promise<{ peaks: Float32Array; duration: number } | null>>();
export function getPeaks(
  assetId: string,
  bytes: Uint8Array,
  bins: number,
): Promise<{ peaks: Float32Array; duration: number } | null> {
  const key = `${assetId}:${bins}`;
  let hit = peaksCache.get(key);
  if (!hit) {
    hit = decodeAudioBuffer(bytes)
      .then((buf) => ({ peaks: computePeaks(buf.getChannelData(0), bins), duration: buf.duration }))
      .catch(() => null);
    peaksCache.set(key, hit);
  }
  return hit;
}
