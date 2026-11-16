import { useEffect } from 'react';
import { createPresetLibraryStore, PRESET_LIBRARY_KEY } from '@savig/services';
import type { PresetLibraryStore } from '@savig/services';
import { useEditor } from '../store/store';

/** Personal preset library (spec 2026-11-16-preset-library): loads the user's motion presets from
 *  browser storage on mount, saves them whenever they change, and picks up changes another tab
 *  makes, so a preset saved anywhere shows up in every project. */
export function usePresetLibrary(store?: PresetLibraryStore): void {
  useEffect(() => {
    const lib = store ?? createPresetLibraryStore();
    let loading = false; // a load from storage is already stored: don't write it back
    const load = () => {
      loading = true;
      useEditor.getState().setPresetLibrary(lib.load());
      loading = false;
      last = useEditor.getState().presetLibrary;
    };
    let last = useEditor.getState().presetLibrary;
    load();
    const unsub = useEditor.subscribe((s) => {
      if (s.presetLibrary === last || loading) return;
      last = s.presetLibrary;
      if (!lib.save(last)) useEditor.getState().pushToast('error', 'Could not save your preset library in this browser (storage is full or blocked).');
    });
    const onStorage = (e: StorageEvent) => {
      if (e.key !== PRESET_LIBRARY_KEY) return;
      load();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      unsub();
      window.removeEventListener('storage', onStorage);
    };
  }, [store]);
}
