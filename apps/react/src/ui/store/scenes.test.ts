import { it, expect, beforeEach } from 'vitest';
import { useEditor } from './store';
import { createProject } from '@savig/engine';

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

it('createSymbol inside a scene puts the instance in the active scene, not project.objects', () => {
  const e = useEditor.getState();
  e.addScene(); // promotes to 2 scenes, selectedSceneId = scene[1]
  const scene2Id = useEditor.getState().selectedSceneId!;
  e.addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  const a = useEditor.getState().selectedObjectId!;
  e.addVectorShape('rect', { x: 40, y: 0, width: 10, height: 10 });
  const b = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectObjects([a, b]);
  e.createSymbol();
  const p = useEditor.getState().history.present;
  const sym = p.assets.find((x) => x.kind === 'symbol');
  expect(sym).toBeDefined();
  expect(p.objects).toEqual([]); // root stays empty in multi-scene
  const scene2 = p.scenes!.find((sc) => sc.id === scene2Id)!;
  expect(scene2.objects).toHaveLength(1);
  expect(scene2.objects[0].assetId).toBe(sym!.id);
});

it('selectObjectOrGroup inside a scene escalates to the group (reads active scene, not empty root)', () => {
  const e = useEditor.getState();
  e.addScene(); // promotes to 2 scenes, selectedSceneId = scene[1]
  e.addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  const a = useEditor.getState().selectedObjectId!;
  e.addVectorShape('rect', { x: 40, y: 0, width: 10, height: 10 });
  const b = useEditor.getState().selectedObjectId!;
  useEditor.getState().selectObjects([a, b]);
  e.groupSelected();
  const scene2Id = useEditor.getState().selectedSceneId!;
  const scene2 = useEditor.getState().history.present.scenes!.find((sc) => sc.id === scene2Id)!;
  const gid = scene2.objects.find((o) => o.isGroup)!.id;
  e.selectObjectOrGroup(a); // child 'a' must escalate to the group
  expect(useEditor.getState().selectedObjectIds).toEqual([gid]);
});

it('setSceneTransition sets the incoming scene transitionIn', () => {
  const e = useEditor.getState();
  e.addScene();                                   // 2 scenes
  const second = useEditor.getState().history.present.scenes![1].id;
  e.setSceneTransition(second, { kind: 'crossfade', duration: 0.5 });
  expect(useEditor.getState().history.present.scenes!.find((s) => s.id === second)!.transitionIn)
    .toEqual({ kind: 'crossfade', duration: 0.5 });
});

it('deleteScene preserves object selection when a NON-active scene is deleted', () => {
  const e = useEditor.getState();
  e.addScene(); // 2 scenes
  e.addScene(); // 3 scenes, scene[2] now active
  const scenes = useEditor.getState().history.present.scenes!;
  const scene2Id = scenes[1].id;
  const scene3Id = scenes[2].id;
  e.selectScene(scene2Id);
  e.addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  const objId = useEditor.getState().selectedObjectId!;
  e.seek(0.5);
  e.deleteScene(scene3Id); // delete non-active scene
  expect(useEditor.getState().selectedObjectId).toBe(objId);
  expect(useEditor.getState().selectedObjectIds).toEqual([objId]);
  expect(useEditor.getState().time).toBe(0.5);
  expect(useEditor.getState().selectedSceneId).toBe(scene2Id);
});
