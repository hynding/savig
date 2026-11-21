import { describe, it, expect, beforeEach } from 'vitest';
import { createProject } from '@savig/engine';
import { store } from './store';
import { humanizeAction, transformLabel, withHistoryLabel } from './historyLabels';

beforeEach(() => {
  store.getState().newProject();
});

const labels = () => store.getState().historyLabels;
const all = () => {
  const l = labels();
  return [...l.past, l.present, ...l.future];
};
const square = () => store.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });

describe('history labels (roadmap 13)', () => {
  it('starts with one "New document" state; opening a file starts with "Open document"', () => {
    expect(all()).toEqual(['New document']);
    store.getState().setProject(createProject());
    expect(all()).toEqual(['Open document']);
  });

  it('names each commit by the action that made it, step for step with history', () => {
    square();
    store.getState().setProperty('rotation', 45);
    store.getState().setProperties({ x: 5, y: 6 });
    store.getState().setVectorColor('stroke', '#ff0000');
    store.getState().duplicateSelected();
    expect(all()).toEqual(['New document', 'Draw rect', 'Rotate', 'Move', 'Stroke color', 'Duplicate']);
    expect(labels().past.length).toBe(store.getState().history.past.length);
  });

  it('an action that calls other actions is named by the outer one', () => {
    square();
    store.getState().duplicateSelected();
    store.getState().groupSelected(); // only one selected -> may no-op; select both first
    const s = store.getState();
    s.selectObjects(s.history.present.objects.map((o) => o.id));
    store.getState().groupSelected();
    expect(labels().present).toBe('Group');
  });

  it('a command title wins over the action name', () => {
    square();
    withHistoryLabel('Duplicate (Ctrl+D)', () => store.getState().duplicateSelected());
    expect(labels().present).toBe('Duplicate (Ctrl+D)');
  });

  it('undo and redo move the labels with the history', () => {
    square();
    store.getState().setProperty('x', 50);
    store.getState().undo();
    expect(labels().present).toBe('Draw rect');
    expect(labels().future).toEqual(['Move']);
    store.getState().redo();
    expect(labels().present).toBe('Move');
    expect(labels().future).toEqual([]);
  });

  it('jumpToHistory jumps any distance in one call and keeps later steps redoable', () => {
    square();
    const drawn = store.getState().history.present;
    store.getState().setProperty('x', 50);
    store.getState().setProperty('rotation', 10);
    const rotated = store.getState().history.present;
    store.getState().jumpToHistory(1);
    expect(labels().present).toBe('Draw rect');
    expect(store.getState().history.present).toBe(drawn);
    expect(labels().future).toEqual(['Move', 'Rotate']);
    store.getState().jumpToHistory(0);
    expect(store.getState().history.present.objects).toHaveLength(0);
    store.getState().jumpToHistory(3);
    expect(labels().present).toBe('Rotate');
    expect(store.getState().history.present).toBe(rotated);
    // A new edit after jumping back drops the redo branch, as undo does.
    store.getState().jumpToHistory(1);
    store.getState().selectObject(store.getState().history.present.objects[0]!.id);
    store.getState().setProperty('y', 7);
    expect(all()).toEqual(['New document', 'Draw rect', 'Move']);
  });

  it('jumping clears a selection whose object no longer exists', () => {
    square();
    expect(store.getState().selectedObjectIds).toHaveLength(1);
    store.getState().jumpToHistory(0);
    expect(store.getState().selectedObjectIds).toHaveLength(0);
  });

  it('re-aligns labels when history was set from outside', () => {
    square();
    const h = store.getState().history;
    store.setState({ history: { past: [...h.past, h.present], present: h.present, future: [] } });
    store.getState().setProperty('x', 3);
    expect(labels().past.length).toBe(store.getState().history.past.length);
    expect(labels().present).toBe('Move');
  });
});

describe('humanizeAction', () => {
  it('turns action names into short labels', () => {
    expect(humanizeAction('removeSelectedKeyframe')).toBe('Remove keyframe');
    expect(humanizeAction('createShapeTween')).toBe('Create shape tween');
    expect(humanizeAction('commit')).toBe('Edit');
    expect(humanizeAction('setVectorColor', ['fill', '#000'])).toBe('Fill color');
    expect(humanizeAction('booleanOp', ['union'])).toBe('Union');
    expect(humanizeAction('setObjectsTransforms', [[{ id: 'a', x: 1 }, { id: 'b', y: 2 }]])).toBe('Move');
  });

  it('names transforms by the fields they touch', () => {
    expect(transformLabel(['x', 'y'])).toBe('Move');
    expect(transformLabel(['scaleX', 'scaleY'])).toBe('Scale');
    expect(transformLabel(['x', 'rotation'])).toBe('Transform');
    expect(transformLabel([])).toBe('Transform');
  });
});
