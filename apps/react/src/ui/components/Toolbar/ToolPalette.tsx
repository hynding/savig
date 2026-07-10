import { commandShortcutLabel } from '@savig/ui-core';
import { useEditor } from '../../store/store';
import type { ToolMode } from '../../store/store';
import { isMac } from '../../platform';
import { Icon, type IconName } from './ToolbarIcons';
import styles from './ToolPalette.module.css';

const TOOLS: { id: ToolMode; icon: IconName; label: string }[] = [
  { id: 'select', icon: 'select', label: 'Select' },
  { id: 'pen', icon: 'pen', label: 'Pen' },
  { id: 'node', icon: 'node', label: 'Node' },
  { id: 'rect', icon: 'rect', label: 'Rectangle' },
  { id: 'ellipse', icon: 'ellipse', label: 'Ellipse' },
  { id: 'polygon', icon: 'polygon', label: 'Polygon' },
  { id: 'star', icon: 'star', label: 'Star' },
  { id: 'line', icon: 'line', label: 'Line' },
  { id: 'brush', icon: 'brush', label: 'Brush' },
  { id: 'eyedropper', icon: 'eyedropper', label: 'Eyedropper' },
  { id: 'motion', icon: 'motion', label: 'Motion Path' },
];

/** Hover tooltip text: "Rectangle (R)" when the tool has a shortcut, else "Rectangle". The shortcut
 *  is only in the title — aria-label stays the plain name (accessible name; keeps selectors stable). */
function tooltip(commandId: string, label: string): string {
  const key = commandShortcutLabel(commandId, isMac);
  return key ? `${label} (${key})` : label;
}

export function ToolPalette() {
  const activeTool = useEditor((s) => s.activeTool);
  const setActiveTool = useEditor((s) => s.setActiveTool);
  return (
    <div className={styles.bar} role="group" aria-label="Tools">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={styles.btn}
          aria-label={t.label}
          title={tooltip(`tool.${t.id}`, t.label)}
          aria-pressed={activeTool === t.id}
          onClick={() => setActiveTool(t.id)}
        >
          <Icon name={t.icon} />
        </button>
      ))}
    </div>
  );
}
