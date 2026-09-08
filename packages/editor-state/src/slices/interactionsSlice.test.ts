// Covers: addBehavior/updateBehavior/removeBehavior on a stage object (routed to wherever the
// object lives — project.objects OR any scenes[i].objects, NOT gated on the currently active
// scene) and on the project (objectId: null -> project.interactions.handlers);
// addVariable/updateVariable/removeVariable (upsert semantics documented on addVariable);
// conditional-spread field removal (last behavior/variable/handler strips the parent field);
// enterPreview/exitPreview (transient, not undoable). Fresh `store.getState()` per read
// throughout (a captured snapshot goes stale the moment an action commits).
import { describe, it, expect, beforeEach } from 'vitest';
import { store } from '../store';
import type { Behavior } from '@savig/engine';

beforeEach(() => {
  store.getState().newProject();
});

function addObject(): string {
  store.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
  return store.getState().selectedObjectId!;
}

const CLICK: Omit<Behavior, 'id'> = {
  event: 'click',
  actions: [{ kind: 'setOpacity', args: { value: '0' } }],
};

describe('addBehavior', () => {
  it('adds a behavior to an object living at the project root', () => {
    const id = addObject();
    store.getState().addBehavior(id, CLICK);
    const obj = store.getState().history.present.objects.find((o) => o.id === id)!;
    expect(obj.behaviors).toHaveLength(1);
    expect(obj.behaviors![0].event).toBe('click');
    expect(obj.behaviors![0].actions).toEqual(CLICK.actions);
    expect(typeof obj.behaviors![0].id).toBe('string');
    expect(obj.behaviors![0].id.length).toBeGreaterThan(0);
  });

  it('finds and edits the object wherever it lives — inside a NON-active scene', () => {
    // Promote to multi-scene, add a second scene, place an object into it (active scene).
    store.getState().addScene();
    const targetId = addObject();
    const targetSceneId = store.getState().selectedSceneId;
    // Switch away to a different active scene before adding the behavior.
    const scenes = store.getState().history.present.scenes!;
    const otherScene = scenes.find((sc) => sc.id !== targetSceneId)!;
    store.getState().selectScene(otherScene.id);
    expect(store.getState().selectedSceneId).not.toBe(targetSceneId);

    store.getState().addBehavior(targetId, CLICK);

    const scene = store.getState().history.present.scenes!.find((sc) => sc.id === targetSceneId)!;
    const obj = scene.objects.find((o) => o.id === targetId)!;
    expect(obj.behaviors).toHaveLength(1);
    expect(obj.behaviors![0].event).toBe('click');
  });

  it('objectId: null lands the behavior in project.interactions.handlers, creating interactions conditionally', () => {
    expect(store.getState().history.present.interactions).toBeUndefined();
    store.getState().addBehavior(null, { event: 'keydown', key: 'ArrowLeft', actions: [] });
    const model = store.getState().history.present.interactions!;
    expect(model.handlers).toHaveLength(1);
    expect(model.handlers![0].event).toBe('keydown');
    expect(model.handlers![0].key).toBe('ArrowLeft');
  });

  it('unknown objectId is a silent no-op (no commit)', () => {
    const pastBefore = store.getState().history.past.length;
    store.getState().addBehavior('nope', CLICK);
    expect(store.getState().history.past.length).toBe(pastBefore);
  });

  it('undo restores the object without the behavior', () => {
    const id = addObject();
    store.getState().addBehavior(id, CLICK);
    store.getState().undo();
    const obj = store.getState().history.present.objects.find((o) => o.id === id)!;
    expect(obj.behaviors).toBeUndefined();
  });

  it('undo restores a project-level handler add', () => {
    store.getState().addBehavior(null, { event: 'tick', actions: [] });
    store.getState().undo();
    expect(store.getState().history.present.interactions).toBeUndefined();
  });
});

