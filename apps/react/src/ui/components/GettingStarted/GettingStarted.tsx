import { gettingStartedViewModel } from '@savig/ui-core';
import { useEditorVM } from '../../store/store';
import styles from './GettingStarted.module.css';

export function GettingStarted({ onDismiss }: { onDismiss: () => void }) {
  const vm = useEditorVM(gettingStartedViewModel);

  return (
    <aside className={styles.card} aria-label="Getting started">
      <div className={styles.header}>
        <strong>Getting started</strong>
        <span className={styles.count}>
          {vm.doneCount}/{vm.total}
        </span>
        <button className={styles.close} aria-label="Dismiss getting started" onClick={onDismiss}>
          ×
        </button>
      </div>
      <ul className={styles.list}>
        {vm.items.map((it) => (
          <li key={it.id} className={it.done ? styles.done : undefined} data-done={it.done}>
            <span className={styles.check} aria-hidden>
              {it.done ? '✓' : '○'}
            </span>
            {it.label}
          </li>
        ))}
      </ul>
      {vm.allDone && <p className={styles.congrats}>You&rsquo;ve got the basics 🎉</p>}
    </aside>
  );
}
