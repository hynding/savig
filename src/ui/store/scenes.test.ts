import { it, expect, beforeEach } from 'vitest';
import { useEditor } from './store';
import { createProject } from '../../engine';

beforeEach(() => useEditor.getState().setProject(createProject()));

it('addScene promotes a single-scene project and selects the new scene', () => {
  const e = useEditor.getState();
  e.addScene();
  const p = useEditor.getState().history.present;
  expect(p.scenes).toBeDefined();
  expect(p.scenes!.length).toBe(2);                 // scene 0 (promoted root) + new
  expect(p.objects).toEqual([]);
  expect(useEditor.getState().selectedSceneId).toBe(p.scenes![1].id);
  expect(useEditor.getState().time).toBe(0);
});

it('deleteScene removes a scene; deleting down to one demotes back to single-scene', () => {
  const e = useEditor.getState();
  e.addScene();                                      // now 2 scenes
  const second = useEditor.getState().history.present.scenes![1].id;
  e.deleteScene(second);
  expect(useEditor.getState().history.present.scenes).toBeUndefined(); // demoted
});

it('reorderScene moves a scene to a new index', () => {
  const e = useEditor.getState();
  e.addScene();
  const p0 = useEditor.getState().history.present;
  const [a, b] = p0.scenes!.map((s) => s.id);
  e.reorderScene(b, 0);
  expect(useEditor.getState().history.present.scenes!.map((s) => s.id)).toEqual([b, a]);
});

it('renameScene / setSceneDuration update the scene; duration clamps to > 0', () => {
  const e = useEditor.getState();
  e.addScene();
  const id = useEditor.getState().history.present.scenes![1].id;
  e.renameScene(id, 'Intro');
  e.setSceneDuration(id, 0);                          // clamped
  const sc = useEditor.getState().history.present.scenes!.find((s) => s.id === id)!;
  expect(sc.name).toBe('Intro');
  expect(sc.duration).toBeGreaterThan(0);
});

it('selectScene switches selection, clears object selection and exits any symbol', () => {
  const e = useEditor.getState();
  e.addScene();
  const first = useEditor.getState().history.present.scenes![0].id;
  e.selectScene(first);
  expect(useEditor.getState().selectedSceneId).toBe(first);
  expect(useEditor.getState().selectedObjectIds).toEqual([]);
  expect(useEditor.getState().editPath).toEqual([]);
  expect(useEditor.getState().time).toBe(0);
});
