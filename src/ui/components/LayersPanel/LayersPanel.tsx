import { useRef, useState } from 'react';
import { useEditor } from '../../store/store';
import styles from './LayersPanel.module.css';

export function LayersPanel() {
  const objects = useEditor((s) => s.history.present.objects);
  const selectedId = useEditor((s) => s.selectedObjectId);
  const { selectObject, toggleObjectVisibility, renameObject } = useEditor.getState();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const cancelRef = useRef(false);

  const startEdit = (id: string, name: string) => {
    cancelRef.current = false;
    setDraft(name);
    setEditingId(id);
  };
  // Escape sets cancelRef before calling finishEdit so the keydown path skips the
  // rename; React does not re-fire onBlur once setEditingId(null) unmounts the input,
  // so there is no second commit to guard against here.
  const finishEdit = () => {
    const id = editingId;
    if (id && !cancelRef.current) {
      const trimmed = draft.trim();
      if (trimmed) renameObject(id, trimmed); // empty/whitespace -> keep old name
    }
    cancelRef.current = false;
    setEditingId(null);
  };

  // Front-first: highest zOrder at the top (Figma/Photoshop convention).
  const ordered = [...objects].sort((a, b) => b.zOrder - a.zOrder);

  return (
    <div className={styles.panel} aria-label="Layers">
      <div className={styles.header}>Layers</div>
      {ordered.length === 0 ? (
        <div className={styles.empty}>No objects</div>
      ) : (
        ordered.map((o) => (
          <div
            key={o.id}
            data-testid={`layer-${o.id}`}
            data-selected={o.id === selectedId}
            className={`${styles.row} ${o.id === selectedId ? styles.selected : ''} ${o.hidden ? styles.hidden : ''}`}
            onClick={() => selectObject(o.id)}
          >
            {editingId === o.id ? (
              <input
                data-testid={`rename-${o.id}`}
                aria-label={`Rename ${o.name}`}
                className={styles.nameInput}
                autoFocus
                value={draft}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => setDraft(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onBlur={finishEdit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') finishEdit();
                  else if (e.key === 'Escape') {
                    cancelRef.current = true;
                    finishEdit();
                  }
                }}
              />
            ) : (
              <span className={styles.name} onDoubleClick={() => startEdit(o.id, o.name)}>
                {o.name}
              </span>
            )}
            <button
              data-testid={`vis-${o.id}`}
              aria-label={`${o.name} visibility`}
              aria-pressed={!o.hidden}
              className={styles.eye}
              onClick={(e) => {
                e.stopPropagation();
                toggleObjectVisibility(o.id);
              }}
            >
              {o.hidden ? '▯' : '◉'}
            </button>
          </div>
        ))
      )}
    </div>
  );
}
