// Framework-neutral autosave controller (slice 5, group D). Extracted from `hooks/useAutosave.ts`.
// The store is INJECTED (W2), as are the persistence port (`autosaveStore`) and the .savig
// serialization functions (kept injected so this package doesn't depend on @savig/services). The
// debounce timer + the "recovering" guard live in closures; the two React `useEffect`s become
// `recover()` (mount) and `watch()` (returns an unsubscribe) on the adapter side. Best-effort:
// failures degrade silently, exactly as before.
import type { EditorState } from '@savig/editor-state';
import type { Project } from '@savig/engine';

type Binaries = Record<string, Uint8Array>;

/** The persistence backend (createAutosaveStore()) — load the last snapshot, save a new one. */
export interface AutosavePersistence {
  load: () => Promise<Uint8Array | null>;
  save: (bytes: Uint8Array) => void | Promise<void>;
}

export interface AutosaveDeps {
  persistence: AutosavePersistence;
  loadSavig: (bytes: Uint8Array) => { project: Project; binaries: Binaries };
  saveSavig: (input: { project: Project; binaries: Binaries }) => Uint8Array;
  delayMs: number;
}

/** The store shape autosave needs — reads + the vanilla `subscribe`. */
export interface AutosaveEditorStore {
  getState: () => EditorState;
  subscribe: (listener: (state: EditorState, prev: EditorState) => void) => () => void;
}

export function makeAutosaveController(store: AutosaveEditorStore, deps: AutosaveDeps) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  // True only while applying a recovered project, so the subscription (which fires synchronously
  // inside setProject) skips re-saving trusted data.
  let recovering = false;

  // Runs the debounced save NOW. Shared by the timer and flush() so both write identical bytes.
  const savePresent = (): void => {
    timer = null;
    const s = store.getState();
    void deps.persistence.save(deps.saveSavig({ project: s.history.present, binaries: s.binaries }));
  };

  return {
    /** Recover the last autosaved .savig. `isCancelled` lets the adapter abort if it unmounts
     *  before the async load resolves (matches the original effect's `cancelled` flag). */
    async recover(isCancelled: () => boolean = () => false): Promise<void> {
      const before = store.getState().history.present;
      const bytes = await deps.persistence.load();
      if (isCancelled() || !bytes) return;
      // The user may have edited or loaded another project while the async read was in
      // flight — applying the recovered bytes now would clobber that work. Only recover
      // into a document that is still exactly the one we started loading against.
      if (store.getState().history.present !== before) return;
      try {
        const file = deps.loadSavig(bytes);
        recovering = true;
        store.getState().setProject(file.project, file.binaries);
        recovering = false;
      } catch {
        /* corrupt autosave: ignore, keep the fresh project */
        recovering = false;
      }
    },

    /** Debounce-save on every document (history) change. Returns an unsubscribe that also clears
     *  any pending save. */
    watch(): () => void {
      const unsub = store.subscribe((state, prev) => {
        if (state.history.present === prev.history.present) return;
        if (recovering) return; // don't re-save the project we just recovered
        if (timer) clearTimeout(timer);
        timer = setTimeout(savePresent, deps.delayMs);
      });
      return () => {
        unsub();
        if (timer) clearTimeout(timer);
      };
    },

    /** Save a pending debounced change immediately (no-op when nothing is pending). For
     *  pagehide/unload: without this, closing or reloading within the debounce window drops
     *  the last edit. */
    flush(): void {
      if (timer === null) return;
      clearTimeout(timer);
      savePresent();
    },
  };
}

export type AutosaveController = ReturnType<typeof makeAutosaveController>;
