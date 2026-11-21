// Framework-neutral view-model + intents for the History panel (roadmap 13): the undo steps,
// oldest first, each named by the edit that made it. Clicking a row jumps there; later rows stay
// redoable (shown dimmed) until a new edit replaces them.
import type { EditorState } from '@savig/editor-state';

/** At most this many rows render; the window always keeps the current step in view. */
export const HISTORY_PANEL_MAX_ROWS = 200;

export interface HistoryRowVM {
  /** Position in (past..., present, future...); what jumpToHistory takes. */
  index: number;
  label: string;
  state: 'past' | 'current' | 'future';
}

export interface HistoryVM {
  open: boolean;
  rows: HistoryRowVM[];
  /** Older steps left out of `rows` (over HISTORY_PANEL_MAX_ROWS). */
  hiddenBefore: number;
  /** Newer steps left out of `rows`. */
  hiddenAfter: number;
  /** Steps in all, including the opening state. */
  total: number;
  canUndo: boolean;
  canRedo: boolean;
}

export function historyViewModel(s: EditorState): HistoryVM {
  const h = s.history;
  const l = s.historyLabels;
  const current = h.past.length;
  const total = current + 1 + h.future.length;
  const label = (i: number): string => {
    if (i < current) return l?.past[i - (current - (l?.past.length ?? 0))] ?? 'Edit';
    if (i === current) return l?.present ?? 'Edit';
    return l?.future[i - current - 1] ?? 'Edit';
  };
  const max = HISTORY_PANEL_MAX_ROWS;
  const start = total <= max ? 0 : Math.max(0, Math.min(total - max, current - Math.floor(max / 2)));
  const end = Math.min(total, start + max);
  const rows: HistoryRowVM[] = [];
  for (let i = start; i < end; i++) {
    rows.push({ index: i, label: label(i), state: i < current ? 'past' : i === current ? 'current' : 'future' });
  }
  return {
    open: s.historyPanelOpen,
    rows,
    hiddenBefore: start,
    hiddenAfter: total - end,
    total,
    canUndo: h.past.length > 0,
    canRedo: h.future.length > 0,
  };
}

export interface HistoryStore {
  getState: () => EditorState;
}

export function historyIntents(store: HistoryStore) {
  const s = () => store.getState();
  return {
    jumpTo: (index: number) => s().jumpToHistory(index),
    undo: () => s().undo(),
    redo: () => s().redo(),
    toggleOpen: () => s().toggleHistoryPanel(),
  };
}
