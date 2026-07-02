import { useRef } from 'react';
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

/**
 * Select a framework-neutral view-model. Returns the SAME result object while the
 * store's state reference is unchanged, so a pure VM that allocates fresh objects
 * each call satisfies useSyncExternalStore's stability requirement (no render loop),
 * without baking React concerns into the neutral view-model. Use this for ALL
 * @savig/ui-core view-models.
 */
export function useEditorVM<T>(vm: (s: EditorState) => T): T {
  const cache = useRef<{ s: EditorState; v: T } | null>(null);
  return useEditor((s: EditorState) => {
    if (cache.current && cache.current.s === s) return cache.current.v;
    const v = vm(s);
    cache.current = { s, v };
    return v;
  }) as T;
}

// Preserve the type re-export barrel so `import type { ToolMode } from '../../store/store'` still works.
export type {
  EditorState, Theme, ToolMode, KeyframeRef, ShapeKeyframeRef, ColorKeyframeRef,
  GradientKeyframeRef, DashKeyframeRef, ProgressKeyframeRef, RemapKeyframeRef,
  KeyframeClip, Toast,
} from '@savig/editor-state';
