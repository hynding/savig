import { describe, expect, test } from 'vitest';
import {
  canRedo,
  canUndo,
  createHistory,
  historyIndex,
  historyLength,
  jumpHistory,
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

  test('undoes multiple steps in LIFO order', () => {
    let h = createHistory(1);
    h = pushHistory(h, 2);
    h = pushHistory(h, 3);
    h = undo(undo(h));
    expect(h.present).toBe(1);
    expect(h.past).toEqual([]);
    expect(h.future).toEqual([2, 3]);
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

  test('jumpHistory moves to any state and keeps the rest redoable', () => {
    let h = createHistory(0);
    for (const n of [1, 2, 3, 4]) h = pushHistory(h, n);
    expect(historyLength(h)).toBe(5);
    expect(historyIndex(h)).toBe(4);
    const back = jumpHistory(h, 1);
    expect(back).toEqual({ past: [0], present: 1, future: [2, 3, 4] });
    expect(redo(back).present).toBe(2);
    expect(jumpHistory(back, 4)).toEqual(h);
    expect(jumpHistory(h, 4)).toBe(h);
    expect(jumpHistory(h, -3).present).toBe(0);
    expect(jumpHistory(h, 99).present).toBe(4);
  });
});
