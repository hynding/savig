// Library folders (roadmap 11): thin store wrappers over the engine's pure folder operations.
// Folders live on the root project (like assets), so they are shared by every scene and symbol.
import { createLibraryFolder, deleteLibraryFolder, libraryFolders, moveToLibraryFolder, newId, renameLibraryFolder } from '@savig/engine';
import type { Project } from '@savig/engine';
import type { SliceCreator, StoreGet } from '../store-internals';

type FolderKeys = 'createLibraryFolder' | 'renameLibraryFolder' | 'deleteLibraryFolder' | 'moveToLibraryFolder';

function commitIfChanged(get: StoreGet, next: Project): void {
  if (next !== get().history.present) get().commit(next);
}

/** "Folder", then "Folder 2", "Folder 3"… among the folder's siblings. */
function nextFolderName(project: Project, parentId: string | undefined): string {
  const taken = new Set(libraryFolders(project).filter((f) => f.parentId === parentId).map((f) => f.name));
  if (!taken.has('Folder')) return 'Folder';
  let n = 2;
  while (taken.has(`Folder ${n}`)) n++;
  return `Folder ${n}`;
}

export const createLibraryFolderSlice: SliceCreator<FolderKeys> = (_set, get) => ({
  createLibraryFolder(name, parentId) {
    const project = get().history.present;
    const parent = parentId && libraryFolders(project).some((f) => f.id === parentId) ? parentId : undefined;
    const id = newId();
    const label = name?.trim() ? name : nextFolderName(project, parent);
    get().commit(createLibraryFolder(project, { id, name: label, parentId: parent }));
    return id;
  },

  renameLibraryFolder(folderId, name) {
    commitIfChanged(get, renameLibraryFolder(get().history.present, folderId, name));
  },

  deleteLibraryFolder(folderId) {
    commitIfChanged(get, deleteLibraryFolder(get().history.present, folderId));
  },

  moveToLibraryFolder(ids, folderId) {
    const project = get().history.present;
    if (folderId !== null && !libraryFolders(project).some((f) => f.id === folderId)) return;
    commitIfChanged(get, moveToLibraryFolder(project, ids, folderId));
  },
});
