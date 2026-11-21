export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

export function pushHistory<T>(history: History<T>, next: T): History<T> {
  return {
    past: [...history.past, history.present],
    present: next,
    future: [],
  };
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T>(history: History<T>): boolean {
  return history.future.length > 0;
}

export function undo<T>(history: History<T>): History<T> {
  if (!canUndo(history)) return history;
  const previous = history.past[history.past.length - 1];
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redo<T>(history: History<T>): History<T> {
  if (!canRedo(history)) return history;
  const [next, ...rest] = history.future;
  return {
    past: [...history.past, history.present],
    present: next,
    future: rest,
  };
}

/** Total number of states in the history: every past step, the present, and every future step. */
export function historyLength<T>(history: History<T>): number {
  return history.past.length + 1 + history.future.length;
}

/** The present state's position in the full list (past..., present, future...). */
export function historyIndex<T>(history: History<T>): number {
  return history.past.length;
}

/**
 * Jump straight to any state in the full list (past..., present, future...), as the History
 * panel does: everything before `index` becomes the past and everything after it the future,
 * so redo still walks forward from there. An out-of-range index is clamped.
 */
export function jumpHistory<T>(history: History<T>, index: number): History<T> {
  const all = [...history.past, history.present, ...history.future];
  const i = Math.max(0, Math.min(all.length - 1, Math.round(index)));
  if (i === history.past.length) return history;
  return { past: all.slice(0, i), present: all[i]!, future: all.slice(i + 1) };
}
