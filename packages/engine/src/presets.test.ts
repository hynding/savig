import { describe, expect, it } from 'vitest';
import { applyMotionPreset, BUILTIN_MOTION_PRESETS, findMotionPreset, PRESET_PROPERTIES } from './presets';
import { createSceneObject } from './project';
import { sampleObject } from './sample';
import type { SceneObject } from './types';

const obj = (extra: Partial<SceneObject> = {}): SceneObject =>
  createSceneObject('a', { id: 'o', base: { x: 100, y: 50, scaleX: 2, scaleY: 2, rotation: 30, opacity: 0.8 }, ...extra });
const at = (o: SceneObject, tracks: SceneObject['tracks'], t: number) => sampleObject({ ...o, tracks }, t);

describe('motion presets', () => {
  it('the library is well-formed: unique ids, keys on 0..1 in order, only transform props', () => {
    const ids = BUILTIN_MOTION_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of BUILTIN_MOTION_PRESETS) {
      expect(p.duration).toBeGreaterThan(0);
      for (const [prop, tr] of Object.entries(p.tracks)) {
        expect(PRESET_PROPERTIES).toContain(prop);
        const ts = tr!.keys.map((k) => k.t);
        expect(ts).toEqual([...ts].sort((a, b) => a - b));
        expect(Math.min(...ts)).toBeGreaterThanOrEqual(0);
        expect(Math.max(...ts)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('entrances end on the object own pose; exits start from it; emphasis starts and ends on it', () => {
    const o = obj();
    const pose = sampleObject(o, 0);
    for (const p of BUILTIN_MOTION_PRESETS) {
      const tracks = applyMotionPreset(o, p, { start: 1, fps: 30 });
      const end = 1 + Math.round(p.duration * 30) / 30;
      const check = (t: number) => {
        const s = at(o, tracks, t);
        for (const prop of Object.keys(p.tracks) as (keyof typeof pose)[]) expect(s[prop], `${p.id} ${String(prop)} @${t}`).toBeCloseTo(pose[prop] as number, 6);
      };
      if (p.category === 'entrance') check(end);
      if (p.category === 'exit') check(1);
      if (p.category === 'emphasis') {
        check(1);
        if (p.id !== 'spin') check(end); // spin ends a full turn on (rotation + 360)
      }
    }
  });

  it('values are relative: slide-in-left starts 200px left of where the object is', () => {
    const o = obj();
    const tracks = applyMotionPreset(o, findMotionPreset('slide-in-left')!, { start: 0, fps: 30 });
    expect(at(o, tracks, 0).x).toBeCloseTo(-100, 6);
    expect(at(o, tracks, 0).opacity).toBeCloseTo(0, 6);
    expect(at(o, tracks, 0.6).x).toBeCloseTo(100, 6);
    expect(at(o, tracks, 0.6).opacity).toBeCloseTo(0.8, 6);
  });

  it('replaces keys inside its window, keeps those outside, honours duration and frame snapping', () => {
    const o = obj({
      tracks: {
        x: [
          { time: 0, value: 0, easing: 'linear' },
          { time: 1.2, value: 50, easing: 'linear' },
          { time: 3, value: 300, easing: 'linear' },
        ],
      },
    });
    const tracks = applyMotionPreset(o, findMotionPreset('shake')!, { start: 1.01, duration: 1, fps: 10 });
    const times = tracks.x!.map((k) => k.time);
    expect(times[0]).toBe(0);
    // The old key at 1.2 (x 50) gave way: the preset's own key there is relative to x at the start.
    expect(tracks.x!.find((k) => Math.abs(k.time - 1.2) < 1e-9)!.value).toBeCloseTo(50 / 1.2 - 12, 6);
    expect(times.at(-1)).toBe(3);
    expect(times).toContain(1);
    expect(times).toContain(2);
    expect(times.every((t) => Math.abs(t * 10 - Math.round(t * 10)) < 1e-9)).toBe(true);
  });

  it('spin turns a full 360° (raw rotation keys)', () => {
    const o = obj();
    const tracks = applyMotionPreset(o, findMotionPreset('spin')!, { start: 0, fps: 30 });
    expect(tracks.rotation!.every((k) => k.rotationMode === 'raw')).toBe(true);
    expect(at(o, tracks, 0.5).rotation).toBeCloseTo(30 + 180, 0);
  });
});
