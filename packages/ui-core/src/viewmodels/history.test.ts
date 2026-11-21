import { describe, it, expect, beforeEach } from 'vitest';
import { store } from '@savig/editor-state';
import { historyViewModel, historyIntents, HISTORY_PANEL_MAX_ROWS } from './history';

beforeEach(() => store.getState().newProject());

const square = () => store.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });

describe('historyViewModel (roadmap 13)', () => {
  it('lists every step oldest first, marking past, current and redoable future', () => {
    square();
    store.getState().setProperty('x', 40);
    store.getState().setProperty('rotation', 15);
    store.getState().undo();
    const vm = historyViewModel(store.getState());
    expect(vm.rows.map((r) => [r.index, r.label, r.state])).toEqual([
      [0, 'New document', 'past'],
      [1, 'Draw rect', 'past'],
      [2, 'Move', 'current'],
      [3, 'Rotate', 'future'],
    ]);
    expect(vm).toMatchObject({ total: 4, hiddenBefore: 0, hiddenAfter: 0, canUndo: true, canRedo: true, open: false });
  });

  it('intents jump, undo, redo and toggle the panel', () => {
    square();
    store.getState().setProperty('x', 40);
    const intents = historyIntents(store);
    intents.jumpTo(0);
    expect(historyViewModel(store.getState()).rows[0]!.state).toBe('current');
    intents.redo();
    expect(historyViewModel(store.getState()).rows[1]!.state).toBe('current');
    intents.undo();
    expect(historyViewModel(store.getState()).rows[0]!.state).toBe('current');
    intents.toggleOpen();
    expect(historyViewModel(store.getState()).open).toBe(true);
    // A view preference: survives a new document.
    store.getState().newProject();
    expect(historyViewModel(store.getState()).open).toBe(true);
    intents.toggleOpen();
  });

  it('windows long histories around the current step', () => {
    square();
    for (let i = 0; i < HISTORY_PANEL_MAX_ROWS + 50; i++) store.getState().setProperty('x', i + 1);
    let vm = historyViewModel(store.getState());
    expect(vm.rows).toHaveLength(HISTORY_PANEL_MAX_ROWS);
    expect(vm.rows.at(-1)!.state).toBe('current');
    expect(vm.hiddenBefore).toBe(vm.total - HISTORY_PANEL_MAX_ROWS);
    store.getState().jumpToHistory(3);
    vm = historyViewModel(store.getState());
    expect(vm.rows[0]!.index).toBe(0);
    expect(vm.rows.some((r) => r.state === 'current')).toBe(true);
    expect(vm.hiddenAfter).toBe(vm.total - HISTORY_PANEL_MAX_ROWS);
  });
});
