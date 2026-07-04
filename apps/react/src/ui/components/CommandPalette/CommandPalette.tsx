import { useMemo, useRef, useState } from 'react';
import { COMMANDS, commandPaletteViewModel, type CommandHost } from '@savig/ui-core';
import { useEditor } from '../../store/store';
import styles from './CommandPalette.module.css';

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);
const commandById = new Map(COMMANDS.map((c) => [c.id, c]));

export function CommandPalette({ host, onClose }: { host: CommandHost; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const results = useMemo(
    () => commandPaletteViewModel(useEditor.getState(), query, isMac),
    [query],
  );
  const clampedActive = Math.min(active, Math.max(0, results.length - 1));

  const run = (id: string) => {
    const cmd = commandById.get(id);
    const result = results.find((r) => r.id === id);
    if (!cmd || !result?.enabled) return;
    cmd.run({ state: useEditor.getState(), host });
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const r = results[clampedActive];
      if (r) run(r.id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Tab') {
      // Focus trap: the palette has one focusable control (the input), so keep focus here.
      e.preventDefault();
    }
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={styles.palette}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          className={styles.input}
          aria-label="Command search"
          placeholder="Search commands…"
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        <ul className={styles.list} ref={listRef} role="listbox" aria-activedescendant={results[clampedActive]?.id}>
          {results.map((r, i) => (
            <li
              key={r.id}
              id={r.id}
              role="option"
              aria-selected={i === clampedActive}
              aria-disabled={!r.enabled}
              className={`${styles.item} ${i === clampedActive ? styles.active : ''} ${r.enabled ? '' : styles.disabled}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => run(r.id)}
            >
              <span className={styles.title}>{r.title}</span>
              <span className={styles.meta}>
                {r.enabled ? r.shortcutLabel : r.unavailableHint}
              </span>
            </li>
          ))}
          {results.length === 0 && <li className={styles.empty}>No matching commands</li>}
        </ul>
      </div>
    </div>
  );
}
