import { useRef, useState } from 'react';
import { useEditor } from '../../store/store';
import type { SceneObject } from '../../../engine';
import styles from './LayersPanel.module.css';

export function LayersPanel() {
  const objects = useEditor((s) => s.history.present.objects);
  const selectedIds = useEditor((s) => s.selectedObjectIds);
  const { selectObjectOrGroup, toggleObjectOrGroup, toggleObjectVisibility, renameObject, toggleObjectLock, moveObjectToTarget } =
    useEditor.getState();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const cancelRef = useRef(false);
  // The in-progress drag's source id lives in a ref (read synchronously by the drag
  // handlers, no stale-closure risk — same pattern as the Stage drag machines); only
  // the drop-target highlight is React state, since it drives the row's CSS class.
  const dragIdRef = useRef<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  // Group rows that are collapsed (their children hidden in the tree). Ephemeral UI state.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapsed = (id: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

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

  // Front-first tree (Figma/Photoshop convention): top-level rows by zOrder desc, with each
  // expanded group's children nested (depth 1) directly beneath it (slice 45c).
  const byZ = (a: SceneObject, b: SceneObject) => b.zOrder - a.zOrder;
  const rows: { obj: SceneObject; depth: number }[] = [];
  for (const o of objects.filter((x) => !x.parentId).sort(byZ)) {
    rows.push({ obj: o, depth: 0 });
    if (o.isGroup && !collapsed.has(o.id)) {
      for (const c of objects.filter((x) => x.parentId === o.id).sort(byZ)) {
        rows.push({ obj: c, depth: 1 });
      }
    }
  }

  return (
    <div className={styles.panel} aria-label="Layers">
      <div className={styles.header}>Layers</div>
      {rows.length === 0 ? (
        <div className={styles.empty}>No objects</div>
      ) : (
        rows.map(({ obj: o, depth }) => (
          <div
            key={o.id}
            data-testid={`layer-${o.id}`}
            data-depth={depth}
            data-selected={selectedIds.includes(o.id)}
            className={`${styles.row} ${depth ? styles.child : ''} ${selectedIds.includes(o.id) ? styles.selected : ''} ${o.hidden ? styles.hidden : ''} ${o.locked ? styles.locked : ''} ${o.id === dropTargetId ? styles.dropTarget : ''}`}
            draggable={!o.locked && editingId !== o.id}
            onClick={(e) => {
              if (o.locked) return;
              if (e.shiftKey || e.metaKey || e.ctrlKey) toggleObjectOrGroup(o.id);
              else selectObjectOrGroup(o.id); // slice 42: selecting a grouped object selects its group
            }}
            onDragStart={(e) => {
              dragIdRef.current = o.id;
              if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(e) => {
              if (dragIdRef.current && dragIdRef.current !== o.id) {
                e.preventDefault();
                setDropTargetId(o.id);
              }
            }}
            onDrop={(e) => {
              const draggedId = dragIdRef.current;
              if (draggedId) {
                e.preventDefault();
                moveObjectToTarget(draggedId, o.id);
              }
              dragIdRef.current = null;
              setDropTargetId(null);
            }}
            onDragEnd={() => {
              dragIdRef.current = null;
              setDropTargetId(null);
            }}
          >
            {o.isGroup && (
              <button
                data-testid={`disclosure-${o.id}`}
                aria-label={`${o.name} ${collapsed.has(o.id) ? 'expand' : 'collapse'}`}
                className={styles.disclosure}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleCollapsed(o.id);
                }}
              >
                {collapsed.has(o.id) ? '▸' : '▾'}
              </button>
            )}
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
              data-testid={`lock-${o.id}`}
              aria-label={`${o.name} lock`}
              aria-pressed={!!o.locked}
              className={styles.eye}
              onClick={(e) => {
                e.stopPropagation();
                toggleObjectLock(o.id);
              }}
            >
              {o.locked ? '🔒' : '🔓'}
            </button>
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
