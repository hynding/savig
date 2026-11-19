// Library folders (roadmap 11): organize the asset library (imported SVGs, pictures, sounds and
// symbols) into nestable folders, as Flash's Library does. Pure Project -> Project operations shared
// by the editor store and @savig/core; editor chrome only, never rendered or exported.
import type { Asset, AudioAsset, ImageAsset, LibraryFolder, Project, SvgAsset, SymbolAsset } from './types';

/** An asset the library lists (and so can file into a folder). Vector and text assets are 1:1
 *  with their object and never appear in the library. */
export type LibraryItem = SvgAsset | AudioAsset | ImageAsset | SymbolAsset;

export function isLibraryItem(a: Asset): a is LibraryItem {
  return a.kind === 'svg' || a.kind === 'audio' || a.kind === 'image' || a.kind === 'symbol';
}

export function libraryFolders(project: Project): LibraryFolder[] {
  return project.libraryFolders ?? [];
}

/** True when `folderId` is `ancestorId` or nested (at any depth) inside it. */
export function folderWithin(folders: LibraryFolder[], folderId: string | undefined, ancestorId: string): boolean {
  const byId = new Map(folders.map((f) => [f.id, f] as const));
  const seen = new Set<string>();
  for (let id = folderId; id !== undefined && !seen.has(id); id = byId.get(id)?.parentId) {
    if (id === ancestorId) return true;
    seen.add(id);
  }
  return false;
}

/** Folder names are trimmed; an empty name becomes "Folder". */
export function folderName(name: string): string {
  return name.trim() || 'Folder';
}

function withFolders(project: Project, folders: LibraryFolder[]): Project {
  const out: Project = { ...project, libraryFolders: folders };
  if (folders.length === 0) delete out.libraryFolders;
  return out;
}

function setItemFolder<T extends Asset>(a: T, folderId: string | undefined): T {
  if (!isLibraryItem(a) || a.folderId === folderId) return a;
  const next = { ...a } as T & { folderId?: string };
  if (folderId === undefined) delete next.folderId;
  else next.folderId = folderId;
  return next;
}

/** Add a folder (at the root, or inside `parentId` when that folder exists). */
export function createLibraryFolder(project: Project, folder: { id: string; name: string; parentId?: string | null }): Project {
  const folders = libraryFolders(project);
  if (folders.some((f) => f.id === folder.id)) throw new Error(`savig: library folder "${folder.id}" already exists`);
  const f: LibraryFolder = { id: folder.id, name: folderName(folder.name) };
  if (folder.parentId) {
    if (!folders.some((x) => x.id === folder.parentId)) throw new Error(`savig: unknown library folder "${folder.parentId}"`);
    f.parentId = folder.parentId;
  }
  return withFolders(project, [...folders, f]);
}

export function renameLibraryFolder(project: Project, folderId: string, name: string): Project {
  const folders = libraryFolders(project);
  const f = folders.find((x) => x.id === folderId);
  if (!f || f.name === folderName(name)) return project;
  return withFolders(project, folders.map((x) => (x.id === folderId ? { ...x, name: folderName(name) } : x)));
}

/** Remove a folder without losing anything: its items and sub-folders move up to its parent. */
export function deleteLibraryFolder(project: Project, folderId: string): Project {
  const folders = libraryFolders(project);
  const f = folders.find((x) => x.id === folderId);
  if (!f) return project;
  const kept = folders
    .filter((x) => x.id !== folderId)
    .map((x) => {
      if (x.parentId !== folderId) return x;
      const next = { ...x };
      if (f.parentId) next.parentId = f.parentId;
      else delete next.parentId;
      return next;
    });
  const assets = project.assets.map((a) => (isLibraryItem(a) && a.folderId === folderId ? setItemFolder(a, f.parentId) : a));
  return { ...withFolders(project, kept), assets };
}

/** Move library items and/or folders into `folderId` (null = root). A folder is never moved into
 *  itself or its own sub-folder; unknown ids and non-library assets are skipped. */
export function moveToLibraryFolder(project: Project, ids: string[], folderId: string | null): Project {
  const folders = libraryFolders(project);
  const target = folderId ?? undefined;
  if (target !== undefined && !folders.some((f) => f.id === target)) throw new Error(`savig: unknown library folder "${target}"`);
  const want = new Set(ids);
  let changed = false;
  const nextFolders = folders.map((f) => {
    if (!want.has(f.id) || f.parentId === target) return f;
    if (target !== undefined && folderWithin(folders, target, f.id)) return f; // would nest into itself
    changed = true;
    const next = { ...f };
    if (target === undefined) delete next.parentId;
    else next.parentId = target;
    return next;
  });
  const assets = project.assets.map((a) => {
    if (!want.has(a.id) || !isLibraryItem(a) || a.folderId === target) return a;
    changed = true;
    return setItemFolder(a, target);
  });
  if (!changed) return project;
  return { ...withFolders(project, nextFolders), assets };
}

/** Load-time repair: drop malformed or duplicate folders, lift folders whose parent is missing or
 *  that sit in a parent cycle to the root, and clear item `folderId`s that name no folder. */
export function sanitizeLibraryFolders(project: Project): Project {
  // Malformed asset lists are another sanitizer's concern (and must not throw here).
  if (!Array.isArray(project.assets)) return project;
  const hasField = 'libraryFolders' in project;
  const raw: unknown = project.libraryFolders;
  const seen = new Set<string>();
  const folders: LibraryFolder[] = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (typeof o.id !== 'string' || !o.id || seen.has(o.id)) continue;
    seen.add(o.id);
    const f: LibraryFolder = { id: o.id, name: folderName(typeof o.name === 'string' ? o.name : '') };
    if (typeof o.parentId === 'string' && o.parentId) f.parentId = o.parentId;
    folders.push(f);
  }
  const ids = new Set(folders.map((f) => f.id));
  for (const f of folders) if (f.parentId !== undefined && !ids.has(f.parentId)) delete f.parentId;
  // Break cycles: walk each chain; a folder that reaches itself is lifted to the root.
  for (const f of folders) {
    if (f.parentId !== undefined && folderWithin(folders, f.parentId, f.id)) delete f.parentId;
  }
  const needsAssetFix = project.assets.some((a) => isLibraryItem(a) && a.folderId !== undefined && !ids.has(a.folderId));
  if (!hasField && !needsAssetFix) return project;
  const assets = needsAssetFix
    ? project.assets.map((a) => (isLibraryItem(a) && a.folderId !== undefined && !ids.has(a.folderId) ? setItemFolder(a, undefined) : a))
    : project.assets;
  return { ...withFolders(project, folders), assets };
}