describe('updateBehavior', () => {
  it('patches fields on an object behavior, leaving the id stable', () => {
    const id = addObject();
    store.getState().addBehavior(id, CLICK);
    const behaviorId = store.getState().history.present.objects.find((o) => o.id === id)!.behaviors![0].id;
    store.getState().updateBehavior(id, behaviorId, { event: 'pointerdown' });
    const obj = store.getState().history.present.objects.find((o) => o.id === id)!;
    expect(obj.behaviors![0].id).toBe(behaviorId);
    expect(obj.behaviors![0].event).toBe('pointerdown');
    expect(obj.behaviors![0].actions).toEqual(CLICK.actions); // untouched field survives the patch
  });

  it('patches a project-level handler', () => {
    store.getState().addBehavior(null, { event: 'keydown', key: 'a', actions: [] });
    const behaviorId = store.getState().history.present.interactions!.handlers![0].id;
    store.getState().updateBehavior(null, behaviorId, { key: 'b' });
    expect(store.getState().history.present.interactions!.handlers![0].key).toBe('b');
  });

  it('unknown behaviorId is a silent no-op', () => {
    const id = addObject();
    store.getState().addBehavior(id, CLICK);
    const pastBefore = store.getState().history.past.length;
    store.getState().updateBehavior(id, 'nope', { event: 'pointerup' });
    expect(store.getState().history.past.length).toBe(pastBefore);
  });

  it('undo restores the prior behavior fields', () => {
    const id = addObject();
    store.getState().addBehavior(id, CLICK);
    const behaviorId = store.getState().history.present.objects.find((o) => o.id === id)!.behaviors![0].id;
    store.getState().updateBehavior(id, behaviorId, { event: 'hoverEnter' });
    store.getState().undo();
    const obj = store.getState().history.present.objects.find((o) => o.id === id)!;
    expect(obj.behaviors![0].event).toBe('click');
  });
});

describe('removeBehavior', () => {
  it('removes one of several behaviors, keeping the rest', () => {
    const id = addObject();
    store.getState().addBehavior(id, CLICK);
    store.getState().addBehavior(id, { event: 'pointerdown', actions: [] });
    const [b1, b2] = store.getState().history.present.objects.find((o) => o.id === id)!.behaviors!;
    store.getState().removeBehavior(id, b1.id);
    const obj = store.getState().history.present.objects.find((o) => o.id === id)!;
    expect(obj.behaviors).toHaveLength(1);
    expect(obj.behaviors![0].id).toBe(b2.id);
  });

  it('removing the last behavior strips the `behaviors` field entirely (byte-clean)', () => {
    const id = addObject();
    store.getState().addBehavior(id, CLICK);
    const behaviorId = store.getState().history.present.objects.find((o) => o.id === id)!.behaviors![0].id;
    store.getState().removeBehavior(id, behaviorId);
    const obj = store.getState().history.present.objects.find((o) => o.id === id)!;
    expect(obj.behaviors).toBeUndefined();
    expect('behaviors' in obj).toBe(false);
  });

  it('removing the last project handler (no variables) strips `interactions` entirely', () => {
    store.getState().addBehavior(null, { event: 'tick', actions: [] });
    const behaviorId = store.getState().history.present.interactions!.handlers![0].id;
    store.getState().removeBehavior(null, behaviorId);
    expect(store.getState().history.present.interactions).toBeUndefined();
    expect('interactions' in store.getState().history.present).toBe(false);
  });

  it('removing the last handler while a variable still exists keeps `interactions` (drops only `handlers`)', () => {
    store.getState().addVariable('score', 0);
    store.getState().addBehavior(null, { event: 'tick', actions: [] });
    const behaviorId = store.getState().history.present.interactions!.handlers![0].id;
    store.getState().removeBehavior(null, behaviorId);
    const model = store.getState().history.present.interactions!;
    expect(model.handlers).toBeUndefined();
    expect('handlers' in model).toBe(false);
    expect(model.variables).toEqual([{ name: 'score', initial: 0 }]);
  });

  it('unknown behaviorId is a silent no-op', () => {
    const id = addObject();
    const pastBefore = store.getState().history.past.length;
    store.getState().removeBehavior(id, 'nope');
    expect(store.getState().history.past.length).toBe(pastBefore);
  });

  it('undo restores the removed behavior', () => {
    const id = addObject();
    store.getState().addBehavior(id, CLICK);
    const behaviorId = store.getState().history.present.objects.find((o) => o.id === id)!.behaviors![0].id;
    store.getState().removeBehavior(id, behaviorId);
    store.getState().undo();
    const obj = store.getState().history.present.objects.find((o) => o.id === id)!;
    expect(obj.behaviors).toHaveLength(1);
    expect(obj.behaviors![0].id).toBe(behaviorId);
  });
});

