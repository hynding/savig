import { store } from '@savig/editor-state';
import type { EditorState } from '@savig/editor-state';

export { store };

/** Svelte-store contract over the vanilla `@savig/editor-state` store — the analog of React's
 *  `useEditor` shim, with ZERO framework code. In a component, `$editor` auto-subscribes and yields
 *  the current `EditorState`. Intents/controllers take the vanilla `store` directly (it exposes the
 *  full zustand StoreApi: getState/setState/subscribe), so the neutral view-models and controllers
 *  drive Svelte exactly as they drive React. */
export const editor = {
  subscribe(run: (s: EditorState) => void): () => void {
    run(store.getState());
    return store.subscribe(() => run(store.getState()));
  },
};
