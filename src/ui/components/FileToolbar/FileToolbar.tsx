import {
  exportProject, loadSavig, openBytesFromDisk, saveBytesToDisk, saveSavig,
} from '../../../services';
import { useEditor } from '../../store/store';
import styles from './FileToolbar.module.css';

export function FileToolbar() {
  const { newProject, setProject, pushToast } = useEditor.getState();

  const onSave = async () => {
    const s = useEditor.getState();
    try {
      const bytes = saveSavig({ project: s.history.present, binaries: s.binaries });
      await saveBytesToDisk(bytes, `${s.history.present.meta.name}.savig`, 'application/zip');
    } catch (err) {
      pushToast('error', `Save failed: ${(err as Error).message}`);
    }
  };

  const onOpen = async () => {
    try {
      const picked = await openBytesFromDisk('.savig');
      if (!picked) return;
      const file = loadSavig(picked.bytes);
      setProject(file.project, file.binaries);
    } catch (err) {
      pushToast('error', (err as Error).message);
    }
  };

  const onExport = async () => {
    const s = useEditor.getState();
    try {
      const bytes = exportProject(s.history.present, s.binaries);
      await saveBytesToDisk(bytes, `${s.history.present.meta.name}.zip`, 'application/zip');
    } catch (err) {
      pushToast('error', `Export failed: ${(err as Error).message}`);
    }
  };

  return (
    <div className={styles.bar}>
      <button className={styles.btn} onClick={newProject}>New</button>
      <button className={styles.btn} onClick={() => void onOpen()}>Open</button>
      <button className={styles.btn} onClick={() => void onSave()}>Save</button>
      <span className={styles.sep} />
      <button className={styles.btn} onClick={() => void onExport()}>Export</button>
    </div>
  );
}
