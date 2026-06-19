import { describe, expect, test } from 'vitest';
import {
  canRedo,
  canUndo,
  createHistory,
  pushHistory,
  redo,
  undo,
} from './history';

describe('history', () => {
  test('starts with the given present and no past/future', () => {
    const h = createHistory(1);
    expect(h.present).toBe(1);
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
  });

  test('push moves present to past and clears future', () => {
    let h = createHistory(1);
    h = pushHistory(h, 2);
    expect(h.present).toBe(2);
    expect(h.past).toEqual([1]);
    expect(h.future).toEqual([]);
  });

  test('undo and redo move between states', () => {
    let h = createHistory(1);
    h = pushHistory(h, 2);
    h = pushHistory(h, 3);
    h = undo(h);
    expect(h.present).toBe(2);
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(h.present).toBe(3);
  });

  test('a new push after undo clears the redo future', () => {
    let h = createHistory(1);
    h = pushHistory(h, 2);
    h = undo(h);
    h = pushHistory(h, 99);
    expect(h.present).toBe(99);
    expect(canRedo(h)).toBe(false);
  });

  test('undo and redo are no-ops at the ends', () => {
    const h = createHistory(1);
    expect(undo(h)).toEqual(h);
    expect(redo(h)).toEqual(h);
  });
});
