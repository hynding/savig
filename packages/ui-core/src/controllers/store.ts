// The minimal store handle a controller needs, injected by the app (W2: controllers never
// import the store — the app passes its vanilla `@savig/editor-state` store in). Mirrors the
// `InspectorStore` convention from the view-models: a structural `{ getState }` shape so we
// don't drag zustand's `StoreApi` type into neutral code. The real vanilla store satisfies it.
// Controllers that need reactive lifecycle (autosave/playback) widen this with `subscribe` /
// `setState` in their own file.
import type { EditorState } from '@savig/editor-state';

export interface ControllerStore {
  getState: () => EditorState;
}
