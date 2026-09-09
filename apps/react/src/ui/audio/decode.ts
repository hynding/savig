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
// goes stale: the same assetId always maps to the same bytes. LRU-bounded so a long session
// importing many audio files can't grow it without limit (Map iteration order = insertion
// order, and a hit re-inserts its key, so the first key is always the least recently used).
export const PEAKS_CACHE_MAX = 64;
const peaksCache = new Map<string, Promise<{ peaks: Float32Array; duration: number } | null>>();
export function getPeaks(
  assetId: string,
  bytes: Uint8Array,
  bins: number,
): Promise<{ peaks: Float32Array; duration: number } | null> {
  const key = `${assetId}:${bins}`;
  const cached = peaksCache.get(key);
  if (cached) {
    peaksCache.delete(key);
    peaksCache.set(key, cached); // refresh recency
    return cached;
  }
  const hit = decodeAudioBuffer(bytes)
    .then((buf) => ({ peaks: computePeaks(buf.getChannelData(0), bins), duration: buf.duration }))
    .catch(() => null);
  peaksCache.set(key, hit);
  if (peaksCache.size > PEAKS_CACHE_MAX) {
    peaksCache.delete(peaksCache.keys().next().value!);
  }
  return hit;
}
