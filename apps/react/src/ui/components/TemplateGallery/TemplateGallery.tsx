import { useEffect, useRef } from 'react';
import { templates } from '@savig/core';
import { confirmReplaceProject } from '../../confirmReplace';
import { useEditor } from '../../store/store';
import styles from './TemplateGallery.module.css';

export function TemplateGallery({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const load = (t: (typeof templates)[number]) => {
    // Loading a template permanently replaces the current project (and, one debounce later,
    // its autosave) — ask first when there is real content to lose. A pristine project loads
    // silently. Cancel keeps the gallery open so the user can pick again or close.
    if (!confirmReplaceProject('Loading a template replaces your current project. Continue?')) return;
    useEditor.getState().setProject(t.build());
    // Announce and demo: the template plays itself once so the user immediately sees the beat.
    useEditor.getState().pushToast('info', `Template "${t.title}" loaded`);
    useEditor.getState().setPlaying(true);
    onClose();
  };

  return (
    <div
      className={styles.backdrop}
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div
        className={styles.gallery}
        role="dialog"
        aria-modal="true"
        aria-label="Template gallery"
        tabIndex={-1}
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <h2 className={styles.h2}>New from template</h2>
          <button className={styles.close} aria-label="Close" onClick={onClose}>×</button>
        </div>
        <ul className={styles.list}>
          {templates.map((t) => (
            <li key={t.id}>
              <button className={styles.card} onClick={() => load(t)}>
                <span className={styles.title}>{t.title}</span>
                <span className={styles.desc}>{t.description}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
