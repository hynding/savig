// Browser file operations (open/save/export) shared by the FileToolbar buttons and the CommandHost.
// These live in the app (not neutral packages) because they touch browser file-picker APIs.
import {
  exportProject as buildExportBundle,
  importSvg,
  loadProjectOrSvg,
  openBytesFromDisk,
  saveBytesToDisk,
  saveSavig,
} from '@savig/services';
import { renderProjectDocument } from '@savig/services/export/renderDocument';
import { renderAnimatedSvgDocument } from '@savig/services/export/animatedSvg';
import { createProject, createSceneObject } from '@savig/engine';
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

/** Open a .savig archive, an exported animated SVG with an embedded project (round-trip),
 *  or a plain SVG — wrapped as a new single-asset project (spec goal 3). The wrapped asset
 *  keeps any safe SMIL (sanitizer), so an animated SVG plays as a black box immediately. */
export async function openProject(): Promise<void> {
  try {
    const picked = await openBytesFromDisk('.savig,.svg');
    if (!picked) return;
    const opened = loadProjectOrSvg(picked.bytes);
    if (opened.kind === 'project') {
      useEditor.getState().setProject(opened.file.project, opened.file.binaries);
      return;
    }
    const { asset, warnings } = importSvg(opened.source, picked.name);
    const project = createProject({
      name: picked.name.replace(/\.svg$/i, ''),
      width: Math.round(asset.width),
      height: Math.round(asset.height),
    });
    project.assets.push(asset);
    project.objects.push(createSceneObject(asset.id, { name: asset.name }));
    useEditor.getState().setProject(project, {});
    const s = useEditor.getState();
    warnings.forEach((w) => s.pushToast('info', w));
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

/** Export a static SVG snapshot (frame 0) of the whole project. renderProjectDocument routes
 *  multi-scene projects correctly (renderSvgDocument alone reads the empty root objects → blank).
 *  The markup needs the runtime to animate — for a fully animated artifact use the .zip bundle. */
export async function exportSvg(): Promise<void> {
  const project = useEditor.getState().history.present;
  try {
    const markup = renderProjectDocument(project);
    const bytes = new TextEncoder().encode(markup);
    await saveBytesToDisk(bytes, `${project.meta.name}.svg`, 'image/svg+xml');
  } catch (err) {
    useEditor.getState().pushToast('error', `SVG export failed: ${(err as Error).message}`);
  }
}

/** Export a single-file SMIL-animated SVG — plays anywhere, including <img>/READMEs.
 *  Audio (bundle-only) and script interactivity are inherently absent from this artifact. */
export async function exportAnimatedSvg(): Promise<void> {
  const { history, binaries } = useEditor.getState();
  const project = history.present;
  try {
    const markup = renderAnimatedSvgDocument(project, undefined, binaries);
    const bytes = new TextEncoder().encode(markup);
    await saveBytesToDisk(bytes, `${project.meta.name}.svg`, 'image/svg+xml');
  } catch (err) {
    useEditor.getState().pushToast('error', `Animated SVG export failed: ${(err as Error).message}`);
  }
}
