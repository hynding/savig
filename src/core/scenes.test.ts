import { describe, it, expect } from 'vitest';
import { createProject, createSceneObject } from '../engine';
import { addScene, removeScene, reorderScene, setSceneDuration, setSceneTransition, withScene, addRect } from '.';

const single = () => ({ ...createProject(), objects: [createSceneObject('a', { id: 'o1' })] });

describe('core/scenes builders', () => {
  it('addScene promotes a single-scene project and returns the new scene id', () => {
    const { project, sceneId } = addScene(single());
    expect(project.scenes).toBeDefined();
    expect(project.scenes!.length).toBe(2);     // promoted root scene + new
    expect(project.objects).toEqual([]);         // source-of-truth
    expect(project.scenes!.some((s) => s.id === sceneId)).toBe(true);
    expect(project.scenes!.find((s) => s.id === sceneId)!.objects).toEqual([]);
  });

  it('addScene inserts after afterIndex (clamped) with default duration 1', () => {
    const a = addScene(single());               // [root, new1]
    const b = addScene(a.project, { afterIndex: 0, name: 'Mid', duration: 2.5 });
    const ids = b.project.scenes!.map((s) => s.id);
    expect(ids[1]).toBe(b.sceneId);              // inserted at index 1 (after 0)
    const sc = b.project.scenes!.find((s) => s.id === b.sceneId)!;
    expect(sc).toMatchObject({ name: 'Mid', duration: 2.5 });
  });

  it('removeScene drops a scene; demotes to single-scene when one remains', () => {
    const { project } = addScene(single());      // 2 scenes
    const root = project.scenes![0].id;
    const other = project.scenes![1].id;
    const afterFirst = removeScene(project, other);
    expect(afterFirst.scenes).toBeUndefined();   // demoted
    expect(() => removeScene(afterFirst, root)).toThrow(); // single-scene now → throws
  });

  it('removeScene/reorderScene/setSceneDuration/setSceneTransition throw on unknown id', () => {
    const { project } = addScene(single());
    expect(() => removeScene(project, 'nope')).toThrow();
    expect(() => reorderScene(project, 'nope', 0)).toThrow();
    expect(() => setSceneDuration(project, 'nope', 1)).toThrow();
    expect(() => setSceneTransition(project, 'nope', { kind: 'cut' })).toThrow();
  });

  it('reorderScene moves a scene; setSceneDuration clamps to > 0; setSceneTransition writes transitionIn', () => {
    const { project } = addScene(single());
    const [a, b] = project.scenes!.map((s) => s.id);
    expect(reorderScene(project, b, 0).scenes!.map((s) => s.id)).toEqual([b, a]);
    expect(setSceneDuration(project, b, 0).scenes!.find((s) => s.id === b)!.duration).toBeGreaterThan(0);
    expect(setSceneTransition(project, b, { kind: 'crossfade', duration: 0.5 }).scenes!.find((s) => s.id === b)!.transitionIn)
      .toEqual({ kind: 'crossfade', duration: 0.5 });
  });

  it('withScene routes a builder into the target scene (objects scene-local, assets global)', () => {
    const { project, sceneId } = addScene(single());     // scene[1] is empty & selected target
    const r = withScene(project, sceneId, (p) => addRect(p, { x: 0, y: 0, width: 10, height: 10, id: 'r1' }));
    expect(r.project.objects).toEqual([]);                // root stays empty
    expect(r.project.scenes!.find((s) => s.id === sceneId)!.objects.map((o) => o.id)).toEqual(['r1']);
    expect(r.project.assets.some((a) => a.id === 'r1-asset')).toBe(true); // asset global
    expect(r.id).toBe('r1');                              // pass-through of {project, id}
  });

  it('withScene with undefined sceneId / single-scene applies directly (parity)', () => {
    const p = single();
    const r = withScene(p, undefined, (x) => addRect(x, { x: 0, y: 0, width: 5, height: 5, id: 'r2' }));
    expect(r.project.objects.map((o) => o.id)).toContain('r2');
    expect(r.project.scenes).toBeUndefined();
  });
});
