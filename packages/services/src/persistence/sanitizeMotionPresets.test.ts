import { describe, expect, it } from 'vitest';
import { createProject } from '@savig/engine';
import { sanitizeMotionPresets } from './sanitizeMotionPresets';
import { migrateProject } from './migrate';

const good = { id: 'custom-a', name: 'A', category: 'custom', duration: 1, tracks: { x: { mode: 'offset', keys: [{ t: 0, v: 0 }, { t: 1, v: 10 }] } } };

describe('sanitizeMotionPresets', () => {
  it('keeps well-formed presets, drops malformed and duplicate ones', () => {
    const p = { ...createProject(), motionPresets: [good, { id: 'bad' }, { ...good, name: 'dup' }, 'junk'] } as never;
    expect(sanitizeMotionPresets(p).motionPresets).toEqual([good]);
  });
  it('removes an empty or non-array field and leaves projects without it untouched', () => {
    const base = createProject();
    expect(sanitizeMotionPresets(base)).toBe(base);
    expect('motionPresets' in sanitizeMotionPresets({ ...base, motionPresets: 'x' } as never)).toBe(false);
    expect('motionPresets' in sanitizeMotionPresets({ ...base, motionPresets: [] })).toBe(false);
  });
  it('runs on load', () => {
    const p = { ...createProject(), motionPresets: [good, { id: 'bad' }] };
    expect(migrateProject(JSON.parse(JSON.stringify(p))).motionPresets).toEqual([good]);
  });
});
