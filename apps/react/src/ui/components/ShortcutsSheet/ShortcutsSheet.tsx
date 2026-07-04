import { useMemo } from 'react';
import { shortcutsSheetViewModel } from '@savig/ui-core';
import styles from './ShortcutsSheet.module.css';

const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);

export function ShortcutsSheet({ onClose }: { onClose: () => void }) {
  const groups = useMemo(() => shortcutsSheetViewModel(isMac), []);

  return (
    <div
      className={styles.backdrop}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div
        className={styles.sheet}
        role="dialog"
        aria-label="Keyboard shortcuts"
        tabIndex={-1}
        ref={(el) => el?.focus()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <h2 className={styles.h2}>Keyboard shortcuts</h2>
          <button className={styles.close} aria-label="Close" onClick={onClose}>×</button>
        </div>
        <div className={styles.columns}>
          {groups.map((g) => (
            <section key={g.category} className={styles.group}>
              <h3 className={styles.cat}>{g.category}</h3>
              {g.items.map((it) => (
                <div key={it.title} className={styles.row}>
                  <span className={styles.name}>{it.title}</span>
                  <kbd className={styles.kbd}>{it.shortcutLabel}</kbd>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
