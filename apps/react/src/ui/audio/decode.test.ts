// jsdom has no OfflineAudioContext, so every decode here settles to null — which is exactly
// what makes the CACHE the observable surface: getPeaks returns the same in-flight promise for
// a cached key and a fresh one after eviction. Unique asset ids per test keep the module-level
// cache from coupling tests together.
import { describe, expect, it } from 'vitest';
import { getPeaks, PEAKS_CACHE_MAX } from './decode';

const bytes = new Uint8Array([1, 2, 3]);

describe('getPeaks cache', () => {
  it('returns the identical promise for a repeated assetId:bins key', () => {
    const first = getPeaks('cache-hit', bytes, 128);
    expect(getPeaks('cache-hit', bytes, 128)).toBe(first);
  });

  it('keys by bins too — a different bin count is a distinct entry', () => {
    expect(getPeaks('bins-key', bytes, 128)).not.toBe(getPeaks('bins-key', bytes, 64));
  });

  it('is bounded: filling past the cap evicts the least-recently-used entry', () => {
    const first = getPeaks('evict-0', bytes, 128);
    for (let i = 1; i <= PEAKS_CACHE_MAX; i++) getPeaks(`evict-${i}`, bytes, 128);
    // evict-0 was the oldest of cap+1 inserts — it must be gone (a fresh promise comes back).
    expect(getPeaks('evict-0', bytes, 128)).not.toBe(first);
  });

  it('a cache hit refreshes recency, so a re-read entry survives the next eviction', () => {
    const kept = getPeaks('lru-keep', bytes, 128);
    for (let i = 0; i < PEAKS_CACHE_MAX - 1; i++) getPeaks(`lru-fill-${i}`, bytes, 128);
    expect(getPeaks('lru-keep', bytes, 128)).toBe(kept); // touch → most recent
    getPeaks('lru-overflow', bytes, 128); // evicts the true oldest, not the touched entry
    expect(getPeaks('lru-keep', bytes, 128)).toBe(kept);
  });
});
