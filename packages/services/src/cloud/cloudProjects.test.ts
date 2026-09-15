import { describe, expect, it, vi } from 'vitest';
import { createProject } from '@savig/engine';
import { deleteCloudProject, listCloudProjects, loadCloudProject, saveCloudProject } from './cloudProjects';
import type { CloudProjectRow, CloudStore } from './types';

function fakeStore(over: Partial<CloudStore> = {}) {
  const calls: string[] = [];
  const store: CloudStore = {
    selectProjects: vi.fn(async () => [{ id: 'p1', name: 'A', updated_at: '2026-01-02T00:00:00Z' }]),
    selectProject: vi.fn(async () => null),
    insertProject: vi.fn(async (row) => {
      calls.push('insert');
      return { ...row, updated_at: '2026-01-01T00:00:00Z' } as CloudProjectRow;
    }),
    updateProjectIf: vi.fn(async () => null),
    deleteProject: vi.fn(async () => {
      calls.push('deleteRow');
    }),
    listBinaryIds: vi.fn(async () => []),
    uploadBinary: vi.fn(async (_p, assetId) => {
      calls.push(`upload:${assetId}`);
    }),
    downloadBinary: vi.fn(async () => new Uint8Array([7])),
    removeBinaries: vi.fn(async () => {
      calls.push('removeBinaries');
    }),
    ...over,
  };
  return { store, calls };
}

const audioProject = () => {
  const p = createProject();
  return {
    ...p,
    assets: [...p.assets, { id: 'hashA', kind: 'audio' as const, name: 'a.wav', mimeType: 'audio/wav', duration: 1 }],
  };
};

describe('saveCloudProject — new project (no link)', () => {
  it('mints the id client-side and uploads binaries BEFORE the row insert (spec §7)', async () => {
    const { store, calls } = fakeStore();
    const out = await saveCloudProject(store, audioProject(), { hashA: new Uint8Array([1]) }, null, () => 'fixed-id');
    expect(out.kind).toBe('saved');
    if (out.kind === 'saved') expect(out.link).toEqual({ projectId: 'fixed-id', updatedAt: '2026-01-01T00:00:00Z' });
    expect(calls).toEqual(['upload:hashA', 'insert']); // binaries strictly first
    expect(store.insertProject).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'fixed-id', name: createProject().meta.name, schema_version: createProject().meta.version }),
    );
  });

  it('only uploads binaries that belong to audio assets present in the binaries map', async () => {
    const { store } = fakeStore();
    await saveCloudProject(store, audioProject(), { hashA: new Uint8Array([1]), stray: new Uint8Array([2]) }, null, () => 'x');
    expect(store.uploadBinary).toHaveBeenCalledTimes(1);
  });
});

describe('saveCloudProject — update (link present)', () => {
  const link = { projectId: 'p1', updatedAt: '2026-01-01T00:00:00Z' };

  it('skips binaries the bucket already has, then CAS-updates', async () => {
    const { store, calls } = fakeStore({
      listBinaryIds: vi.fn(async () => ['hashA']),
      updateProjectIf: vi.fn(async () => ({ id: 'p1', name: 'n', data: {}, schema_version: 9, updated_at: '2026-01-03T00:00:00Z' })),
    });
    const out = await saveCloudProject(store, audioProject(), { hashA: new Uint8Array([1]) }, link);
    expect(store.uploadBinary).not.toHaveBeenCalled();
    expect(out).toEqual({ kind: 'saved', link: { projectId: 'p1', updatedAt: '2026-01-03T00:00:00Z' } });
    expect(calls).toEqual([]); // no upload, no insert
  });

  it('CAS miss + row still visible = conflict with the server timestamp', async () => {
    const { store } = fakeStore({
      selectProject: vi.fn(async () => ({ id: 'p1', name: 'n', data: {}, schema_version: 9, updated_at: '2026-02-01T00:00:00Z' })),
    });
    const out = await saveCloudProject(store, audioProject(), {}, link);
    expect(out).toEqual({ kind: 'conflict', serverUpdatedAt: '2026-02-01T00:00:00Z' });
  });

  it('CAS miss + row NOT visible = denied (RLS/auth — both return 0 rows, spec §7 disambiguation)', async () => {
    const { store } = fakeStore();
    const out = await saveCloudProject(store, audioProject(), {}, link);
    expect(out).toEqual({ kind: 'denied' });
  });
});

describe('loadCloudProject', () => {
  it('pipes row.data through migrateProject and downloads the audio binaries', async () => {
    // migrateProject upgrades on `meta.version` (see packages/services/src/persistence/migrate.ts) —
    // stamp a legacy v1 there so this genuinely exercises the migration chain rather than echoing
    // input. createProject() already stamps CURRENT_VERSION (7), so this is a real downgrade.
    const base = audioProject();
    const legacy = { ...base, meta: { ...base.meta, version: 1 } };
    const { store } = fakeStore({
      selectProject: vi.fn(async () => ({ id: 'p1', name: 'n', data: legacy, schema_version: 1, updated_at: 'u1' })),
    });
    const out = await loadCloudProject(store, 'p1');
    expect(out).not.toBeNull();
    expect(out!.project.meta.version).toBeGreaterThan(1); // migrated, not trusted verbatim
    expect(out!.binaries).toEqual({ hashA: new Uint8Array([7]) });
    expect(out!.link).toEqual({ projectId: 'p1', updatedAt: 'u1' });
  });

  it('returns null for a missing/denied row', async () => {
    const { store } = fakeStore();
    expect(await loadCloudProject(store, 'nope')).toBeNull();
  });

  it('a failed binary download throws (caller toasts; local state untouched)', async () => {
    const { store } = fakeStore({
      selectProject: vi.fn(async () => ({ id: 'p1', name: 'n', data: audioProject(), schema_version: 9, updated_at: 'u' })),
      downloadBinary: vi.fn(async () => {
        throw new Error('object not found');
      }),
    });
    await expect(loadCloudProject(store, 'p1')).rejects.toThrow('object not found');
  });
});

describe('listCloudProjects + deleteCloudProject', () => {
  it('maps rows to metas', async () => {
    const { store } = fakeStore();
    expect(await listCloudProjects(store)).toEqual([{ id: 'p1', name: 'A', updatedAt: '2026-01-02T00:00:00Z' }]);
  });

  it('delete removes the binaries folder BEFORE the row', async () => {
    const { store, calls } = fakeStore({ listBinaryIds: vi.fn(async () => ['hashA']) });
    await deleteCloudProject(store, 'p1');
    expect(calls).toEqual(['removeBinaries', 'deleteRow']);
  });
});
