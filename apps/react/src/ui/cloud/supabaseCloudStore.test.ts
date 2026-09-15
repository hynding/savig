import { describe, it, expect, vi } from 'vitest';
import { makeSupabaseCloudStore } from './supabaseCloudStore';

/** Minimal chainable fake of the supabase-js surface the adapter uses. */
function fakeClient() {
  const state: { updated: unknown; inserted: unknown } = { updated: null, inserted: null };
  const result = { data: [{ id: 'p1', name: 'n', data: {}, schema_version: 9, updated_at: 'u2' }], error: null };
  const builder = {
    select: vi.fn(() => builder),
    insert: vi.fn((row: unknown) => {
      state.inserted = row;
      return builder;
    }),
    update: vi.fn((patch: unknown) => {
      state.updated = patch;
      return builder;
    }),
    delete: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    single: vi.fn(async () => ({ data: result.data[0], error: null })),
    maybeSingle: vi.fn(async () => ({ data: result.data[0], error: null })),
    then: (res: (v: typeof result) => void) => Promise.resolve(result).then(res), // awaitable builder
  };
  const storage = {
    upload: vi.fn(async () => ({ error: null })),
    download: vi.fn(async () => ({ data: new Blob([new Uint8Array([7])]), error: null })),
    remove: vi.fn(async () => ({ error: null })),
    list: vi.fn(async () => ({ data: [{ name: 'hashA' }], error: null })),
  };
  const client = {
    from: vi.fn(() => builder),
    storage: { from: vi.fn(() => storage) },
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'u1' } }, error: null })) },
  };
  return { client, builder, storage, state };
}

describe('makeSupabaseCloudStore adapter', () => {
  it('updateProjectIf carries BOTH eq(id) and eq(updated_at) — the CAS (spec §7)', async () => {
    const { client, builder } = fakeClient();
    const store = makeSupabaseCloudStore(client as never);
    await store.updateProjectIf('p1', 'expected-ts', { name: 'n', data: {}, schema_version: 9 });
    const eqArgs = (builder.eq as ReturnType<typeof vi.fn>).mock.calls;
    expect(eqArgs).toContainEqual(['id', 'p1']);
    expect(eqArgs).toContainEqual(['updated_at', 'expected-ts']);
  });

  it('updateProjectIf returns null on 0 rows (CAS miss / RLS silence)', async () => {
    const { client, builder } = fakeClient();
    (builder.maybeSingle as ReturnType<typeof vi.fn>).mockResolvedValue({ data: null, error: null });
    const store = makeSupabaseCloudStore(client as never);
    expect(await store.updateProjectIf('p1', 'ts', { name: 'n', data: {}, schema_version: 9 })).toBeNull();
  });

  it('uploadBinary targets {userId}/{projectId}/{assetId} with upsert false (immutable)', async () => {
    const { client, storage } = fakeClient();
    const store = makeSupabaseCloudStore(client as never);
    await store.uploadBinary('proj1', 'hashA', new Uint8Array([1]));
    expect(storage.upload).toHaveBeenCalledWith('u1/proj1/hashA', expect.anything(), expect.objectContaining({ upsert: false }));
  });

  it('downloadBinary returns bytes; listBinaryIds maps names', async () => {
    const { client } = fakeClient();
    const store = makeSupabaseCloudStore(client as never);
    expect(await store.downloadBinary('proj1', 'hashA')).toEqual(new Uint8Array([7]));
    expect(await store.listBinaryIds('proj1')).toEqual(['hashA']);
  });

  it('surfaces supabase errors as thrown Errors (never silent)', async () => {
    const { client, storage } = fakeClient();
    (storage.upload as ReturnType<typeof vi.fn>).mockResolvedValue({ error: { message: 'quota' } });
    const store = makeSupabaseCloudStore(client as never);
    await expect(store.uploadBinary('p', 'a', new Uint8Array([1]))).rejects.toThrow('quota');
  });
});
