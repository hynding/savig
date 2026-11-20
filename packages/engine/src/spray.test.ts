import { describe, expect, test } from 'vitest';
import { SPRAY_MAX_PARTICLES, normalizeSpraySettings, sprayParticles, sprayRandom } from './spray';

const base = { radius: 10, density: 4, scaleMin: 0.5, scaleMax: 1.5, rotation: 90, seed: 7 };

describe('spray', () => {
  test('sprayRandom is deterministic per seed and in [0, 1)', () => {
    const a = sprayRandom(3);
    const b = sprayRandom(3);
    const xs = Array.from({ length: 50 }, () => a());
    expect(xs).toEqual(Array.from({ length: 50 }, () => b()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(sprayRandom(4)()).not.toBe(xs[0]);
  });

  test('a click sprays one burst inside the disc with ranged scale/rotation', () => {
    const ps = sprayParticles([{ x: 100, y: 50 }], base);
    expect(ps).toHaveLength(4);
    for (const p of ps) {
      expect(Math.hypot(p.x - 100, p.y - 50)).toBeLessThanOrEqual(10);
      expect(p.scale).toBeGreaterThanOrEqual(0.5);
      expect(p.scale).toBeLessThanOrEqual(1.5);
      expect(Math.abs(p.rotation)).toBeLessThanOrEqual(45);
    }
  });

  test('a stroke adds a burst per radius of travel, carried across segments', () => {
    // 35px of travel in two segments -> bursts at 0, 10, 20, 30.
    const ps = sprayParticles([{ x: 0, y: 0 }, { x: 15, y: 0 }, { x: 35, y: 0 }], base);
    expect(ps).toHaveLength(16);
    expect(sprayParticles([{ x: 0, y: 0 }, { x: 15, y: 0 }, { x: 35, y: 0 }], base)).toEqual(ps);
    expect(sprayParticles([{ x: 0, y: 0 }, { x: 35, y: 0 }], base)).toHaveLength(16);
  });

  test('rotation 0 keeps particles upright; caps and empty input', () => {
    expect(sprayParticles([{ x: 0, y: 0 }], { ...base, rotation: 0 }).every((p) => p.rotation === 0)).toBe(true);
    expect(sprayParticles([], base)).toEqual([]);
    const long = sprayParticles([{ x: 0, y: 0 }, { x: 100000, y: 0 }], { ...base, density: 50 });
    expect(long).toHaveLength(SPRAY_MAX_PARTICLES);
  });

  test('normalizeSpraySettings clamps and swaps', () => {
    expect(normalizeSpraySettings({ radius: -5, density: 999, scaleMin: 2, scaleMax: 0.5, rotation: 720, seed: NaN })).toEqual({
      radius: 1, density: 50, scaleMin: 0.5, scaleMax: 2, rotation: 360, seed: 1,
    });
  });
});
