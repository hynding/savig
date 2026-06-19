import { describe, expect, test } from 'vitest';
import { removeKeyframeAt, snapToFrame, upsertKeyframe } from './keyframes';
import { createKeyframe } from './project';

describe('snapToFrame', () => {
  test('rounds to the nearest frame boundary at 30fps', () => {
    expect(snapToFrame(0.04, 30)).toBeCloseTo(1 / 30, 6); // nearest frame is frame 1
    expect(snapToFrame(0.0, 30)).toBe(0);
  });

  test('returns the input when fps is not positive', () => {
    expect(snapToFrame(0.123, 0)).toBe(0.123);
  });
});

describe('upsertKeyframe', () => {
  test('inserts keeping ascending time order', () => {
    const track = [createKeyframe(0, 0), createKeyframe(2, 20)];
    const result = upsertKeyframe(track, createKeyframe(1, 10));
    expect(result.map((k) => k.time)).toEqual([0, 1, 2]);
  });

  test('replaces an existing keyframe at the same time', () => {
    const track = [createKeyframe(0, 0), createKeyframe(1, 10)];
    const result = upsertKeyframe(track, createKeyframe(1, 999));
    expect(result).toHaveLength(2);
    expect(result[1].value).toBe(999);
  });

  test('does not mutate the input track', () => {
    const track = [createKeyframe(0, 0)];
    upsertKeyframe(track, createKeyframe(1, 1));
    expect(track).toHaveLength(1);
  });
});

describe('removeKeyframeAt', () => {
  test('removes the keyframe at the given time', () => {
    const track = [createKeyframe(0, 0), createKeyframe(1, 10)];
    expect(removeKeyframeAt(track, 1).map((k) => k.time)).toEqual([0]);
  });

  test('returns an equivalent track when nothing matches', () => {
    const track = [createKeyframe(0, 0)];
    expect(removeKeyframeAt(track, 5)).toEqual(track);
  });
});
