import { describe, it, expect } from 'vitest';
import { objectKeyframeTimes, onionSkinTimes } from './onionSkin';
import { createSceneObject } from './project';

describe('objectKeyframeTimes', () => {
  it('unions + de-dupes + sorts across all track sources', () => {
    const obj = createSceneObject('a', {
      tracks: { x: [{ time: 0, value: 0, easing: 'linear' }, { time: 2, value: 1, easing: 'linear' }] },
      shapeTrack: [{ time: 2, easing: 'linear', path: { nodes: [], closed: false } }],
      colorTracks: { fill: [{ time: 1, value: '#000000', easing: 'linear' }] },
      gradientTracks: {
        stroke: [{ time: 3, gradient: { type: 'linear', x1: 0, y1: 0, x2: 1, y2: 0, stops: [] }, easing: 'linear' }],
      },
      dashOffsetTrack: [{ time: 0, value: 1, easing: 'linear' }],
      motionPath: {
        path: { nodes: [{ anchor: { x: 0, y: 0 } }], closed: false },
        orient: false,
        progress: [{ time: 4, value: 0, easing: 'linear' }],
      },
    });
    expect(objectKeyframeTimes(obj)).toEqual([0, 1, 2, 3, 4]);
  });

  it('returns [] for a static object', () => {
    expect(objectKeyframeTimes(createSceneObject('a', {}))).toEqual([]);
  });
});

describe('onionSkinTimes', () => {
  const times = [0, 1, 2, 3, 4];
  it('picks count before + after the playhead, nearest first, excluding the on-playhead frame', () => {
    expect(onionSkinTimes(times, 2, 2)).toEqual({ before: [1, 0], after: [3, 4] });
  });
  it('excludes a keyframe within eps of the playhead (the live frame)', () => {
    expect(onionSkinTimes(times, 2.0000001, 2)).toEqual({ before: [1, 0], after: [3, 4] });
  });
  it('returns fewer than count near the ends', () => {
    expect(onionSkinTimes(times, 0.5, 2)).toEqual({ before: [0], after: [1, 2] });
  });
});
