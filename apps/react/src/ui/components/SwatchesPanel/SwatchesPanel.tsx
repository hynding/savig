// Swatches panel (roadmap 12): the project color palette. Click a swatch to paint the selected
// shapes' fill or stroke (the Fill/Stroke toggle; Shift-click paints the other one). A GLOBAL
// swatch (corner marker) stays linked to what it painted: editing its color recolors them all.
import { useMemo, useState } from 'react';
import { store } from '@savig/editor-state';
import { swatchesViewModel, swatchesIntents } from '@savig/ui-core';
import { useEditorVM } from '../../store/store';
import styles from './SwatchesPanel.module.css';

type Paint = 'fill' | 'stroke';

export function SwatchesPanel() {
  const vm = useEditorVM(swatchesViewModel);
  const intents = useMemo(() => swatchesIntents(store), []);
  const [target, setTarget] = useState<Paint>('fill');
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = vm.swatches.find((s) => s.id === editingId) ?? null;

  const onChip = (id: string, shift: boolean) => {
    setEditingId(id);
    if (vm.canPaint) intents.applySwatch(id, shift ? (target === 'fill' ? 'stroke' : 'fill') : target);
  };

  return (
    <div className={styles.panel} aria-label="Swatches">
      <div className={styles.header}>
        <span className={styles.title}>Swatches</span>
        <div className={styles.target} role="group" aria-label="Swatch paints">
          {(['fill', 'stroke'] as const).map((p) => (
            <button
              key={p}
              type="button"
              data-testid={`swatch-target-${p}`}
              aria-pressed={target === p}
              className={target === p ? styles.on : ''}
              title={p === 'fill' ? 'Swatches paint the fill' : 'Swatches paint the stroke'}
              onClick={() => setTarget(p)}
            >
              {p === 'fill' ? 'Fill' : 'Stroke'}
            </button>
          ))}
        </div>
        <button
          type="button"
          data-testid="swatch-add"
          className={styles.add}
          title="Add a swatch (from the selected shape's fill)"
          aria-label="Add swatch"
          onClick={() => setEditingId(intents.addSwatch())}
        >
          +
        </button>
      </div>
      {vm.swatches.length === 0 ? (
        <div className={styles.empty}>No swatches yet. Select a shape and press + to save its fill.</div>
      ) : (
        <div className={styles.grid}>
          {vm.swatches.map((sw) => (
            <button
              key={sw.id}
              type="button"
              data-testid={`swatch-${sw.id}`}
              data-selected={sw.id === editingId}
              data-global={sw.global}
              className={`${styles.chip} ${sw.id === editingId ? styles.chipSelected : ''} ${sw.global ? styles.global : ''}`}
              style={{ background: sw.color }}
              title={`${sw.name}${sw.global ? ` (global, ${sw.usage} linked)` : ''}`}
              aria-label={`swatch ${sw.name}`}
              onClick={(e) => onChip(sw.id, e.shiftKey)}
            />
          ))}
        </div>
      )}
      {editing && (
        <div className={styles.editor} data-testid="swatch-editor">
          <div className={styles.editRow}>
            <input
              type="color"
              data-testid="swatch-color"
              aria-label="swatch color"
              value={editing.color}
              onChange={(e) => intents.updateSwatch(editing.id, { color: e.target.value })}
            />
            <input
              key={editing.id}
              type="text"
              data-testid="swatch-name"
              aria-label="swatch name"
              className={styles.name}
              defaultValue={editing.name}
              onBlur={(e) => intents.updateSwatch(editing.id, { name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
            />
            <button
              type="button"
              data-testid="swatch-delete"
              aria-label="Delete swatch"
              title="Delete swatch (colors stay as they are)"
              onClick={() => {
                intents.removeSwatch(editing.id);
                setEditingId(null);
              }}
            >
              ×
            </button>
          </div>
          <label className={styles.editRow} title="A global swatch stays linked: changing its color recolors everything painted with it.">
            <input
              type="checkbox"
              data-testid="swatch-global"
              checked={editing.global}
              onChange={(e) => intents.updateSwatch(editing.id, { global: e.target.checked })}
            />
            Global color
            {editing.global && <span className={styles.usage} data-testid="swatch-usage">{editing.usage} linked</span>}
          </label>
        </div>
      )}
    </div>
  );
}
