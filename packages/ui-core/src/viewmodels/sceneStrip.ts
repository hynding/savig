// Framework-neutral view-model + intents for the SceneStrip panel (slice 4, task 3). Mirrors
// packages/ui-core/src/viewmodels/{inspector,timeline}.ts: `sceneStripViewModel` is a PURE
// function `EditorState -> SceneStripVM` covering every store-derived value `SceneStrip.tsx`
// used to compute inline — per-scene id/name/duration/active flag/transition — so it would read
// identically if the panel were rewritten in Svelte or Vue. `sceneStripIntents` are thin wrappers
// around store actions — no logic beyond dispatch.
//
// Deliberately NOT extracted (left in SceneStrip.tsx):
//  - Thumbnail RENDERING (`sceneThumbnailSvg`) — it imports `@savig/services/export/renderDocument`,
//    an app-local module `@savig/ui-core` is not allowed to import (only `@savig/engine`,
//    `@savig/interaction`, `@savig/editor-state`). The VM exposes the raw `scene` (+ project-level
//    `assets`/`meta`) each row needs to call it, exactly as `SceneStrip.tsx` did before this refactor.
//  - Rename-in-progress input state (`editingId`, the rename `<input>`'s local draft/cancel
//    handling) and the drag-reorder POINTER handlers (`onDragStart`/`onDragOver`/`onDrop`,
//    `dragId`). These are an L2 controller concern (slice 5) — extracting them now would risk
//    entangling pointer state with this VM.
import { projectScenes } from '@savig/engine';
import type { Asset, ProjectMeta, Scene, Transition } from '@savig/engine';
import { selectActiveSceneId } from '@savig/editor-state';
import type { EditorState } from '@savig/editor-state';

export interface SceneStripSceneVM {
  id: string;
  name: string;
  duration: number;
  active: boolean;
  /** Only meaningful when `showTransition` is true. */
  transitionIn: Transition | undefined;
  /** The transition picker only applies to a non-first scene, and only in multi-scene mode. */
  showTransition: boolean;
  /** Raw scene (objects/camera) — the component renders its thumbnail via the app-local
   *  `sceneThumbnailSvg(scene, assets, meta)` helper (see file header). */
  scene: Scene;
}

export interface SceneStripVM {
  scenes: SceneStripSceneVM[];
  assets: Asset[];
  meta: ProjectMeta;
  isMultiScene: boolean;
  /** The per-tile delete button shows only once there's more than one scene to delete down to. */
  canDelete: boolean;
}

export function sceneStripViewModel(s: EditorState): SceneStripVM {
  const present = s.history.present;
  const activeSceneId = selectActiveSceneId(s);
  const isMultiScene = Boolean(present.scenes);
  const scenes = projectScenes(present);

  const sceneVMs: SceneStripSceneVM[] = scenes.map((scene, index) => ({
    id: scene.id,
    name: scene.name,
    duration: scene.duration,
    active: scene.id === activeSceneId || (!present.scenes && index === 0),
    transitionIn: scene.transitionIn,
    showTransition: isMultiScene && index > 0,
    scene,
  }));

  return {
    scenes: sceneVMs,
    assets: present.assets,
    meta: present.meta,
    isMultiScene,
    canDelete: isMultiScene && scenes.length > 1,
  };
}

/** The minimal shape `sceneStripIntents` needs from the vanilla `@savig/editor-state` store —
 *  avoids importing zustand's `StoreApi` type just for this signature. `store` (the real
 *  vanilla StoreApi) satisfies this structurally. */
export interface SceneStripStore {
  getState: () => EditorState;
}

export function sceneStripIntents(store: SceneStripStore) {
  const s = () => store.getState();
  return {
    addScene: () => s().addScene(),
    deleteScene: (sceneId: string) => s().deleteScene(sceneId),
    reorderScene: (sceneId: string, toIndex: number) => s().reorderScene(sceneId, toIndex),
    renameScene: (sceneId: string, name: string) => s().renameScene(sceneId, name),
    setSceneDuration: (sceneId: string, duration: number) => s().setSceneDuration(sceneId, duration),
    selectScene: (sceneId: string) => s().selectScene(sceneId),
    setSceneTransition: (sceneId: string, transition: Transition) => s().setSceneTransition(sceneId, transition),
  };
}
