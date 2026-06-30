import { promoteToMultiScene, demoteToSingleScene, newId } from '../../../engine';
import type { Scene } from '../../../engine';
import { type SliceCreator } from '../store-internals';
import { selectActiveSceneId } from '../selectors';

const MIN_SCENE_DURATION = 1 / 240;

type SceneKeys = 'addScene' | 'deleteScene' | 'reorderScene' | 'renameScene' | 'setSceneDuration' | 'selectScene';

export const createScenesSlice: SliceCreator<SceneKeys> = (set, get) => ({
  addScene() {
    const s = get();
    const promoted = s.history.present.scenes ? s.history.present : promoteToMultiScene(s.history.present);
    const scenes = promoted.scenes!;
    const activeIdx = scenes.findIndex((sc) => sc.id === selectActiveSceneId(s));
    const insertAt = (activeIdx >= 0 ? activeIdx : scenes.length - 1) + 1;
    const scene: Scene = { id: newId(), name: `Scene ${scenes.length + 1}`, objects: [], duration: 1 };
    const next = [...scenes.slice(0, insertAt), scene, ...scenes.slice(insertAt)];
    get().commit({ ...promoted, objects: [], camera: undefined, scenes: next });
    set({ selectedSceneId: scene.id, selectedObjectId: null, selectedObjectIds: [], editPath: [], time: 0 });
  },
  deleteScene(sceneId) {
    const present = get().history.present;
    if (!present.scenes || present.scenes.length <= 1) return;
    const prevActiveId = selectActiveSceneId(get());
    const next = present.scenes.filter((sc) => sc.id !== sceneId);
    const demoted = next.length === 1
      ? demoteToSingleScene({ ...present, scenes: next })
      : { ...present, scenes: next };
    get().commit(demoted);
    const nextSel = demoted.scenes
      ? (demoted.scenes.find((sc) => sc.id === get().selectedSceneId)?.id ?? demoted.scenes[0].id)
      : null;
    const deletingActive = sceneId === prevActiveId;
    const demoting = !demoted.scenes;
    if (deletingActive || demoting) {
      set({ selectedSceneId: nextSel, selectedObjectId: null, selectedObjectIds: [], editPath: [], time: 0 });
    } else {
      set({ selectedSceneId: nextSel });
    }
  },
  reorderScene(sceneId, toIndex) {
    const present = get().history.present;
    if (!present.scenes) return;
    const from = present.scenes.findIndex((sc) => sc.id === sceneId);
    if (from < 0) return;
    const clamped = Math.max(0, Math.min(toIndex, present.scenes.length - 1));
    const next = [...present.scenes];
    const [moved] = next.splice(from, 1);
    next.splice(clamped, 0, moved);
    get().commit({ ...present, scenes: next });
  },
  renameScene(sceneId, name) {
    const present = get().history.present;
    if (!present.scenes) return;
    get().commit({ ...present, scenes: present.scenes.map((sc) => (sc.id === sceneId ? { ...sc, name } : sc)) });
  },
  setSceneDuration(sceneId, duration) {
    const present = get().history.present;
    if (!present.scenes) return;
    const d = Math.max(MIN_SCENE_DURATION, duration);
    get().commit({ ...present, scenes: present.scenes.map((sc) => (sc.id === sceneId ? { ...sc, duration: d } : sc)) });
  },
  selectScene(sceneId) {
    if (!get().history.present.scenes?.some((sc) => sc.id === sceneId)) return;
    set({ selectedSceneId: sceneId, selectedObjectId: null, selectedObjectIds: [], editPath: [], time: 0 });
  },
});
