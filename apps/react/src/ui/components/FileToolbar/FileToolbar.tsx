import { useEditor } from '../../store/store';
import * as fileOps from '../../fileOps';
import styles from './FileToolbar.module.css';

export function FileToolbar() {
  const { newProject } = useEditor.getState();

  return (
    <div className={styles.bar}>
      <button className={styles.btn} onClick={newProject}>New</button>
      <button className={styles.btn} onClick={() => void fileOps.openProject()}>Open</button>
      <button className={styles.btn} onClick={() => void fileOps.saveProject()}>Save</button>
      <span className={styles.sep} />
      <button className={styles.btn} onClick={() => void fileOps.exportProject()}>Export</button>
    </div>
  );
}
