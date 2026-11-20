import { describe, expect, test } from 'vitest';
import { frameLoudness, lipSyncPoseTimes, lipSyncPoses, lipSyncTrack } from './lipSync';
import { createGroupObject, createSymbolAsset } from './project';
import type { SceneObject } from './types';

describe('lip sync', () => {
  test('frameLoudness is per-frame RMS over the window, with gain and clamping', () => {
    const sr = 100;
    const s = new Float32Array(200);
    for (let i = 100; i < 150; i++) s[i] = 0.5; // second 1, first half loud
    const lv = frameLoudness(s, sr, 2); // 2 fps -> 4 frames of 0.5 s
    expect(lv).toHaveLength(4);
    expect(lv[0]).toBe(0);
    expect(lv[2]).toBeCloseTo(0.5, 6);
    expect(lv[3]).toBe(0);
    expect(frameLoudness(s, sr, 2, 1, 1.5)).toEqual([0.5]);
    expect(frameLoudness(s, sr, 2, 1, 1.5, 4)).toEqual([1]);
    expect(frameLoudness(s, sr, 2, 3)).toEqual([]);
    expect(frameLoudness(s, 0, 2)).toEqual([]);
  });

  test('pose times come from a frame layer, else the symbol frames', () => {
    const layer: SceneObject = { ...createGroupObject({ id: 'm', anchorX: 0, anchorY: 0, zOrder: 0 }), frames: { keys: [{ id: 'b', time: 0.5 }, { id: 'a', time: 0 }, { id: 'c', time: 1 }], end: 1.5 } };
    expect(lipSyncPoseTimes(createSymbolAsset({ id: 's', name: 'S', objects: [layer], width: 1, height: 1 }), 24)).toEqual([0, 0.5, 1]);
    const plain = { ...createSymbolAsset({ id: 's', name: 'S', objects: [], width: 1, height: 1 }), duration: 2 / 12 };
    expect(lipSyncPoseTimes(plain, 12)).toEqual([0, 1 / 12, 2 / 12]);
    expect(lipSyncPoseTimes(createSymbolAsset({ id: 's', name: 'S', objects: [], width: 1, height: 1 }), 12)).toEqual([0]);
  });

  test('lipSyncPoses: silence rests, louder opens wider, short blips are held over', () => {
    const levels = [0, 0, 0.2, 0.2, 1, 1, 1, 0.6, 0.6, 0, 0, 1, 0, 0];
    const poses = lipSyncPoses(levels, 4, { sensitivity: 0.5, minHold: 2 });
    expect(poses.slice(0, 2)).toEqual([0, 0]);
    expect(poses[4]).toBe(3);
    expect(poses[7]).toBeGreaterThan(0);
    expect(poses[7]).toBeLessThan(3);
    expect(poses[11]).toBe(0); // one-frame blip held as the previous (rest) pose
    expect(lipSyncPoses(levels, 1)).toEqual(levels.map(() => 0));
    expect(lipSyncPoses([0, 0], 3)).toEqual([0, 0]);
    expect(lipSyncPoses([], 3)).toEqual([]);
    // Higher sensitivity opens on quieter sound.
    const quiet = [0, 0.1, 0.1, 0.1, 1, 1];
    expect(lipSyncPoses(quiet, 3, { sensitivity: 1 })[2]).toBeGreaterThan(0);
    expect(lipSyncPoses(quiet, 3, { sensitivity: 0 })[2]).toBe(0);
  });

  test('lipSyncTrack steps between pose times and rests before and after the clip', () => {
    const k = lipSyncTrack([1, 1, 2, 0], [0, 0.5, 1], 1, 10);
    const sample = (t: number) => {
      let v = k[0].value;
      for (let i = 0; i < k.length; i++) {
        if (k[i].time <= t + 1e-9) v = k[i].value;
        else {
          const a = k[i - 1];
          if (a) v = a.value + ((k[i].value - a.value) * (t - a.time)) / (k[i].time - a.time);
          break;
        }
      }
      return v;
    };
    expect(sample(0)).toBe(0);
    expect(sample(0.5)).toBe(0);
    expect(sample(1)).toBe(0.5);
    expect(sample(1.1)).toBe(0.5);
    expect(sample(1.2)).toBe(1);
    expect(sample(1.3)).toBe(0);
    expect(sample(2)).toBe(0);
    for (let i = 1; i < k.length; i++) expect(k[i].time).toBeGreaterThan(k[i - 1].time);
    expect(lipSyncTrack([], [0], 0, 24)).toEqual([]);
  });
});
