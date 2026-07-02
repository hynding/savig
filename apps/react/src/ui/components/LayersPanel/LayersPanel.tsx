import { useMemo, useRef, useState } from 'react';
import { store } from '@savig/editor-state';
import { layersPanelViewModel, layersPanelIntents, type LayersPanelRowVM } from '@savig/ui-core';
import { useEditorVM } from '../../store/store';
import styles from './LayersPanel.module.css';

export function LayersPanel() {
  const vm = useEditorVM(layersPanelViewModel);
  const intents = useMemo(() => layersPanelIntents(store), []);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const cancelRef = useRef(false);
  // The in-progress drag's source id lives in a ref (read synchronously by the drag
  // handlers, no stale-closure risk — same pattern as the Stage drag machines); only
  // the drop-target highlight is React state, since it drives the row's CSS class.
  const dragIdRef = useRef<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  // Group rows that are collapsed (their children hidden in the tree). Ephemeral UI state —
  // the VM returns the full uncollapsed tree; collapse is applied here at render time.
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
      if (trimmed) intents.renameObject(id, trimmed); // empty/whitespace -> keep old name
    }
    cancelRef.current = false;
    setEditingId(null);
  };

  // A collapsed group's descendants (any row with depth greater than the collapsed row's) are
  // skipped — mirrors the old recursive "don't recurse into a collapsed group" behavior, just
  // applied as a render-time filter over the VM's full (uncollapsed) row list.
  const rows: LayersPanelRowVM[] = useMemo(() => {
    const out: LayersPanelRowVM[] = [];
    let skipDepth: number | null = null;
    for (const row of vm.rows) {
      if (skipDepth !== null) {
        if (row.depth > skipDepth) continue;
        skipDepth = null;
      }
      out.push(row);
      if (row.isGroup && collapsed.has(row.id)) skipDepth = row.depth;
    }
    return out;
  }, [vm.rows, collapsed]);

  return (
    <div className={styles.panel} aria-label="Layers">
      <div className={styles.header}>Layers</div>
      {rows.length === 0 ? (
        <div className={styles.empty}>No objects</div>
      ) : (
        rows.map((o) => (
          <div
            key={o.id}
            data-testid={`layer-${o.id}`}
            data-depth={o.depth}
            data-selected={o.selected}
            className={`${styles.row} ${o.selected ? styles.selected : ''} ${o.hidden ? styles.hidden : ''} ${o.ownLocked ? styles.locked : ''} ${o.id === dropTargetId ? styles.dropTarget : ''}`}
            style={o.depth ? { paddingLeft: `calc(var(--space-3) + ${o.depth * 16}px)` } : undefined}
            draggable={!o.locked && editingId !== o.id}
            onClick={(e) => {
              if (o.locked) return; // inert: own lock OR an ancestor group is locked
              if (e.shiftKey || e.metaKey || e.ctrlKey) intents.toggleObjectOrGroup(o.id);
              else intents.selectObjectOrGroup(o.id); // selecting a grouped object selects its group
            }}
            onDragStart={(e) => {
              dragIdRef.current = o.id;
              if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(e) => {
              // A locked row (own lock OR a locked ancestor group) is not a valid drop target —
              // reparenting into/around a locked subtree would edit it (cascade).
              if (dragIdRef.current && dragIdRef.current !== o.id && !o.locked) {
                e.preventDefault();
                setDropTargetId(o.id);
              }
            }}
            onDrop={(e) => {
              const draggedId = dragIdRef.current;
              if (draggedId && draggedId !== o.id && !o.locked) {
                e.preventDefault();
                // Drop onto a GROUP row -> reparent INTO it; onto a same-parent leaf -> reorder;
                // onto a different-parent leaf -> join the target's parent (or root) (slice 45f).
                const dragged = vm.rows.find((x) => x.id === draggedId);
                if (o.isGroup) intents.reparentObject(draggedId, o.id);
                else if ((dragged?.parentId ?? null) === (o.parentId ?? null)) intents.moveObjectToTarget(draggedId, o.id);
                else intents.reparentObject(draggedId, o.parentId ?? null);
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
              aria-pressed={o.ownLocked}
              className={styles.eye}
              onClick={(e) => {
                e.stopPropagation();
                intents.toggleObjectLock(o.id);
              }}
            >
              {o.ownLocked ? '🔒' : '🔓'}
            </button>
            <button
              data-testid={`vis-${o.id}`}
              aria-label={`${o.name} visibility`}
              aria-pressed={!o.hidden}
              className={styles.eye}
              onClick={(e) => {
                e.stopPropagation();
                intents.toggleObjectVisibility(o.id);
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
