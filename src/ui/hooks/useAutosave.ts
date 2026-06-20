import { useEffect, useRef } from 'react';
import { createAutosaveStore, loadSavig, saveSavig } from '../../services';
import type { AutosaveStore } from '../../services';
import { useEditor } from '../store/store';

// Recovers the last autosaved .savig on mount and debounce-saves on every
// document (history) change. Autosave is best-effort: the store degrades
// silently on failure, so a broken IndexedDB just means "no recovered draft".
export function useAutosave(store: AutosaveStore = createAutosaveStore(), delayMs = 1000): void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Recover on mount.
  useEffect(() => {
    let cancelled = false;
    void store.load().then((bytes) => {
      if (cancelled || !bytes) return;
      try {
        const file = loadSavig(bytes);
        useEditor.getState().setProject(file.project, file.binaries);
      } catch {
        /* corrupt autosave: ignore, keep the fresh project */
      }
    });
    return () => {
      cancelled = true;
    };
  }, [store]);

  // Debounced save on history change.
  useEffect(() => {
    const unsub = useEditor.subscribe((state, prev) => {
      if (state.history.present === prev.history.present) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const s = useEditor.getState();
        void store.save(saveSavig({ project: s.history.present, binaries: s.binaries }));
      }, delayMs);
    });
    return () => {
      unsub();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [store, delayMs]);
}
