import { useEditor } from '../../store/store';
import type { ToolMode } from '../../store/store';
import styles from './ToolPalette.module.css';

const TOOLS: { id: ToolMode; label: string }[] = [
  { id: 'select', label: 'Select' },
  { id: 'rect', label: 'Rectangle' },
  { id: 'ellipse', label: 'Ellipse' },
];

export function ToolPalette() {
  const activeTool = useEditor((s) => s.activeTool);
  const setActiveTool = useEditor((s) => s.setActiveTool);
  return (
    <div className={styles.bar} role="group" aria-label="Tools">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={styles.btn}
          aria-pressed={activeTool === t.id}
          onClick={() => setActiveTool(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
