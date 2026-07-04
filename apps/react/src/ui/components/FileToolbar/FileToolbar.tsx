import { commandShortcutLabel } from '@savig/ui-core';
import { useEditor } from '../../store/store';
import * as fileOps from '../../fileOps';
import { isMac } from '../../platform';
import { Icon } from '../Toolbar/ToolbarIcons';
import styles from './FileToolbar.module.css';

/** Hover tooltip: "Save (⌘S)" when the action has a shortcut, else the plain label. aria-label stays
 *  the plain label (accessible name; keeps `getByRole({ name })` selectors stable). */
function tooltip(commandId: string, label: string): string {
  const key = commandShortcutLabel(commandId, isMac);
  return key ? `${label} (${key})` : label;
}

export function FileToolbar() {
  const { newProject } = useEditor.getState();

  return (
    <div className={styles.bar}>
      <button className={styles.btn} aria-label="New" title={tooltip('file.new', 'New')} onClick={newProject}>
        <Icon name="new" />
      </button>
      <button className={styles.btn} aria-label="Open" title={tooltip('file.open', 'Open')} onClick={() => void fileOps.openProject()}>
        <Icon name="open" />
      </button>
      <button className={styles.btn} aria-label="Save" title={tooltip('file.save', 'Save')} onClick={() => void fileOps.saveProject()}>
        <Icon name="save" />
      </button>
      <span className={styles.sep} />
      <button className={styles.btn} aria-label="Export" title={tooltip('file.export', 'Export')} onClick={() => void fileOps.exportProject()}>
        <Icon name="export" />
      </button>
    </div>
  );
}
