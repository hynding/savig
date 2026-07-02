import { useStore, type StoreApi, type UseBoundStore } from 'zustand';
import { store } from '@savig/editor-state';
import type { EditorState } from '@savig/editor-state';

// Bind the vanilla store to a React hook that ALSO carries the StoreApi methods
// (getState/setState/subscribe/getInitialState) — mirrors what zustand's create()
// returns, so all `useEditor(...)` and `useEditor.getState()` call sites are unchanged.
export const useEditor = Object.assign(
  ((selector?: (s: EditorState) => unknown) =>
    selector ? useStore(store, selector) : useStore(store)) as UseBoundStore<StoreApi<EditorState>>,
  store,
);

// Preserve the type re-export barrel so `import type { ToolMode } from '../../store/store'` still works.
export type {
  EditorState, Theme, ToolMode, KeyframeRef, ShapeKeyframeRef, ColorKeyframeRef,
  GradientKeyframeRef, DashKeyframeRef, ProgressKeyframeRef, RemapKeyframeRef,
  KeyframeClip, Toast,
} from '@savig/editor-state';
