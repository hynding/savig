import { useEffect, useMemo } from 'react';
import { createAutosaveStore, loadSavig, saveSavig } from '@savig/services';
import type { AutosaveStore } from '@savig/services';
import { makeAutosaveController } from '@savig/ui-core';
import { useEditor } from '../store/store';

/** Recovers the last autosaved .savig on mount and debounce-saves on every document (history)
 *  change. Thin React adapter over the neutral `makeAutosaveController` (slice 5): it wires the
 *  controller's `recover()`/`watch()` into two effects and injects the persistence backend +
 *  .savig serialization. Autosave is best-effort: the store degrades silently on failure. */
export function useAutosave(store: AutosaveStore = createAutosaveStore(), delayMs = 1000): void {
  const ctrl = useMemo(
    () => makeAutosaveController(useEditor, { persistence: store, loadSavig, saveSavig, delayMs }),
    [store, delayMs],
  );

  // Recover on mount (aborts if unmounted before the async load resolves).
  useEffect(() => {
    let cancelled = false;
    void ctrl.recover(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [ctrl]);

  // Debounced save on history change.
  useEffect(() => ctrl.watch(), [ctrl]);
}
