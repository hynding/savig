// Pure unit tests for `sceneStripViewModel` — no React. Drives the real vanilla
// `@savig/editor-state` store through its actions (same store the app uses) and asserts on
// the resulting descriptor, mirroring how `SceneStrip.tsx` consumes it at runtime.
import { store } from '@savig/editor-state';
import { createProject } from '@savig/engine';
import { sceneStripViewModel } from './sceneStrip';

beforeEach(() => {
  store.getState().setProject(createProject());
});

describe('sceneStripViewModel — single-scene project', () => {
  it('synthesizes one active scene, and reports single-scene mode', () => {
    const vm = sceneStripViewModel(store.getState());
    expect(vm.scenes).toHaveLength(1);
    expect(vm.scenes[0].active).toBe(true);
    expect(vm.scenes[0].showTransition).toBe(false); // index 0, never shown
    expect(vm.isMultiScene).toBe(false);
    expect(vm.canDelete).toBe(false);
  });
});

describe('sceneStripViewModel — multi-scene: ids, names, duration, active', () => {
  it('addScene grows the scene list and moves `active` onto the new scene', () => {
    store.getState().addScene();
    const scenes = store.getState().history.present.scenes!;
    const [scene0, scene1] = scenes;

    const vm = sceneStripViewModel(store.getState());
    expect(vm.isMultiScene).toBe(true);
    expect(vm.scenes.map((s) => s.id)).toEqual([scene0.id, scene1.id]);
    expect(vm.scenes[0].active).toBe(false);
    expect(vm.scenes[1].active).toBe(true); // addScene selects the scene it created
    expect(vm.canDelete).toBe(true); // >1 scene
  });

  it('reflects a non-default scene duration set via setSceneDuration', () => {
    store.getState().addScene();
    const second = store.getState().history.present.scenes![1];
    store.getState().setSceneDuration(second.id, 3.5);

    const vm = sceneStripViewModel(store.getState());
    expect(vm.scenes.find((s) => s.id === second.id)?.duration).toBe(3.5);
  });

  it('reflects a renamed scene', () => {
    store.getState().addScene();
    const second = store.getState().history.present.scenes![1];
    store.getState().renameScene(second.id, 'Intro');

    const vm = sceneStripViewModel(store.getState());
    expect(vm.scenes.find((s) => s.id === second.id)?.name).toBe('Intro');
  });

  it('selectScene moves the active flag onto the selected scene', () => {
    store.getState().addScene();
    const [scene0, scene1] = store.getState().history.present.scenes!;
    store.getState().selectScene(scene0.id);

    const vm = sceneStripViewModel(store.getState());
    expect(vm.scenes.find((s) => s.id === scene0.id)?.active).toBe(true);
    expect(vm.scenes.find((s) => s.id === scene1.id)?.active).toBe(false);
  });
});

describe('sceneStripViewModel — transitions', () => {
  it('the first scene never shows a transition picker, even in multi-scene mode', () => {
    store.getState().addScene();
    const vm = sceneStripViewModel(store.getState());
    expect(vm.scenes[0].showTransition).toBe(false);
    expect(vm.scenes[1].showTransition).toBe(true); // non-first scene, multi-scene mode
  });

  it('defaults to no transitionIn (implicit cut) on a freshly-added scene', () => {
    store.getState().addScene();
    const second = store.getState().history.present.scenes![1];
    const vm = sceneStripViewModel(store.getState());
    expect(vm.scenes.find((s) => s.id === second.id)?.transitionIn).toBeUndefined();
  });

  it('reflects a crossfade transition set via setSceneTransition', () => {
    store.getState().addScene();
    const second = store.getState().history.present.scenes![1];
    store.getState().setSceneTransition(second.id, { kind: 'crossfade', duration: 0.75 });

    const vm = sceneStripViewModel(store.getState());
    expect(vm.scenes.find((s) => s.id === second.id)?.transitionIn).toEqual({ kind: 'crossfade', duration: 0.75 });
  });

  it('reflects a dip transition (kind + duration + color)', () => {
    store.getState().addScene();
    const second = store.getState().history.present.scenes![1];
    store.getState().setSceneTransition(second.id, { kind: 'dip', duration: 1.2, color: '#112233' });

    const vm = sceneStripViewModel(store.getState());
    expect(vm.scenes.find((s) => s.id === second.id)?.transitionIn).toEqual({
      kind: 'dip',
      duration: 1.2,
      color: '#112233',
    });
  });
});

describe('sceneStripViewModel — project-level passthrough for thumbnail rendering', () => {
  it('exposes the raw scene + a non-default meta.fps for the component to render thumbnails with', () => {
    const present = store.getState().history.present;
    store.getState().commit({ ...present, meta: { ...present.meta, fps: 24 } });

    const vm = sceneStripViewModel(store.getState());
    expect(vm.meta.fps).toBe(24);
    expect(vm.scenes[0].scene.objects).toBe(store.getState().history.present.objects);
  });

  it('exposes project assets for thumbnail rendering', () => {
    store.getState().addAsset(
      { id: 'aud', kind: 'audio', name: 'song', mimeType: 'audio/mpeg' },
      new Uint8Array([1]),
    );
    const vm = sceneStripViewModel(store.getState());
    expect(vm.assets.some((a) => a.id === 'aud')).toBe(true);
  });
});