describe('addVariable', () => {
  it('creates project.interactions.variables conditionally', () => {
    expect(store.getState().history.present.interactions).toBeUndefined();
    store.getState().addVariable('score', 0);
    expect(store.getState().history.present.interactions!.variables).toEqual([{ name: 'score', initial: 0 }]);
  });

  it('a duplicate name REPLACES the existing entry (documented upsert)', () => {
    store.getState().addVariable('score', 0);
    store.getState().addVariable('score', 'high');
    const vars = store.getState().history.present.interactions!.variables!;
    expect(vars).toHaveLength(1);
    expect(vars[0]).toEqual({ name: 'score', initial: 'high' });
  });

  it('a duplicate name REPLACES in place, preserving row order (does not bump it to the end)', () => {
    store.getState().addVariable('a', 1);
    store.getState().addVariable('b', 2);
    store.getState().addVariable('a', 99); // replace the FIRST entry
    expect(store.getState().history.present.interactions!.variables).toEqual([
      { name: 'a', initial: 99 },
      { name: 'b', initial: 2 },
    ]);
  });

  it('accepts number/string/boolean initials', () => {
    store.getState().addVariable('n', 1);
    store.getState().addVariable('s', 'x');
    store.getState().addVariable('b', true);
    const vars = store.getState().history.present.interactions!.variables!;
    expect(vars).toEqual([
      { name: 'n', initial: 1 },
      { name: 's', initial: 'x' },
      { name: 'b', initial: true },
    ]);
  });

  it('undo restores the prior variables list', () => {
    store.getState().addVariable('score', 0);
    store.getState().undo();
    expect(store.getState().history.present.interactions).toBeUndefined();
  });
});

describe('updateVariable', () => {
  it('replaces an existing variable\'s initial', () => {
    store.getState().addVariable('score', 0);
    store.getState().updateVariable('score', 42);
    expect(store.getState().history.present.interactions!.variables).toEqual([{ name: 'score', initial: 42 }]);
  });

  it('unknown name is a silent no-op', () => {
    const pastBefore = store.getState().history.past.length;
    store.getState().updateVariable('nope', 1);
    expect(store.getState().history.past.length).toBe(pastBefore);
  });

  it('undo restores the prior value', () => {
    store.getState().addVariable('score', 0);
    store.getState().updateVariable('score', 42);
    store.getState().undo();
    expect(store.getState().history.present.interactions!.variables).toEqual([{ name: 'score', initial: 0 }]);
  });
});

describe('removeVariable', () => {
  it('removes one of several, keeping the rest', () => {
    store.getState().addVariable('a', 1);
    store.getState().addVariable('b', 2);
    store.getState().removeVariable('a');
    expect(store.getState().history.present.interactions!.variables).toEqual([{ name: 'b', initial: 2 }]);
  });

  it('removing the last variable (no handlers) strips `interactions` entirely', () => {
    store.getState().addVariable('score', 0);
    store.getState().removeVariable('score');
    expect(store.getState().history.present.interactions).toBeUndefined();
    expect('interactions' in store.getState().history.present).toBe(false);
  });

  it('removing the last variable while a handler still exists keeps `interactions` (drops only `variables`)', () => {
    store.getState().addVariable('score', 0);
    store.getState().addBehavior(null, { event: 'tick', actions: [] });
    store.getState().removeVariable('score');
    const model = store.getState().history.present.interactions!;
    expect(model.variables).toBeUndefined();
    expect('variables' in model).toBe(false);
    expect(model.handlers).toHaveLength(1);
  });

  it('unknown name is a silent no-op', () => {
    const pastBefore = store.getState().history.past.length;
    store.getState().removeVariable('nope');
    expect(store.getState().history.past.length).toBe(pastBefore);
  });

  it('undo restores the removed variable', () => {
    store.getState().addVariable('score', 0);
    store.getState().removeVariable('score');
    store.getState().undo();
    expect(store.getState().history.present.interactions!.variables).toEqual([{ name: 'score', initial: 0 }]);
  });
});

describe('enterPreview / exitPreview', () => {
  it('starts false on a fresh project', () => {
    expect(store.getState().previewMode).toBe(false);
  });

  it('enterPreview sets previewMode and clears object + keyframe selection, WITHOUT an undo entry', () => {
    const id = addObject();
    store.getState().selectObject(id);
    store.getState().selectKeyframe({ objectId: id, property: 'opacity', time: 0 });
    const pastBefore = store.getState().history.past.length;

    store.getState().enterPreview();

    expect(store.getState().previewMode).toBe(true);
    expect(store.getState().selectedObjectId).toBeNull();
    expect(store.getState().selectedObjectIds).toEqual([]);
    expect(store.getState().selectedKeyframe).toBeNull();
    expect(store.getState().history.past.length).toBe(pastBefore); // transient, no commit
  });

  it('exitPreview clears previewMode, WITHOUT an undo entry', () => {
    store.getState().enterPreview();
    const pastBefore = store.getState().history.past.length;

    store.getState().exitPreview();

    expect(store.getState().previewMode).toBe(false);
    expect(store.getState().history.past.length).toBe(pastBefore);
  });
});
