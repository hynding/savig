/** Headless library-folder verbs (roadmap 11). Folders organize the asset library (imported SVGs,
 *  pictures, sounds, symbols) for a person working in the editor; nothing is rendered or exported.
 *  Thin, fail-loud wrappers over the engine's pure folder operations. */
import {
  createLibraryFolder as engineCreate,
  deleteLibraryFolder as engineDelete,
  isLibraryItem,
  libraryFolders,
  moveToLibraryFolder as engineMove,
  renameLibraryFolder as engineRename,
  folderWithin,
} from '@savig/engine';
import type { Project } from '@savig/engine';

function requireFolder(project: Project, folderId: string): void {
  if (!libraryFolders(project).some((f) => f.id === folderId)) throw new Error(`savig/core: unknown library folder "${folderId}"`);
}

/** Add a library folder. `id` defaults to the first free `folder1`, `folder2`…; `parentId` nests it. */
export function createLibraryFolder(project: Project, opts: { name: string; parentId?: string; id?: string }): { project: Project; id: string } {
  const taken = new Set(libraryFolders(project).map((f) => f.id));
  let id = opts.id;
  if (!id) {
    let n = 1;
    while (taken.has(`folder${n}`)) n++;
    id = `folder${n}`;
  }
  if (opts.parentId !== undefined) requireFolder(project, opts.parentId);
  return { project: engineCreate(project, { id, name: opts.name, parentId: opts.parentId }), id };
}

export function renameLibraryFolder(project: Project, folderId: string, name: string): Project {
  requireFolder(project, folderId);
  return engineRename(project, folderId, name);
}

/** Delete a folder; its items and sub-folders move up to its parent. */
export function deleteLibraryFolder(project: Project, folderId: string): Project {
  requireFolder(project, folderId);
  return engineDelete(project, folderId);
}

/** Move library items (asset ids) and/or folders into `folderId` (null = library root). Every id
 *  must be a library item or a folder, and a folder can't go inside itself. */
export function moveToLibraryFolder(project: Project, ids: readonly string[], folderId: string | null): Project {
  if (folderId !== null) requireFolder(project, folderId);
  const folders = libraryFolders(project);
  for (const id of ids) {
    const folder = folders.find((f) => f.id === id);
    if (folder) {
      if (folderId !== null && folderWithin(folders, folderId, id)) throw new Error(`savig/core: can't move folder "${id}" inside itself`);
      continue;
    }
    const asset = project.assets.find((a) => a.id === id);
    if (!asset) throw new Error(`savig/core: unknown asset or folder "${id}"`);
    if (!isLibraryItem(asset)) throw new Error(`savig/core: "${id}" is a ${asset.kind} asset, not a library item (only SVGs, images, sounds and symbols are filed)`);
  }
  return engineMove(project, [...ids], folderId);
}
