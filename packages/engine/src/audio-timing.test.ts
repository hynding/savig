import { describe, expect, test } from 'vitest';
import { resolveActiveClips } from './audio-timing';
import type { AudioClip } from './types';

const clip = (over: Partial<AudioClip>): AudioClip => ({
  id: 'c',
  assetId: 'a',
  startTime: 0,
  inPoint: 0,
  outPoint: 5,
  volume: 1,
  ...over,
});

describe('resolveActiveClips', () => {
  test('returns a clip active at the queried time with the right source offset', () => {
    const clips = [clip({ startTime: 2, inPoint: 1, outPoint: 4 })];
    // active over [2, 5); at time 3 → sourceOffset = 1 + (3 - 2) = 2
    const active = resolveActiveClips(clips, 3);
    expect(active).toHaveLength(1);
    expect(active[0].sourceOffset).toBeCloseTo(2, 6);
  });

  test('excludes clips before their start and at/after their end', () => {
    const clips = [clip({ startTime: 2, inPoint: 0, outPoint: 3 })]; // active [2,5)
    expect(resolveActiveClips(clips, 1)).toHaveLength(0);
    expect(resolveActiveClips(clips, 5)).toHaveLength(0);
    expect(resolveActiveClips(clips, 2)).toHaveLength(1);
  });

  test('returns multiple overlapping clips', () => {
    const clips = [
      clip({ id: 'c1', startTime: 0, outPoint: 10 }),
      clip({ id: 'c2', startTime: 1, outPoint: 10 }),
    ];
    expect(resolveActiveClips(clips, 2).map((a) => a.clip.id)).toEqual(['c1', 'c2']);
  });

  test('a zero-duration clip is never active', () => {
    expect(resolveActiveClips([clip({ startTime: 3, inPoint: 3, outPoint: 3 })], 3)).toEqual(
      [],
    );
  });

  test('an empty clip list returns an empty array', () => {
    expect(resolveActiveClips([], 5)).toEqual([]);
  });
});
