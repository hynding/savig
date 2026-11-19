import { describe, expect, it } from 'vitest';
import { createProject } from './project';
import type { Asset, Project } from './types';
import {
  createLibraryFolder, deleteLibraryFolder, folderWithin, isLibraryItem, moveToLibraryFolder, renameLibraryFolder, sanitizeLibraryFolders,
} from './libraryFolders';

const svg = (id: string, folderId?: string): Asset => ({
  id, kind: 'svg', name: id, normalizedContent: '<svg/>', viewBox: '0 0 1 1', width: 1, height: 1, ...(folderId ? { folderId } : {}),
});
const sym = (id: string): Asset => ({ id, kind: 'symbol', name: id, objects: [] } as unknown as Asset);
const vec = (id: string): Asset => ({ id, kind: 'vector', name: id } as unknown as Asset);

function base(): Project {
  return { ...createProject(), assets: [svg('a'), svg('b'), sym('s'), vec('v')] };
}
const folderOf = (p: Project, id: string) => (p.assets.find((x) => x.id === id) as { folderId?: string }).folderId;

describe('library folders', () => {
  it('isLibraryItem covers svg/audio/image/symbol only', () => {
    expect(isLibraryItem(svg('x'))).toBe(true);
    expect(isLibraryItem(sym('x'))).toBe(true);
    expect(isLibraryItem(vec('x'))).toBe(false);
  });

  it('creates root and nested folders, trimming names; rejects duplicates and unknown parents', () => {
    let p = createLibraryFolder(base(), { id: 'f1', name: '  Characters ' });
    p = createLibraryFolder(p, { id: 'f2', name: '', parentId: 'f1' });
    expect(p.libraryFolders).toEqual([{ id: 'f1', name: 'Characters' }, { id: 'f2', name: 'Folder', parentId: 'f1' }]);
    expect(() => createLibraryFolder(p, { id: 'f1', name: 'x' })).toThrow(/already exists/);
    expect(() => createLibraryFolder(p, { id: 'f3', name: 'x', parentId: 'nope' })).toThrow(/unknown library folder/);
  });

  it('renames (no-op for the same name or an unknown id)', () => {
    const p = createLibraryFolder(base(), { id: 'f1', name: 'A' });
    expect(renameLibraryFolder(p, 'f1', 'B').libraryFolders![0].name).toBe('B');
    expect(renameLibraryFolder(p, 'f1', 'A')).toBe(p);
    expect(renameLibraryFolder(p, 'zz', 'B')).toBe(p);
  });

  it('moves items and folders, skipping vector assets and refusing to nest a folder into itself', () => {
    let p = createLibraryFolder(base(), { id: 'f1', name: 'A' });
    p = createLibraryFolder(p, { id: 'f2', name: 'B', parentId: 'f1' });
    p = moveToLibraryFolder(p, ['a', 's', 'v'], 'f2');
    expect([folderOf(p, 'a'), folderOf(p, 's'), folderOf(p, 'v'), folderOf(p, 'b')]).toEqual(['f2', 'f2', undefined, undefined]);
    // f1 into its own child f2: refused (no change).
    expect(moveToLibraryFolder(p, ['f1'], 'f2')).toBe(p);
    // Back to the root removes the field.
    const q = moveToLibraryFolder(p, ['a', 'f2'], null);
    expect('folderId' in q.assets.find((x) => x.id === 'a')!).toBe(false);
    expect(q.libraryFolders!.find((f) => f.id === 'f2')!.parentId).toBeUndefined();
    expect(() => moveToLibraryFolder(p, ['a'], 'nope')).toThrow(/unknown library folder/);
  });

  it('deleting a folder moves its items and sub-folders up to its parent', () => {
    let p = createLibraryFolder(base(), { id: 'f1', name: 'A' });
    p = createLibraryFolder(p, { id: 'f2', name: 'B', parentId: 'f1' });
    p = createLibraryFolder(p, { id: 'f3', name: 'C', parentId: 'f2' });
    p = moveToLibraryFolder(p, ['a'], 'f2');
    p = deleteLibraryFolder(p, 'f2');
    expect(p.libraryFolders).toEqual([{ id: 'f1', name: 'A' }, { id: 'f3', name: 'C', parentId: 'f1' }]);
    expect(folderOf(p, 'a')).toBe('f1');
    // Deleting the last root folder: items go to the root and the field disappears.
    p = deleteLibraryFolder(deleteLibraryFolder(p, 'f1'), 'f3');
    expect(p.libraryFolders).toBeUndefined();
    expect(folderOf(p, 'a')).toBeUndefined();
  });

  it('folderWithin follows parent chains and survives cycles', () => {
    const folders = [{ id: 'a', name: 'a' }, { id: 'b', name: 'b', parentId: 'a' }, { id: 'c', name: 'c', parentId: 'b' }];
    expect(folderWithin(folders, 'c', 'a')).toBe(true);
    expect(folderWithin(folders, 'a', 'c')).toBe(false);
    expect(folderWithin([{ id: 'x', name: 'x', parentId: 'y' }, { id: 'y', name: 'y', parentId: 'x' }], 'x', 'z')).toBe(false);
  });

  it('sanitize drops junk, lifts orphans and cycles to the root, and clears dangling item folders', () => {
    const p = {
      ...base(),
      assets: [svg('a', 'gone'), svg('b', 'ok')],
      libraryFolders: [
        { id: 'ok', name: 'OK' }, { id: 'ok', name: 'dup' }, null, { name: 'no id' },
        { id: 'orphan', name: 'O', parentId: 'missing' },
        { id: 'x', name: 'X', parentId: 'y' }, { id: 'y', name: 'Y', parentId: 'x' },
      ],
    } as unknown as Project;
    const s = sanitizeLibraryFolders(p);
    expect(s.libraryFolders!.map((f) => f.id)).toEqual(['ok', 'orphan', 'x', 'y']);
    expect(s.libraryFolders!.find((f) => f.id === 'orphan')!.parentId).toBeUndefined();
    const x = s.libraryFolders!.find((f) => f.id === 'x')!;
    const y = s.libraryFolders!.find((f) => f.id === 'y')!;
    expect(x.parentId === undefined || y.parentId === undefined).toBe(true); // cycle broken
    expect(folderOf(s, 'a')).toBeUndefined();
    expect(folderOf(s, 'b')).toBe('ok');
    // A flat project passes through untouched; an empty list removes the field.
    const flat = base();
    expect(sanitizeLibraryFolders(flat)).toBe(flat);
    expect('libraryFolders' in sanitizeLibraryFolders({ ...flat, libraryFolders: [] })).toBe(false);
  });
});
