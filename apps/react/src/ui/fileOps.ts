// Browser file operations (open/save/export) shared by the FileToolbar buttons and the CommandHost.
// These live in the app (not neutral packages) because they touch browser file-picker APIs.
import {
  exportProject as buildExportBundle,
  loadSavig,
  openBytesFromDisk,
  saveBytesToDisk,
  saveSavig,
} from '@savig/services';
import { useEditor } from './store/store';

export async function saveProject(): Promise<void> {
  const s = useEditor.getState();
  try {
    const bytes = saveSavig({ project: s.history.present, binaries: s.binaries });
    await saveBytesToDisk(bytes, `${s.history.present.meta.name}.savig`, 'application/zip');
  } catch (err) {
    useEditor.getState().pushToast('error', `Save failed: ${(err as Error).message}`);
  }
}

export async function openProject(): Promise<void> {
  try {
    const picked = await openBytesFromDisk('.savig');
    if (!picked) return;
    const file = loadSavig(picked.bytes);
    useEditor.getState().setProject(file.project, file.binaries);
  } catch (err) {
    useEditor.getState().pushToast('error', (err as Error).message);
  }
}

export async function exportProject(): Promise<void> {
  const s = useEditor.getState();
  try {
    const bytes = buildExportBundle(s.history.present, s.binaries);
    await saveBytesToDisk(bytes, `${s.history.present.meta.name}.zip`, 'application/zip');
  } catch (err) {
    useEditor.getState().pushToast('error', `Export failed: ${(err as Error).message}`);
  }
}
