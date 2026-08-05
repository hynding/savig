import { useEffect, useMemo, useRef } from 'react';
import { createAutosaveStore, loadSavig, saveSavig } from '@savig/services';
import type { AutosaveStore } from '@savig/services';
import { makeAutosaveController } from '@savig/ui-core';
import { useEditor } from '../store/store';

/** Recovers the last autosaved .savig on mount and debounce-saves on every document (history)
 *  change. Thin React adapter over the neutral `makeAutosaveController` (slice 5): it wires the
 *  controller's `recover()`/`watch()` into two effects and injects the persistence backend +
 *  .savig serialization. Autosave is best-effort: the store degrades silently on failure. */
export function useAutosave(store?: AutosaveStore, delayMs = 1000): void {
  // The default backend must be RENDER-STABLE. A `store = createAutosaveStore()` default
  // parameter runs on every render, which made the useMemo below rebuild the controller and
  // re-fire the mount recover() effect on every <App> re-render (overlay open/close, pressing
  // play, ...) — restoring stale autosave bytes over the live project (template loads silently
  // undone, playback stopped via setProject's playing:false reset) and clearing the pending
  // debounced save on effect cleanup.
  const defaultStore = useRef<AutosaveStore | null>(null);
  const backend = store ?? (defaultStore.current ??= createAutosaveStore());
  const ctrl = useMemo(
    () => makeAutosaveController(useEditor, { persistence: backend, loadSavig, saveSavig, delayMs }),
    [backend, delayMs],
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

  // A reload/close inside the debounce window would drop the last edit — flush it on the way out.
  useEffect(() => {
    const flush = () => ctrl.flush();
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [ctrl]);
}
