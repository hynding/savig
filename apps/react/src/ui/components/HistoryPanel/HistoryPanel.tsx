// History panel (roadmap 13): the undo steps, oldest first, each named by the edit that made it.
// Click a row to jump there in one step; the rows after it stay redoable (dimmed) until a new
// edit replaces them. Collapsed by default; the header (or View > Toggle History panel) opens it.
import { useEffect, useMemo, useRef } from 'react';
import { store } from '@savig/editor-state';
import { historyViewModel, historyIntents } from '@savig/ui-core';
import { useEditorVM } from '../../store/store';
import styles from './HistoryPanel.module.css';

export function HistoryPanel() {
  const vm = useEditorVM(historyViewModel);
  const intents = useMemo(() => historyIntents(store), []);
  const currentRef = useRef<HTMLButtonElement | null>(null);
  const current = vm.rows.find((r) => r.state === 'current')?.index;

  // Keep the current step in view as edits are made or undone.
  useEffect(() => {
    currentRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [current, vm.open]);

  return (
    <div className={styles.panel} aria-label="History" data-testid="history-panel">
      <div className={styles.header}>
        <button
          type="button"
          className={styles.toggle}
          data-testid="history-toggle"
          aria-expanded={vm.open}
          title={vm.open ? 'Hide the History panel' : 'Show the History panel'}
          onClick={intents.toggleOpen}
        >
          <span className={styles.chevron} aria-hidden>{vm.open ? '▾' : '▸'}</span>
          History
          <span className={styles.count} data-testid="history-count">{vm.total - 1}</span>
        </button>
        <button type="button" className={styles.step} data-testid="history-undo" aria-label="Undo" title="Undo" disabled={!vm.canUndo} onClick={intents.undo}>
          ↶
        </button>
        <button type="button" className={styles.step} data-testid="history-redo" aria-label="Redo" title="Redo" disabled={!vm.canRedo} onClick={intents.redo}>
          ↷
        </button>
      </div>
      {vm.open && (
        <ol className={styles.list} aria-label="Undo steps">
          {vm.hiddenBefore > 0 && <li className={styles.more}>{vm.hiddenBefore} older steps</li>}
          {vm.rows.map((r) => (
            <li key={r.index}>
              <button
                type="button"
                ref={r.state === 'current' ? currentRef : undefined}
                data-testid={`history-row-${r.index}`}
                data-state={r.state}
                aria-current={r.state === 'current' ? 'step' : undefined}
                className={`${styles.row} ${styles[r.state]}`}
                title={r.state === 'current' ? 'Current state' : r.state === 'future' ? 'Redo to here' : 'Go back to here'}
                onClick={() => intents.jumpTo(r.index)}
              >
                {r.label}
              </button>
            </li>
          ))}
          {vm.hiddenAfter > 0 && <li className={styles.more}>{vm.hiddenAfter} newer steps</li>}
        </ol>
      )}
    </div>
  );
}
