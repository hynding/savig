import { describe, expect, it } from 'vitest';
import { createProject } from '@savig/engine';
import type { Asset, Project } from '@savig/engine';
import { addRect } from './build';
import { describeProject } from './describe';
import { createLibraryFolder, deleteLibraryFolder, moveToLibraryFolder, renameLibraryFolder } from './libraryFolders';

const svg = (id: string, name: string): Asset => ({ id, kind: 'svg', name, normalizedContent: '<svg/>', viewBox: '0 0 1 1', width: 1, height: 1 });

function base(): Project {
  const p = addRect(createProject(), { x: 0, y: 0, width: 10, height: 10, id: 'r' }).project;
  return { ...p, assets: [...p.assets, svg('tree', 'tree.svg'), svg('rock', 'rock.svg')] };
}

describe('core library folders', () => {
  it('creates folders with deterministic ids and files items; describe lists the tree', () => {
    const first = createLibraryFolder(base(), { name: 'Props' });
    let p = first.project;
    const props = first.id;
    expect(props).toBe('folder1');
    const r = createLibraryFolder(p, { name: 'Rocks', parentId: props });
    p = r.project;
    expect(r.id).toBe('folder2');
    p = moveToLibraryFolder(p, ['tree'], props);
    p = moveToLibraryFolder(p, ['rock'], r.id);
    const text = describeProject(p);
    expect(text).toContain('Library folders:');
    expect(text).toContain('  - "Props" [folder1]: "tree.svg"');
    expect(text).toContain('    - "Rocks" [folder2]: "rock.svg"');
  });

  it('fails loud on unknown folders, unknown ids, non-library assets and self-nesting', () => {
    const { project: p, id } = createLibraryFolder(base(), { name: 'A' });
    const inner = createLibraryFolder(p, { name: 'B', parentId: id });
    expect(() => createLibraryFolder(p, { name: 'x', parentId: 'nope' })).toThrow(/unknown library folder/);
    expect(() => moveToLibraryFolder(p, ['tree'], 'nope')).toThrow(/unknown library folder/);
    expect(() => moveToLibraryFolder(p, ['ghost'], id)).toThrow(/unknown asset or folder/);
    const vectorId = p.assets.find((a) => a.kind === 'vector')!.id;
    expect(() => moveToLibraryFolder(p, [vectorId], id)).toThrow(/not a library item/);
    expect(() => moveToLibraryFolder(inner.project, [id], inner.id)).toThrow(/inside itself/);
    expect(() => renameLibraryFolder(p, 'nope', 'x')).toThrow(/unknown library folder/);
    expect(() => deleteLibraryFolder(p, 'nope')).toThrow(/unknown library folder/);
  });

  it('rename and delete (contents move up)', () => {
    const made = createLibraryFolder(base(), { name: 'A' });
    const id = made.id;
    let p = moveToLibraryFolder(made.project, ['tree'], id);
    p = renameLibraryFolder(p, id, 'Scenery');
    expect(p.libraryFolders![0].name).toBe('Scenery');
    p = deleteLibraryFolder(p, id);
    expect(p.libraryFolders).toBeUndefined();
    expect('folderId' in p.assets.find((a) => a.id === 'tree')!).toBe(false);
    expect(describeProject(p)).not.toContain('Library folders:');
  });
});
