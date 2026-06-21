import { describe, expect, it, test } from 'vitest';
import {
  removeKeyframeAt,
  snapToFrame,
  upsertKeyframe,
  upsertShapeKeyframe,
  removeShapeKeyframeAt,
} from './keyframes';
import { createKeyframe } from './project';
import type { ShapeKeyframe } from './types';

describe('snapToFrame', () => {
  test('rounds to the nearest frame boundary at 30fps', () => {
    expect(snapToFrame(0.04, 30)).toBeCloseTo(1 / 30, 6); // nearest frame is frame 1
    expect(snapToFrame(0.0, 30)).toBe(0);
  });

  test('returns the input when fps is not positive', () => {
    expect(snapToFrame(0.123, 0)).toBe(0.123);
    expect(snapToFrame(0.5, -1)).toBe(0.5);
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

  test('replaces a keyframe within EPSILON of the same time', () => {
    const track = [createKeyframe(1, 10)];
    const result = upsertKeyframe(track, createKeyframe(1 + 5e-7, 999));
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(999);
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

describe('shape keyframe track ops', () => {
  const kf = (time: number, x: number): ShapeKeyframe => ({
    time, easing: 'linear', path: { closed: false, nodes: [{ anchor: { x, y: 0 } }] },
  });

  it('inserts in ascending time order without mutating the input', () => {
    const track = [kf(0, 0), kf(2, 2)];
    const next = upsertShapeKeyframe(track, kf(1, 1));
    expect(next.map((k) => k.time)).toEqual([0, 1, 2]);
    expect(track).toHaveLength(2);
  });

  it('replaces a keyframe within EPSILON of the same time', () => {
    const next = upsertShapeKeyframe([kf(1, 1)], kf(1, 9));
    expect(next).toHaveLength(1);
    expect(next[0].path.nodes[0].anchor.x).toBe(9);
  });

  it('removes the keyframe at a time', () => {
    expect(removeShapeKeyframeAt([kf(0, 0), kf(1, 1)], 1).map((k) => k.time)).toEqual([0]);
  });
});
