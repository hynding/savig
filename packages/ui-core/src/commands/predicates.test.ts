import { describe, it, expect, beforeEach } from 'vitest';
import { store } from '@savig/editor-state';
import { canAlign, canDistribute, canBool, canGroup, canCreateSymbol, hasSelection, hasMultiSelection } from './predicates';

beforeEach(() => {
  store.getState().newProject();
});

const addRect = (x: number) => {
  store.getState().addVectorShape('rect', { x, y: 0, width: 10, height: 10 });
  return store.getState().selectedObjectId!;
};

describe('command availability predicates', () => {
  it('hasSelection / hasMultiSelection', () => {
    expect(hasSelection(store.getState())).toBe(false);
    const a = addRect(0);
    expect(hasSelection(store.getState())).toBe(true);
    expect(hasMultiSelection(store.getState())).toBe(false);
    const b = addRect(60);
    store.getState().selectObjects([a, b]);
    expect(hasMultiSelection(store.getState())).toBe(true);
  });

  it('canAlign needs 2 movable; canDistribute needs 3', () => {
    const a = addRect(0);
    const b = addRect(60);
    store.getState().selectObjects([a, b]);
    expect(canAlign(store.getState())).toBe(true);
    expect(canDistribute(store.getState())).toBe(false);
    const c = addRect(120);
    store.getState().selectObjects([a, b, c]);
    expect(canDistribute(store.getState())).toBe(true);
  });

  it('canBool for 2 vector shapes; canGroup for 2 selected', () => {
    const a = addRect(0);
    const b = addRect(5);
    store.getState().selectObjects([a, b]);
    expect(canBool(store.getState())).toBe(true);
    expect(canGroup(store.getState())).toBe(true);
  });

  it('canCreateSymbol for a selected top-level unlocked object', () => {
    addRect(0);
    expect(canCreateSymbol(store.getState())).toBe(true);
  });
});
