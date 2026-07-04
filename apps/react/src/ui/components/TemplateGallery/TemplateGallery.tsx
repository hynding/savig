import { useEffect, useRef } from 'react';
import { templates } from '@savig/core';
import { useEditor } from '../../store/store';
import styles from './TemplateGallery.module.css';

export function TemplateGallery({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const load = (id: string) => {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    useEditor.getState().setProject(t.build());
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
              <button className={styles.card} onClick={() => load(t.id)}>
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
