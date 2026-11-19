import { describe, expect, it } from 'vitest';
import { createProject } from '@savig/engine';
import { migrateProject } from './migrate';

describe('library folders survive loading (roadmap 11)', () => {
  it('keeps valid folders and item folderIds, and repairs dangling ones', () => {
    const p = {
      ...createProject(),
      assets: [
        { id: 'a', kind: 'svg', name: 'a', normalizedContent: '<svg/>', viewBox: '0 0 1 1', width: 1, height: 1, folderId: 'f' },
        { id: 'b', kind: 'svg', name: 'b', normalizedContent: '<svg/>', viewBox: '0 0 1 1', width: 1, height: 1, folderId: 'gone' },
      ],
      libraryFolders: [{ id: 'f', name: 'Props' }, { id: 'g', name: 'Inner', parentId: 'f' }],
    };
    const out = migrateProject(JSON.parse(JSON.stringify(p)));
    expect(out.libraryFolders).toEqual([{ id: 'f', name: 'Props' }, { id: 'g', name: 'Inner', parentId: 'f' }]);
    expect((out.assets[0] as { folderId?: string }).folderId).toBe('f');
    expect('folderId' in out.assets[1]).toBe(false);
  });
});
