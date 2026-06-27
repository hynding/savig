import { useMemo, useRef, useState } from 'react';
import { useEditor } from '../../store/store';
import { selectActiveObjects } from '../../store/selectors';
import { isLockedInTree, type SceneObject } from '../../../engine';
import styles from './LayersPanel.module.css';

export function LayersPanel() {
  const objects = useEditor((s) => selectActiveObjects(s));
  const lockById = useMemo(() => new Map(objects.map((o) => [o.id, o])), [objects]);
  const selectedIds = useEditor((s) => s.selectedObjectIds);
  const { selectObjectOrGroup, toggleObjectOrGroup, toggleObjectVisibility, renameObject, toggleObjectLock, moveObjectToTarget, reparentObject } =
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
  // expanded group's children nested beneath it — recursively for NESTED groups (slice 45c/45e).
  const byZ = (a: SceneObject, b: SceneObject) => b.zOrder - a.zOrder;
  const rows: { obj: SceneObject; depth: number }[] = [];
  const seen = new Set<string>();
  const pushSubtree = (o: SceneObject, depth: number) => {
    if (seen.has(o.id)) return; // cycle guard
    seen.add(o.id);
    rows.push({ obj: o, depth });
    if (o.isGroup && !collapsed.has(o.id)) {
      for (const c of objects.filter((x) => x.parentId === o.id).sort(byZ)) pushSubtree(c, depth + 1);
    }
  };
  for (const o of objects.filter((x) => !x.parentId).sort(byZ)) pushSubtree(o, 0);

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
            className={`${styles.row} ${selectedIds.includes(o.id) ? styles.selected : ''} ${o.hidden ? styles.hidden : ''} ${o.locked ? styles.locked : ''} ${o.id === dropTargetId ? styles.dropTarget : ''}`}
            style={depth ? { paddingLeft: `calc(var(--space-3) + ${depth * 16}px)` } : undefined}
            draggable={!isLockedInTree(o, lockById) && editingId !== o.id}
            onClick={(e) => {
              if (isLockedInTree(o, lockById)) return; // inert: own lock OR an ancestor group is locked
              if (e.shiftKey || e.metaKey || e.ctrlKey) toggleObjectOrGroup(o.id);
              else selectObjectOrGroup(o.id); // selecting a grouped object selects its group
            }}
            onDragStart={(e) => {
              dragIdRef.current = o.id;
              if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(e) => {
              // A locked row (own lock OR a locked ancestor group) is not a valid drop target —
              // reparenting into/around a locked subtree would edit it (cascade).
              if (dragIdRef.current && dragIdRef.current !== o.id && !isLockedInTree(o, lockById)) {
                e.preventDefault();
                setDropTargetId(o.id);
              }
            }}
            onDrop={(e) => {
              const draggedId = dragIdRef.current;
              if (draggedId && draggedId !== o.id && !isLockedInTree(o, lockById)) {
                e.preventDefault();
                // Drop onto a GROUP row -> reparent INTO it; onto a same-parent leaf -> reorder;
                // onto a different-parent leaf -> join the target's parent (or root) (slice 45f).
                const dragged = objects.find((x) => x.id === draggedId);
                if (o.isGroup) reparentObject(draggedId, o.id);
                else if ((dragged?.parentId ?? null) === (o.parentId ?? null)) moveObjectToTarget(draggedId, o.id);
                else reparentObject(draggedId, o.parentId ?? null);
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
