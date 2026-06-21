import { useEditor } from '../../store/store';
import styles from './LayersPanel.module.css';

export function LayersPanel() {
  const objects = useEditor((s) => s.history.present.objects);
  const selectedId = useEditor((s) => s.selectedObjectId);
  const { selectObject, toggleObjectVisibility } = useEditor.getState();

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
            <span className={styles.name}>{o.name}</span>
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
