// The CloudStore adapter over supabase-js (spec §7/§8 — see packages/services/src/cloud/types.ts
// for the interface this implements). `makeSupabaseCloudStore` is a PURE function of a client
// object so it is unit-testable against a plain fake (no real network, no real supabase-js
// instance) — `getSupabase()`/`getCloudStore()` are the only places that touch the real singleton.
import type { CloudStore, CloudProjectRow } from '@savig/services';
// Type-only import: erased at build time, so the real supabase-js dependency still only enters
// the bundle via the dynamic import() in getSupabase() below.
import type { SupabaseClient } from '@supabase/supabase-js';
import { cloudConfig } from './env';

/** The minimal supabase-js surface the adapter uses — narrow enough to fake in tests,
 *  wide enough that a real `SupabaseClient` satisfies it structurally. */
export interface SupabaseClientLike {
  from(table: string): SupabaseQueryBuilderLike;
  storage: { from(bucket: string): SupabaseStorageBucketLike };
  auth: { getUser(): Promise<{ data: { user: { id: string } | null }; error: unknown }> };
}

interface SupabaseQueryBuilderLike {
  select(columns?: string): SupabaseQueryBuilderLike;
  insert(row: unknown): SupabaseQueryBuilderLike;
  update(patch: unknown): SupabaseQueryBuilderLike;
  delete(): SupabaseQueryBuilderLike;
  eq(column: string, value: unknown): SupabaseQueryBuilderLike;
  order(column: string, opts?: { ascending?: boolean }): SupabaseQueryBuilderLike;
  single(): Promise<{ data: unknown; error: { message: string } | null }>;
  maybeSingle(): Promise<{ data: unknown; error: { message: string } | null }>;
  then<T>(resolve: (v: { data: unknown; error: { message: string } | null }) => T): Promise<T>;
}

interface SupabaseStorageBucketLike {
  upload(
    path: string,
    body: Uint8Array,
    opts: { upsert: boolean; contentType: string },
  ): Promise<{ error: { message: string } | null }>;
  download(path: string): Promise<{ data: Blob | null; error: { message: string } | null }>;
  remove(paths: string[]): Promise<{ error: { message: string } | null }>;
  list(path: string): Promise<{ data: Array<{ name: string }> | null; error: { message: string } | null }>;
}

const BUCKET = 'project-binaries';

function orThrow<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data;
}

/** Reads a Blob's bytes via FileReader rather than Blob.arrayBuffer(): jsdom (test env, and the
 *  fake client in supabaseCloudStore.test.ts) does not implement Blob.arrayBuffer() — mirrors the
 *  readFileBytes precedent in components/AssetPanel/readFile.ts. Works in real browsers too. */
function blobToBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read blob'));
    reader.readAsArrayBuffer(blob);
  });
}

/** Pure adapter: CloudStore backed by a supabase-js-shaped client. Takes the client as a
 *  parameter (rather than reaching for a module singleton) so it is testable against a fake. */
export function makeSupabaseCloudStore(client: SupabaseClientLike): CloudStore {
  async function userId(): Promise<string> {
    const { data, error } = await client.auth.getUser();
    if (error) throw new Error((error as { message?: string }).message ?? 'Not authenticated');
    if (!data.user) throw new Error('Not authenticated');
    return data.user.id;
  }

  return {
    async selectProjects() {
      const { data, error } = await client
        .from('projects')
        .select('id, name, updated_at')
        .order('updated_at', { ascending: false });
      return orThrow({ data, error }) as Array<Pick<CloudProjectRow, 'id' | 'name' | 'updated_at'>>;
    },

    async selectProject(id) {
      const { data, error } = await client.from('projects').select('*').eq('id', id).maybeSingle();
      return orThrow({ data, error }) as CloudProjectRow | null;
    },

    async insertProject(row) {
      const { data, error } = await client.from('projects').insert(row).select().single();
      return orThrow({ data, error }) as CloudProjectRow;
    },

    async updateProjectIf(id, expectedUpdatedAt, patch) {
      const { data, error } = await client
        .from('projects')
        .update(patch)
        .eq('id', id)
        .eq('updated_at', expectedUpdatedAt)
        .select()
        .maybeSingle();
      return orThrow({ data, error }) as CloudProjectRow | null;
    },

    async deleteProject(id) {
      const { error } = await client.from('projects').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },

    async listBinaryIds(projectId) {
      const uid = await userId();
      const { data, error } = await client.storage.from(BUCKET).list(`${uid}/${projectId}`);
      return orThrow({ data, error })!.map((f) => f.name);
    },

    async uploadBinary(projectId, assetId, bytes) {
      const uid = await userId();
      const { error } = await client.storage
        .from(BUCKET)
        .upload(`${uid}/${projectId}/${assetId}`, bytes, { upsert: false, contentType: 'application/octet-stream' });
      if (error) throw new Error(error.message);
    },

    async downloadBinary(projectId, assetId) {
      const uid = await userId();
      const { data, error } = await client.storage.from(BUCKET).download(`${uid}/${projectId}/${assetId}`);
      if (error) throw new Error(error.message);
      return blobToBytes(data!);
    },

    async removeBinaries(projectId, assetIds) {
      const uid = await userId();
      const { error } = await client.storage.from(BUCKET).remove(assetIds.map((id) => `${uid}/${projectId}/${id}`));
      if (error) throw new Error(error.message);
    },
  };
}

/** Lazy singleton real client — dynamic-imports supabase-js so the ~40kb+ dependency never
 *  enters the bundle for a session that never touches the cloud feature. Throws when the env
 *  isn't configured; callers that gate on `cloudConfig() !== null` first never hit this path. */
let clientPromise: Promise<SupabaseClient> | null = null;

export async function getSupabase(): Promise<SupabaseClient> {
  const config = cloudConfig();
  if (!config) throw new Error('Cloud is not configured (missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY)');
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js').then(({ createClient }) => createClient(config.url, config.key));
  }
  return clientPromise;
}

let storePromise: Promise<CloudStore> | null = null;

export async function getCloudStore(): Promise<CloudStore> {
  // Real SupabaseClient's chained-builder types are step-specific (QueryBuilder ->
  // FilterBuilder -> TransformBuilder) so they don't structurally match the single flat
  // SupabaseQueryBuilderLike above — the adapter only calls methods that ARE present at every
  // step it uses (verified by the fake-client unit tests), so this cast is sound.
  if (!storePromise) storePromise = getSupabase().then((client) => makeSupabaseCloudStore(client as unknown as SupabaseClientLike));
  return storePromise;
}
