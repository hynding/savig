import { describe, it, expect, beforeEach } from 'vitest';
import { store } from '../store';
import type { Asset } from '@savig/engine';

const svg = (id: string): Asset => ({ id, kind: 'svg', name: id, normalizedContent: '<svg/>', viewBox: '0 0 1 1', width: 1, height: 1 });
const present = () => store.getState().history.present;
const folderOf = (id: string) => (present().assets.find((a) => a.id === id) as { folderId?: string }).folderId;

beforeEach(() => {
  store.getState().newProject();
  store.getState().commit({ ...present(), assets: [svg('a'), svg('b')] });
});

describe('library folder slice', () => {
  it('creates sequentially named folders, nested when the parent exists', () => {
    const s = store.getState();
    const f1 = s.createLibraryFolder();
    const f2 = s.createLibraryFolder();
    const inner = s.createLibraryFolder('Walk', f1);
    const stray = s.createLibraryFolder(undefined, 'missing');
    expect(present().libraryFolders).toEqual([
      { id: f1, name: 'Folder' }, { id: f2, name: 'Folder 2' }, { id: inner, name: 'Walk', parentId: f1 }, { id: stray, name: 'Folder 3' },
    ]);
  });

  it('move, rename and delete are each one undo step; no-ops commit nothing', () => {
    const s = store.getState();
    const f = s.createLibraryFolder('Props');
    s.moveToLibraryFolder(['a'], f);
    expect(folderOf('a')).toBe(f);
    const before = present();
    s.moveToLibraryFolder(['a'], f); // already there
    s.moveToLibraryFolder(['b'], 'missing'); // unknown folder
    s.renameLibraryFolder(f, 'Props');
    expect(present()).toBe(before);
    s.renameLibraryFolder(f, 'Scenery');
    expect(present().libraryFolders![0].name).toBe('Scenery');
    s.deleteLibraryFolder(f);
    expect(present().libraryFolders).toBeUndefined();
    expect(folderOf('a')).toBeUndefined();
    s.undo();
    expect(folderOf('a')).toBe(f);
    expect(present().libraryFolders![0].name).toBe('Scenery');
    s.undo();
    expect(present().libraryFolders![0].name).toBe('Props');
    s.undo();
    expect(folderOf('a')).toBeUndefined();
  });
});
