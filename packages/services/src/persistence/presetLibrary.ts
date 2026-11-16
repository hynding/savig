// Personal preset library (spec 2026-11-16-preset-library): the user's own motion presets, kept in
// this browser's localStorage so they show up in every project. Like autosave it must never break
// the editor: storage that is missing, full or blocked degrades to an empty / unsaved library.
import { isMotionPreset, type MotionPreset } from '@savig/engine';

export const PRESET_LIBRARY_KEY = 'savig-preset-library';

export interface PresetLibraryStore {
  load(): MotionPreset[];
  /** False when the browser refused the write (e.g. storage full or disabled). */
  save(presets: readonly MotionPreset[]): boolean;
}

/** Well-formed presets from stored JSON, first of each id kept. */
export function parsePresetLibrary(text: string | null): MotionPreset[] {
  if (!text) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { presets?: unknown }).presets) ? (raw as { presets: unknown[] }).presets : [];
  const seen = new Set<string>();
  const out: MotionPreset[] = [];
  for (const p of list) {
    if (!isMotionPreset(p) || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

export function createPresetLibraryStore(storage: Pick<Storage, 'getItem' | 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): PresetLibraryStore {
  return {
    load() {
      try {
        return parsePresetLibrary(storage?.getItem(PRESET_LIBRARY_KEY) ?? null);
      } catch {
        return [];
      }
    },
    save(presets) {
      try {
        if (!storage) return false;
        storage.setItem(PRESET_LIBRARY_KEY, JSON.stringify({ version: 1, presets }));
        return true;
      } catch {
        return false;
      }
    },
  };
}
