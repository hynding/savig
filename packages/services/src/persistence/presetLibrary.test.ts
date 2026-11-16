import { describe, expect, it } from 'vitest';
import type { MotionPreset } from '@savig/engine';
import { createPresetLibraryStore, parsePresetLibrary, PRESET_LIBRARY_KEY } from './presetLibrary';

const p = (id: string): MotionPreset => ({ id, name: id, category: 'custom', duration: 1, tracks: { x: { mode: 'offset', keys: [{ t: 0, v: 0 }, { t: 1, v: 5 }] } } });

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

describe('preset library storage', () => {
  it('round-trips through storage', () => {
    const s = memory();
    const lib = createPresetLibraryStore(s);
    expect(lib.load()).toEqual([]);
    expect(lib.save([p('a'), p('b')])).toBe(true);
    expect(s.m.has(PRESET_LIBRARY_KEY)).toBe(true);
    expect(createPresetLibraryStore(s).load().map((x) => x.id)).toEqual(['a', 'b']);
  });
  it('drops malformed and duplicate entries; tolerates junk', () => {
    expect(parsePresetLibrary(JSON.stringify({ presets: [p('a'), { id: 'bad' }, p('a')] })).map((x) => x.id)).toEqual(['a']);
    expect(parsePresetLibrary('{oops')).toEqual([]);
    expect(parsePresetLibrary(null)).toEqual([]);
  });
  it('never throws when storage fails or is missing', () => {
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); } };
    const lib = createPresetLibraryStore(broken);
    expect(lib.load()).toEqual([]);
    expect(lib.save([p('a')])).toBe(false);
    expect(createPresetLibraryStore(null).save([p('a')])).toBe(false);
  });
});
