# Cloud Projects & Accounts (M10) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Signed-in users save/list/open/delete projects in Supabase (jsonb rows + private Storage binaries, owner-only RLS) from a local-first editor whose cloud UI vanishes entirely when unconfigured.

**Architecture:** Direct supabase-js from the client (publishable key; RLS is the whole authorization contract). Neutral orchestration in `packages/services/src/cloud/` against an injectable `CloudStore` interface; the app supplies a thin supabase adapter, transient session/link state, palette commands behind a `visible?` capability predicate, and an overlay dialog. Saves are binaries-first with client-minted uuids and a compare-and-swap `updated_at` guard.

**Tech Stack:** Supabase (Postgres + Auth + Storage), `@supabase/supabase-js` v2 (pinned, lazy dynamic import), committed SQL migrations, Vitest fakes, Playwright with `page.route` network stubs.

**Spec:** `docs/superpowers/specs/2026-09-14-cloud-projects-accounts-design.md`

## Global Constraints

- **Local-first invariant:** every existing flow (anonymous editing, IndexedDB autosave, file open/save, exports) works unchanged with zero cloud config. Sign-out clears ONLY cloud state (`cloudUser` + link fields), never the local project.
- Publishable key ONLY in the client — the string `service_role` must not appear anywhere in the repo.
- RLS shapes verbatim (spec §4): `TO authenticated` + `(select auth.uid()) = user_id`; UPDATE has BOTH `USING` and `WITH CHECK`; INSERT has `WITH CHECK`; all four verbs; explicit `GRANT select, insert, update, delete ... to authenticated` and NOTHING for `anon`; storage policies on INSERT+SELECT+UPDATE+DELETE scoped by `(storage.foldername(name))[1] = (select auth.uid())::text`.
- No `user_metadata` in any authorization logic.
- Env gating: `import.meta.env.VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY`; either absent → zero cloud UI and supabase-js never dynamically imported.
- Save order: binaries upload BEFORE the row write; project ids are client-minted `crypto.randomUUID()`; updates are CAS (`.eq('updated_at', expected)`) with a 0-rows → re-read disambiguation (conflict vs denial).
- Cloud-loaded JSON goes through `migrateProject` (`@savig/services`) — untrusted input, exactly like a `.savig` from disk.
- `@supabase/supabase-js` pinned EXACT version (no `^`), lockfile committed.
- Storage bucket `project-binaries`, path `{user_id}/{project_id}/{asset_id}`; per-project delete removes the folder's objects BEFORE the row.
- Supabase skill Principle 1 (Task 1): fetch `https://supabase.com/changelog.md` + the current auth/storage/RLS docs BEFORE writing client code; record confirmations in the report.
- All commits end with: Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
- Run tools directly: `node_modules/.bin/vitest run`, `node_modules/.bin/tsc --noEmit`, `node_modules/.bin/eslint .`, `node_modules/.bin/playwright test` (pnpm script gate is unreliable for subagents; `pnpm add` for deps is fine).

## File Structure

| File | Role |
|---|---|
| `supabase/migrations/20260914000000_cloud_projects.sql` | Table + trigger + grants + RLS + bucket + storage policies |
| `docs/CLOUD-SETUP.md` | The user's one-time dashboard/ops checklist (spec §11) |
| `packages/services/src/cloud/types.ts` | `CloudStore` interface + row/meta types |
| `packages/services/src/cloud/cloudProjects.ts` (+`.test.ts`) | list/save/load/delete orchestration (CAS, binaries-first, migrate) |
| `packages/editor-state/src/slices/cloudSlice.ts` (+`.test.ts`) | Transient `cloudUser`/link fields + actions |
| `packages/ui-core/src/commands/capabilities.ts` | Module registry: `setCommandCapabilities({cloudConfigured})` |
| `packages/ui-core/src/commands/{types,registry}.ts` | `Command.visible?: () => boolean` + 3 cloud commands; palette/keymap filtering |
| `apps/react/src/ui/cloud/env.ts` | `cloudConfig(): {url,key} \| null` |
| `apps/react/src/ui/cloud/supabaseCloudStore.ts` (+`.test.ts`) | Lazy client factory + `CloudStore` adapter over supabase-js |
| `apps/react/src/ui/cloud/useCloudSession.ts` | Session → store mirroring |
| `apps/react/src/ui/cloud/cloudActions.ts` (+`.test.ts`) | Save/open/delete flows (conflict outcomes → UI) |
| `apps/react/src/ui/components/CloudDialog/CloudDialog.tsx` (+`.test.tsx`, `.module.css`) | Sign-in panel + projects list + conflict bar |
| `apps/react/src/ui/App.tsx`, `commandHost.ts`, `FileToolbar.tsx` | Wiring: capability, overlay, host actions, account button |
| `e2e/cloud-projects.spec.ts`, `playwright.config.ts` | Stub-env journey |
| `docs/superpowers/INDEX.md`, master spec | M10 entry + "No backend" amendment note |

---

### Task 1: Supabase infra-as-code + ops doc + API doc-check

**Files:**
- Create: `supabase/migrations/20260914000000_cloud_projects.sql`, `docs/CLOUD-SETUP.md`
- Test: none (SQL — reviewer-gated; advisors run on the user's linked project per CLOUD-SETUP)

**Interfaces:**
- Consumes: nothing.
- Produces: the schema every later task assumes — table `public.projects(id, user_id, name, data, schema_version, created_at, updated_at)`; bucket `project-binaries`; path convention `{user_id}/{project_id}/{asset_id}`.

- [ ] **Step 1: Doc-check (skill Principle 1).** Fetch `https://supabase.com/changelog.md`; scan for breaking changes to auth/storage/RLS/keys. Then confirm against current docs (append `.md` to docs URLs): (a) supabase-js v2 names used later: `createClient`, `auth.getSession`, `auth.onAuthStateChange`, `auth.signInWithOtp`, `auth.signInWithOAuth`, `auth.signOut`, `.from().select/insert/update/delete`, `.storage.from().upload/download/remove/list`; (b) the storage-policy `storage.foldername` pattern; (c) `moddatetime` usage (`extensions` schema); (d) publishable-key naming. Record each confirmation (URL + one line) in your report. If anything differs from this plan, STOP and report NEEDS_CONTEXT with specifics.

- [ ] **Step 2: Write the migration**

```sql
-- Cloud projects & accounts (M10) — spec docs/superpowers/specs/2026-09-14-cloud-projects-accounts-design.md §4.
-- Owner-only RLS is the ENTIRE authorization contract (no API layer). anon gets nothing.
create extension if not exists moddatetime schema extensions;

create table public.projects (
  id uuid primary key default gen_random_uuid(),  -- client supplies crypto.randomUUID() (binaries-first inserts)
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null default 'Untitled',
  data jsonb not null,
  schema_version int not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index projects_user_recent on public.projects (user_id, updated_at desc);

create trigger projects_updated_at
  before update on public.projects
  for each row execute function extensions.moddatetime(updated_at);

alter table public.projects enable row level security;

-- Data API exposure (skill Principle 4): explicit grants; RLS scopes the rows. anon: nothing.
grant select, insert, update, delete on public.projects to authenticated;

create policy "projects_select_own" on public.projects for select
  to authenticated using ((select auth.uid()) = user_id);
create policy "projects_insert_own" on public.projects for insert
  to authenticated with check ((select auth.uid()) = user_id);
create policy "projects_update_own" on public.projects for update
  to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "projects_delete_own" on public.projects for delete
  to authenticated using ((select auth.uid()) = user_id);

-- Private binaries bucket; objects live at {user_id}/{project_id}/{asset_id}.
insert into storage.buckets (id, name, public) values ('project-binaries', 'project-binaries', false);

-- All four verbs (upsert alone needs INSERT+SELECT+UPDATE — checklist), first path segment = owner.
create policy "binaries_select_own" on storage.objects for select
  to authenticated using (bucket_id = 'project-binaries' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "binaries_insert_own" on storage.objects for insert
  to authenticated with check (bucket_id = 'project-binaries' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "binaries_update_own" on storage.objects for update
  to authenticated using (bucket_id = 'project-binaries' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'project-binaries' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "binaries_delete_own" on storage.objects for delete
  to authenticated using (bucket_id = 'project-binaries' and (storage.foldername(name))[1] = (select auth.uid())::text);
```

- [ ] **Step 3: Write `docs/CLOUD-SETUP.md`** — the spec §11 checklist as numbered steps: create a Supabase project; `supabase link --project-ref <ref>`; `supabase db push` (applies the committed migration); run `supabase db advisors` (or MCP `get_advisors`) and resolve; enable the GitHub auth provider (create the GitHub OAuth app, paste id/secret); add redirect URLs (`http://localhost:5173`, `https://<user>.github.io/savig/`); copy the project URL + publishable key into `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` (a local `.env.local`, and the Pages deploy env if cloud is wanted there); note the PKCE magic-link same-browser caveat (spec §5). End with a **live smoke checklist** (spec §10's manual/optional pass): sign in via magic
link, save a project with audio, reload the page, open it from the dialog, verify audio plays,
delete it. State plainly: without these two env vars the app shows no cloud UI at all.

- [ ] **Step 4: Sanity + commit** — `node_modules/.bin/tsc --noEmit` and `node_modules/.bin/eslint .` (nothing TS changed; must stay green), `node_modules/.bin/vitest run` untouched-green. `git add -A && git commit -m "feat(cloud): M10 schema — projects table, owner-only RLS, private binaries bucket + setup guide"`

---

### Task 2: services cloud core (CloudStore + orchestration)

**Files:**
- Create: `packages/services/src/cloud/types.ts`, `packages/services/src/cloud/cloudProjects.ts`
- Modify: `packages/services/src/index.ts` (add `export * from './cloud/types'; export * from './cloud/cloudProjects';`)
- Test: `packages/services/src/cloud/cloudProjects.test.ts`

**Interfaces:**
- Consumes: `migrateProject(doc: unknown): Project` (`./persistence/migrate`); `Project` (`@savig/engine`).
- Produces (verbatim for Tasks 5–7):

```ts
// types.ts
export interface CloudProjectRow { id: string; name: string; data: unknown; schema_version: number; updated_at: string }
export interface CloudProjectMeta { id: string; name: string; updatedAt: string }
export interface CloudStore {
  selectProjects(): Promise<Array<Pick<CloudProjectRow, 'id' | 'name' | 'updated_at'>>>;
  selectProject(id: string): Promise<CloudProjectRow | null>;
  insertProject(row: { id: string; name: string; data: unknown; schema_version: number }): Promise<CloudProjectRow>;
  /** CAS: applies only where updated_at === expectedUpdatedAt; null = 0 rows (conflict OR denial). */
  updateProjectIf(id: string, expectedUpdatedAt: string, patch: { name: string; data: unknown; schema_version: number }): Promise<CloudProjectRow | null>;
  deleteProject(id: string): Promise<void>;
  listBinaryIds(projectId: string): Promise<string[]>;
  uploadBinary(projectId: string, assetId: string, bytes: Uint8Array): Promise<void>;
  downloadBinary(projectId: string, assetId: string): Promise<Uint8Array>;
  removeBinaries(projectId: string, assetIds: string[]): Promise<void>;
}
// cloudProjects.ts
export interface CloudLink { projectId: string; updatedAt: string }
export type CloudSaveOutcome =
  | { kind: 'saved'; link: CloudLink }
  | { kind: 'conflict'; serverUpdatedAt: string }
  | { kind: 'denied' };
export function listCloudProjects(store: CloudStore): Promise<CloudProjectMeta[]>;
export function saveCloudProject(store: CloudStore, project: Project, binaries: Record<string, Uint8Array>, link: CloudLink | null, newId?: () => string): Promise<CloudSaveOutcome>;
export function loadCloudProject(store: CloudStore, id: string): Promise<{ project: Project; binaries: Record<string, Uint8Array>; link: CloudLink } | null>;
export function deleteCloudProject(store: CloudStore, id: string): Promise<void>;
```

- [ ] **Step 1: Write the failing tests**

```ts
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
      expect.objectContaining({ id: 'fixed-id', name: createProject().meta.name, schema_version: createProject().version }),
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
    const legacy = { ...audioProject(), version: 1 }; // migrateProject must upgrade it
    const { store } = fakeStore({
      selectProject: vi.fn(async () => ({ id: 'p1', name: 'n', data: legacy, schema_version: 1, updated_at: 'u1' })),
    });
    const out = await loadCloudProject(store, 'p1');
    expect(out).not.toBeNull();
    expect(out!.project.version).toBeGreaterThan(1); // migrated, not trusted verbatim
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
```

- [ ] **Step 2: Run to verify FAIL** — `node_modules/.bin/vitest run packages/services/src/cloud/` → module not found.

- [ ] **Step 3: Implement** (`types.ts` verbatim from the Interfaces block, then:)

```ts
// cloudProjects.ts — neutral cloud orchestration (spec §6/§7). The CloudStore is injected (the
// AudioContextLike DI pattern): unit tests run against a fake; the app supplies the supabase
// adapter. Cloud data is UNTRUSTED (spec §9): loads go through migrateProject like a disk file.
import type { Project } from '@savig/engine';
import { migrateProject } from '../persistence/migrate';
import type { CloudProjectMeta, CloudStore } from './types';

export interface CloudLink {
  projectId: string;
  updatedAt: string;
}
export type CloudSaveOutcome =
  | { kind: 'saved'; link: CloudLink }
  | { kind: 'conflict'; serverUpdatedAt: string }
  | { kind: 'denied' };

/** Audio asset ids that actually have bytes to ship (spec §3: binaries = audio, content-addressed). */
function audioBinaryIds(project: Project, binaries: Record<string, Uint8Array>): string[] {
  return project.assets.filter((a) => a.kind === 'audio' && binaries[a.id]).map((a) => a.id);
}

export async function listCloudProjects(store: CloudStore): Promise<CloudProjectMeta[]> {
  return (await store.selectProjects()).map((r) => ({ id: r.id, name: r.name, updatedAt: r.updated_at }));
}

export async function saveCloudProject(
  store: CloudStore,
  project: Project,
  binaries: Record<string, Uint8Array>,
  link: CloudLink | null,
  newId: () => string = () => crypto.randomUUID(),
): Promise<CloudSaveOutcome> {
  const projectId = link ? link.projectId : newId(); // client-minted for inserts (binaries-first, spec §7)
  const wanted = audioBinaryIds(project, binaries);
  const existing = link ? new Set(await store.listBinaryIds(projectId)) : new Set<string>();
  for (const id of wanted) {
    if (!existing.has(id)) await store.uploadBinary(projectId, id, binaries[id]); // immutable, upload-once
  }
  const rowPatch = { name: project.meta.name, data: project as unknown, schema_version: project.version };
  if (!link) {
    const row = await store.insertProject({ id: projectId, ...rowPatch });
    return { kind: 'saved', link: { projectId: row.id, updatedAt: row.updated_at } };
  }
  const updated = await store.updateProjectIf(projectId, link.updatedAt, rowPatch);
  if (updated) return { kind: 'saved', link: { projectId: updated.id, updatedAt: updated.updated_at } };
  // CAS returned 0 rows: RLS denial is ALSO silent 0 rows (skill checklist) — disambiguate.
  const current = await store.selectProject(projectId);
  return current ? { kind: 'conflict', serverUpdatedAt: current.updated_at } : { kind: 'denied' };
}

export async function loadCloudProject(
  store: CloudStore,
  id: string,
): Promise<{ project: Project; binaries: Record<string, Uint8Array>; link: CloudLink } | null> {
  const row = await store.selectProject(id);
  if (!row) return null;
  const project = migrateProject(row.data); // untrusted input — same seam as a .savig from disk
  const binaries: Record<string, Uint8Array> = {};
  for (const asset of project.assets) {
    if (asset.kind !== 'audio') continue;
    binaries[asset.id] = await store.downloadBinary(id, asset.id); // a miss throws — no partial load
  }
  return { project, binaries, link: { projectId: row.id, updatedAt: row.updated_at } };
}

export async function deleteCloudProject(store: CloudStore, id: string): Promise<void> {
  const ids = await store.listBinaryIds(id);
  if (ids.length) await store.removeBinaries(id, ids); // objects first, then the row (spec §4)
  await store.deleteProject(id);
}
```

- [ ] **Step 4: Run to verify PASS**, then `node_modules/.bin/vitest run packages/services/` (whole package) + `node_modules/.bin/tsc --noEmit`.

NOTE: if `migrateProject`'s signature differs, read `packages/services/src/persistence/migrate.ts:31` and match it. If `createProject().version` isn't the schema version field, read `packages/engine/src/project.ts` and use the real field; the test asserts migration happened via a version bump — adapt the legacy fixture to whatever `migrateProject` genuinely upgrades.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(cloud): CloudStore interface + list/save/load/delete orchestration (CAS, binaries-first, migrate seam)"`

---

### Task 3: editor-state cloud slice (transient session + link)

**Files:**
- Create: `packages/editor-state/src/slices/cloudSlice.ts`
- Modify: `packages/editor-state/src/store-internals.ts` (state fields, action declarations, TRANSIENT_DEFAULTS), `packages/editor-state/src/store.ts` (compose the slice — mirror how `createScenesSlice` is composed)
- Test: `packages/editor-state/src/slices/cloudSlice.test.ts`

**Interfaces:**
- Consumes: the slice pattern (`SliceCreator`, see `scenesSlice.ts`).
- Produces (Tasks 5–6 rely on these exact names):

```ts
// state (all transient — TRANSIENT_DEFAULTS entries, never in history)
cloudUser: { id: string; email: string | null } | null;   // default null
cloudProjectId: string | null;                            // default null
cloudUpdatedAt: string | null;                            // default null
// actions
setCloudUser(user: { id: string; email: string | null } | null): void; // sign-out OR a different user id clears the link fields (spec §5)
setCloudLink(projectId: string, updatedAt: string): void;
clearCloudLink(): void;
```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { store } from '../store';

beforeEach(() => store.getState().newProject());

describe('cloud slice (transient session + link)', () => {
  it('defaults: signed out, no link', () => {
    expect(store.getState().cloudUser).toBeNull();
    expect(store.getState().cloudProjectId).toBeNull();
    expect(store.getState().cloudUpdatedAt).toBeNull();
  });

  it('setCloudLink/clearCloudLink round-trip without touching history', () => {
    const past = store.getState().history.past.length;
    store.getState().setCloudLink('p1', 'u1');
    expect(store.getState().cloudProjectId).toBe('p1');
    expect(store.getState().cloudUpdatedAt).toBe('u1');
    store.getState().clearCloudLink();
    expect(store.getState().cloudProjectId).toBeNull();
    expect(store.getState().history.past.length).toBe(past);
  });

  it('sign-out clears the link fields but never the project (local-first invariant, spec §5)', () => {
    store.getState().addVectorShape('rect', { x: 0, y: 0, width: 10, height: 10 });
    store.getState().setCloudUser({ id: 'u1', email: 'a@b.c' });
    store.getState().setCloudLink('p1', 'ts');
    store.getState().setCloudUser(null);
    expect(store.getState().cloudUser).toBeNull();
    expect(store.getState().cloudProjectId).toBeNull();
    expect(store.getState().history.present.objects).toHaveLength(1); // project untouched
  });

  it('switching to a DIFFERENT user id also clears the link; same id keeps it', () => {
    store.getState().setCloudUser({ id: 'u1', email: null });
    store.getState().setCloudLink('p1', 'ts');
    store.getState().setCloudUser({ id: 'u1', email: 'renamed@x' });
    expect(store.getState().cloudProjectId).toBe('p1'); // same user — link survives
    store.getState().setCloudUser({ id: 'u2', email: null });
    expect(store.getState().cloudProjectId).toBeNull(); // different user — link gone
  });
});
```

- [ ] **Step 2: Run to verify FAIL**, **Step 3: Implement** (slice + declarations + defaults):

```ts
// cloudSlice.ts
import { type SliceCreator } from '../store-internals';

type CloudKeys = 'setCloudUser' | 'setCloudLink' | 'clearCloudLink';

export const createCloudSlice: SliceCreator<CloudKeys> = (set, get) => ({
  setCloudUser(user) {
    const prev = get().cloudUser;
    const userChanged = user === null || (prev !== null && prev.id !== user.id);
    // A sign-out or a different account must never be able to target the previous user's row
    // (a stale link would surface as a confusing silent RLS denial — spec §5/§8).
    set(userChanged ? { cloudUser: user, cloudProjectId: null, cloudUpdatedAt: null } : { cloudUser: user });
  },
  setCloudLink(projectId, updatedAt) {
    set({ cloudProjectId: projectId, cloudUpdatedAt: updatedAt });
  },
  clearCloudLink() {
    set({ cloudProjectId: null, cloudUpdatedAt: null });
  },
});
```

store-internals: field docs mirror `previewMode`'s transient comment; TRANSIENT_DEFAULTS gain the three nulls; the interface gains the three actions next to the transport actions. store.ts composes `...createCloudSlice(set, get)` exactly where the other slices are spread.

- [ ] **Step 4: Run to verify PASS**, then `node_modules/.bin/vitest run packages/editor-state/` + `node_modules/.bin/tsc --noEmit`.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(cloud): transient cloud session + project-link store slice"`

---

### Task 4: command visibility capability + cloud commands (ui-core)

**Files:**
- Create: `packages/ui-core/src/commands/capabilities.ts`
- Modify: `packages/ui-core/src/commands/types.ts` (Command.visible?, CommandHost members), `packages/ui-core/src/commands/registry.ts` (3 commands), `packages/ui-core/src/viewmodels/commandPalette.ts` (filter), `packages/ui-core/src/controllers/keymap.ts` (skip invisible), `packages/ui-core/src/index.ts` (export capabilities if not barrel-covered)
- Test: `packages/ui-core/src/commands/capabilities.test.ts` (+ extend existing registry/palette test fixtures for the new host members)

**Interfaces:**
- Consumes: nothing new.
- Produces:

```ts
// capabilities.ts — module registry (the stageCursor/textMeasure precedent): env-derived,
// static-per-session facts commands may gate visibility on. App bootstrap sets it once.
export interface CommandCapabilities { cloudConfigured: boolean }
export function setCommandCapabilities(caps: Partial<CommandCapabilities>): void;
export function commandCapabilities(): CommandCapabilities;   // defaults { cloudConfigured: false }
// types.ts additions
Command.visible?: () => boolean;              // absent = always visible; false = HIDDEN (palette + keymap)
CommandHost.saveToCloud(): void;
CommandHost.openCloudProjects(): void;
CommandHost.openCloudAccount(): void;
// registry entries (category 'File', keywords incl. 'cloud'):
//   file.saveToCloud  'Save to Cloud'      run: c.host.saveToCloud()
//   file.openFromCloud 'Open from Cloud…'  run: c.host.openCloudProjects()
//   account.signInOut 'Cloud Account…'     run: c.host.openCloudAccount()
// each with visible: () => commandCapabilities().cloudConfigured
```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { setCommandCapabilities, commandCapabilities } from './capabilities';
import { COMMANDS } from './registry';
import { commandPaletteViewModel } from '../viewmodels/commandPalette'; // match the real export name — read the file first
import { store } from '@savig/editor-state';

beforeEach(() => {
  setCommandCapabilities({ cloudConfigured: false });
  store.getState().newProject();
});

describe('command capabilities + cloud command visibility', () => {
  it('defaults to cloudConfigured false', () => {
    expect(commandCapabilities().cloudConfigured).toBe(false);
  });

  it('cloud commands are HIDDEN from the palette when unconfigured, present when configured', () => {
    const ids = (q: string) => commandPaletteViewModel(store.getState(), q).items.map((i) => i.id);
    expect(ids('cloud')).not.toContain('file.saveToCloud');
    setCommandCapabilities({ cloudConfigured: true });
    const withCloud = ids('cloud');
    expect(withCloud).toContain('file.saveToCloud');
    expect(withCloud).toContain('file.openFromCloud');
    expect(withCloud).toContain('account.signInOut');
  });

  it('every cloud command routes to its host action', () => {
    setCommandCapabilities({ cloudConfigured: true });
    const called: string[] = [];
    const host = {
      saveToCloud: () => called.push('save'),
      openCloudProjects: () => called.push('open'),
      openCloudAccount: () => called.push('account'),
    } as never;
    for (const id of ['file.saveToCloud', 'file.openFromCloud', 'account.signInOut']) {
      COMMANDS.find((c) => c.id === id)!.run({ state: store.getState(), host } as never);
    }
    expect(called).toEqual(['save', 'open', 'account']);
  });
});
```

NOTE: the palette viewmodel's real export name and item shape must be read from `packages/ui-core/src/viewmodels/commandPalette.ts` first — adapt the test's calls (NOT its intent: hidden vs present) to the real API. If items have no `id`, match on title.

- [ ] **Step 2: Run to verify FAIL**, **Step 3: Implement** — `capabilities.ts` (module `let caps = { cloudConfigured: false }`); `visible?: () => boolean` on `Command`; palette VM: filter `COMMANDS.filter((c) => !c.visible || c.visible())` before the existing mapping; keymap controller: same filter before chord matching (an invisible command must never fire from a shortcut); the three registry entries; the three `CommandHost` members with doc comments. Extend every existing test fixture that structurally implements `CommandHost` (tsc will list them — the ExportVideoDialog task extended the same 4 fixtures).

- [ ] **Step 4: Run** `node_modules/.bin/vitest run packages/ui-core/` + `node_modules/.bin/tsc --noEmit` (fixture gaps surface here).

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(cloud): command visibility capabilities + cloud palette commands"`

---

### Task 5: app cloud layer — env, supabase adapter, session hook, host wiring

**Files:**
- Create: `apps/react/src/ui/cloud/env.ts`, `apps/react/src/ui/cloud/supabaseCloudStore.ts`, `apps/react/src/ui/cloud/useCloudSession.ts`
- Modify: `apps/react/package.json` (dep), `apps/react/src/ui/commandHost.ts` + `apps/react/src/ui/App.tsx` (host actions → overlay, capability registration, session hook mount)
- Test: `apps/react/src/ui/cloud/supabaseCloudStore.test.ts`

**Interfaces:**
- Consumes: `CloudStore` (Task 2), `setCommandCapabilities` (Task 4), `setCloudUser` (Task 3).
- Produces:

```ts
// env.ts
export function cloudConfig(): { url: string; key: string } | null;  // both env vars or null
// supabaseCloudStore.ts
export function getSupabase(): Promise<SupabaseClient>;   // lazy singleton; throws if unconfigured
export function makeSupabaseCloudStore(client: SupabaseClientLike): CloudStore; // pure adapter, testable
export function getCloudStore(): Promise<CloudStore>;     // getSupabase() + adapter
// useCloudSession.ts
export function useCloudSession(): void;  // mounts once in App: initial getSession + onAuthStateChange -> setCloudUser
```

- [ ] **Step 1: Add the dependency (EXACT pin)** — `cd apps/react && pnpm add @supabase/supabase-js@2.49.4 && cd ../..` (or the current latest 2.x — check `npm view @supabase/supabase-js version` and pin THAT exact version, no `^`; record which in your report).

- [ ] **Step 2: Write the failing adapter tests** (a plain-object fake of the supabase client surface — chainable query builder stubs):

```ts
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
```

- [ ] **Step 3: Run to verify FAIL**, **Step 4: Implement**

`env.ts`: read `import.meta.env.VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY`; both non-empty → `{url, key}` else null.

`supabaseCloudStore.ts`: lazy singleton `getSupabase()` (`const { createClient } = await import('@supabase/supabase-js')`, throws when `cloudConfig()` null). `makeSupabaseCloudStore(client)`: the adapter caches the user id from `client.auth.getUser()` per call as needed for storage paths; `selectProjects` = `from('projects').select('id, name, updated_at').order('updated_at', { ascending: false })`; `selectProject` = `.select('*').eq('id', id).maybeSingle()`; `insertProject` = `.insert(row).select().single()`; `updateProjectIf` = `.update(patch).eq('id', id).eq('updated_at', expected).select().maybeSingle()` (null data → null); `deleteProject` = `.delete().eq('id', id)`; storage ops on bucket `project-binaries` with `${userId}/${projectId}/${assetId}` paths, `upload(..., { upsert: false, contentType: 'application/octet-stream' })`, `download` → `new Uint8Array(await data.arrayBuffer())` (jsdom Blob: use the FileReader fallback precedent from `AssetPanel/readFile.ts` if arrayBuffer is missing in tests — or keep arrayBuffer and let the fake supply a Blob with it; match what makes the tests honest in jsdom). Every `{error}` non-null → `throw new Error(error.message)`.

`useCloudSession.ts`: `useEffect` once — if `cloudConfig()` null return; `getSupabase()` → `auth.getSession()` → `setCloudUser(session?.user ? {id, email} : null)`; subscribe `onAuthStateChange((_, session) => setCloudUser(...))`; unsubscribe on cleanup.

`App.tsx`: call `setCommandCapabilities({ cloudConfigured: cloudConfig() !== null })` at module scope or first effect; mount `useCloudSession()`; extend `Overlay` union with `'cloud'` and render `{overlay === 'cloud' && <CloudDialog onClose={...}/>}` (component lands in Task 6 — to keep THIS task compiling, wire the overlay kind + host actions now and render the dialog behind a `lazy` import created in Task 6; if you must, add a minimal placeholder module `CloudDialog.tsx` exporting a stub that Task 6 replaces — note it in your report). Host actions: `openCloudProjects`/`openCloudAccount` → `setOverlay('cloud')`; `saveToCloud` → `void import('./cloud/cloudActions').then((m) => m.saveToCloudFlow())` (module lands Task 6; for THIS task register the host actions that only open the overlay, and let Task 6 swap saveToCloud to the real flow — state clearly in the report which shape you left).

- [ ] **Step 5: Run** targeted + `node_modules/.bin/vitest run apps/react/` + `node_modules/.bin/tsc --noEmit` + `node_modules/.bin/eslint .`.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(cloud): supabase adapter + env gating + session hook + host wiring"`

---

### Task 6: CloudDialog UI + flows (save/open/delete/conflict/sign-in)

**Files:**
- Create: `apps/react/src/ui/cloud/cloudActions.ts`, `apps/react/src/ui/components/CloudDialog/CloudDialog.tsx`, `.module.css`
- Modify: `apps/react/src/ui/App.tsx` (real dialog render + saveToCloud host action → flow), `apps/react/src/ui/components/FileToolbar/FileToolbar.tsx` (account button, gated on `cloudConfig()`)
- Test: `apps/react/src/ui/cloud/cloudActions.test.ts`, `apps/react/src/ui/components/CloudDialog/CloudDialog.test.tsx`

**Interfaces:**
- Consumes: Task 2 orchestration + Task 3 store actions + Task 5 `getCloudStore`/`getSupabase`/`cloudConfig`.
- Produces:

```ts
// cloudActions.ts (all injectable for tests: deps = { getStore?: () => Promise<CloudStore> })
export function saveToCloudFlow(opts?: { saveAsNew?: boolean; overwriteWith?: string }, deps?): Promise<void>;
// signed-out -> toast; saveAsNew ignores the current link (always insert); overwriteWith = a
// serverUpdatedAt from a conflict -> re-save using it as the CAS expectation (the dialog's
// Overwrite button); success -> setCloudLink + toast; conflict -> toast pointing at the dialog
export function openCloudProjectFlow(id: string, deps?): Promise<void>; // confirmReplaceProject gate -> loadCloudProject -> setProject(project, binaries) + setCloudLink
export function deleteCloudProjectFlow(id: string, deps?): Promise<void>;
export function signInWithMagicLink(email: string): Promise<void>;   // supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: <current origin+base> } })
export function signInWithGitHub(): Promise<void>;                   // supabase.auth.signInWithOAuth({ provider: 'github', options: { redirectTo: <current origin+base> } })
export function signOut(): Promise<void>;                            // supabase.auth.signOut() (store clears via onAuthStateChange)
```

- [ ] **Step 1: Write the failing flow tests** (mock `./supabaseCloudStore` and `@savig/services` orchestration seams with `vi.mock`; drive the real store):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useEditor } from '../store/store';
import * as services from '@savig/services';
import { saveToCloudFlow, openCloudProjectFlow } from './cloudActions';

vi.mock('./supabaseCloudStore', () => ({ getCloudStore: vi.fn(async () => ({}) as never) }));
const saveSpy = vi.spyOn(services, 'saveCloudProject');
const loadSpy = vi.spyOn(services, 'loadCloudProject');

beforeEach(() => {
  useEditor.getState().newProject();
  saveSpy.mockReset();
  loadSpy.mockReset();
});

describe('saveToCloudFlow', () => {
  it('signed out: toasts and does NOT call the service', async () => {
    useEditor.getState().setCloudUser(null);
    await saveToCloudFlow();
    expect(saveSpy).not.toHaveBeenCalled();
    expect(useEditor.getState().toasts.some((t) => /sign in/i.test(t.message))).toBe(true);
  });

  it('signed in + saved: passes the current link and stores the refreshed one', async () => {
    useEditor.getState().setCloudUser({ id: 'u1', email: null });
    useEditor.getState().setCloudLink('p1', 'old-ts');
    saveSpy.mockResolvedValue({ kind: 'saved', link: { projectId: 'p1', updatedAt: 'new-ts' } });
    await saveToCloudFlow();
    expect(saveSpy.mock.calls[0][3]).toEqual({ projectId: 'p1', updatedAt: 'old-ts' });
    expect(useEditor.getState().cloudUpdatedAt).toBe('new-ts');
  });

  it('conflict: toasts the cloud-copy-newer warning and keeps the local link untouched', async () => {
    useEditor.getState().setCloudUser({ id: 'u1', email: null });
    useEditor.getState().setCloudLink('p1', 'old-ts');
    saveSpy.mockResolvedValue({ kind: 'conflict', serverUpdatedAt: 'server-ts' });
    await saveToCloudFlow();
    expect(useEditor.getState().cloudUpdatedAt).toBe('old-ts');
    expect(useEditor.getState().toasts.some((t) => /newer/i.test(t.message))).toBe(true);
  });
});

describe('openCloudProjectFlow', () => {
  it('loads, replaces the project + binaries, and links', async () => {
    useEditor.getState().setCloudUser({ id: 'u1', email: null });
    const project = { ...useEditor.getState().history.present, meta: { ...useEditor.getState().history.present.meta, name: 'Cloudy' } };
    loadSpy.mockResolvedValue({ project, binaries: { h: new Uint8Array([1]) }, link: { projectId: 'p9', updatedAt: 'ts9' } });
    await openCloudProjectFlow('p9');
    expect(useEditor.getState().history.present.meta.name).toBe('Cloudy');
    expect(useEditor.getState().binaries.h).toEqual(new Uint8Array([1]));
    expect(useEditor.getState().cloudProjectId).toBe('p9');
  });

  it('a load failure toasts and leaves the local project untouched', async () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 5, height: 5 });
    useEditor.getState().setCloudUser({ id: 'u1', email: null });
    loadSpy.mockRejectedValue(new Error('object not found'));
    await openCloudProjectFlow('p9');
    expect(useEditor.getState().history.present.objects).toHaveLength(1);
    expect(useEditor.getState().toasts.some((t) => t.kind === 'error')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify FAIL**, **Step 3: Implement `cloudActions.ts`** — thin flows: guard `cloudUser` (else `pushToast('info', 'Sign in to use cloud projects.')` and open the dialog via a host-injected opener OR just toast — match the spec: toast + the palette command itself opens the dialog); saveToCloudFlow reads `{history.present, binaries, cloudProjectId, cloudUpdatedAt}` from a single `getState()` snapshot, calls `saveCloudProject`, handles the three outcomes (saved → `setCloudLink` + success toast; conflict → info toast "Cloud copy is newer — open the Cloud dialog to overwrite or load it"; denied → error toast "Not signed in, or not your project"); openCloudProjectFlow gates on `confirmReplaceProject('Opening a cloud project replaces your current one. Continue?')`, then `setProject(project, binaries)` + `setCloudLink`; wrap every flow's awaits in try/catch → `pushToast('error', ...)`. **Size guard (spec §4):** before saving, compute `new TextEncoder().encode(JSON.stringify(project)).length`; over 5 MB → info toast warning ("Large project (…MB) — cloud saves may be slow"); over the hard limit → error toast + abort WITHOUT calling the service. Verify the actual PostgREST payload limit in the current docs during this task (fetch the docs page, record it in your report; if unfindable, use 20 MB and say so) and unit-test both thresholds (inject a fat project fixture via a long keyframe array or an oversized string field). Sign-in helpers build `redirectTo` as `window.location.origin + import.meta.env.BASE_URL`.

- [ ] **Step 4: Write the failing dialog tests + implement `CloudDialog.tsx`** — overlay (ExportVideoDialog pattern: backdrop, `role="dialog"` aria-label "Cloud projects", Escape closes, focus on mount). Signed OUT: email input (aria-label "Email for magic link") + "Send magic link" + "Sign in with GitHub" + the PKCE caveat line ("Open the link in this same browser…"). Signed IN: email + Sign out header; list from `listCloudProjects` on open (name, updatedAt, Open + Delete per row, `data-testid={cloud-project-<id>}`); "Save current project as new" button (calls saveToCloudFlow with the link temporarily cleared — i.e., a `saveAsNew` variant flag param on saveToCloudFlow); **conflict bar**: when the last save outcome was `conflict`, render an inline 3-button row (data-testid="cloud-conflict-bar": "Overwrite" → re-save with `link.updatedAt = serverUpdatedAt`; "Open cloud copy" → openCloudProjectFlow; "Cancel" → dismiss). Dialog tests (mock `cloudActions` + `@savig/services` list): signed-out panel renders sign-in controls + caveat; signed-in renders list + rows call flows; conflict bar renders its three actions. Toolbar: account button in FileToolbar gated on `cloudConfig() !== null`, aria-label "Cloud account", opens the dialog (via a new prop or the existing host — mirror how other toolbar buttons reach App state; read FileToolbar first).

- [ ] **Step 5: Run** `node_modules/.bin/vitest run apps/react/` + full `node_modules/.bin/vitest run` + `node_modules/.bin/tsc --noEmit` + `node_modules/.bin/eslint .`.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(cloud): CloudDialog (sign-in, projects list, conflict bar) + save/open/delete flows + toolbar account button"`

---

### Task 7: e2e journey (stub network) + docs

**Files:**
- Modify: `playwright.config.ts` (dummy env on the react webServer), `docs/superpowers/INDEX.md` (M10 entry), `docs/superpowers/specs/2026-06-19-savig-animated-svg-editor-design.md` (one-line amendment note at the "No backend" bullet)
- Create: `e2e/cloud-projects.spec.ts`

**Interfaces:**
- Consumes: the whole UI path; supabase-js's network + storage-key conventions (verified in-task).

- [ ] **Step 1: Playwright env** — in `playwright.config.ts`, add to the react webServer entry: `env: { ...process.env, VITE_SUPABASE_URL: 'https://stub.supabase.test', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_stub' }`. The svelte server stays untouched. NOTE: this makes cloud UI visible in ALL react e2e runs — the full suite must stay green (new toolbar button/overlay must not break existing selectors; if one breaks, fix the SPEC's selector to be more specific, never weaken the feature).

- [ ] **Step 2: Doc-check (in-task):** read the supabase-js v2 docs/source for (a) the localStorage session key format (`sb-<project-ref>-auth-token`, ref = first host label — confirm for a custom domain like `stub.supabase.test`) and (b) the minimal persisted-session JSON shape `{ access_token, refresh_token, expires_at, expires_in, token_type, user: { id, email, ... } }`, and (c) which auth endpoints the client calls on boot with a seeded session (`/auth/v1/user` and/or token refresh). Record findings; the spec below stubs whichever endpoints boot actually hits.

- [ ] **Step 3: Write the e2e**

```ts
import { test, expect } from '@playwright/test';

/** M10 cloud journey against a STUBBED Supabase (spec §10): the dev server runs with dummy env
 *  vars pointing at https://stub.supabase.test; every request to that host is intercepted here.
 *  A pre-seeded localStorage session makes the app boot signed-in. No live Supabase anywhere. */
const HOST = 'https://stub.supabase.test';

const row = (over: Record<string, unknown> = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  user_id: 'u-1',
  name: 'Cloud Short',
  data: null as unknown, // filled per-test with a real project JSON captured from the app
  schema_version: 9,
  created_at: '2026-09-14T00:00:00Z',
  updated_at: '2026-09-14T00:00:00Z',
  ...over,
});

test('cloud: signed-in save → list → open → delete against stubbed endpoints', async ({ page }) => {
  const saved: unknown[] = [];
  await page.route(`${HOST}/auth/v1/**`, (r) =>
    r.fulfill({ json: { id: 'u-1', email: 'e2e@savig.test', aud: 'authenticated', role: 'authenticated' } }),
  );
  await page.route(`${HOST}/rest/v1/projects**`, async (r) => {
    const m = r.request().method();
    if (m === 'POST') {
      saved.push(r.request().postDataJSON());
      return r.fulfill({ json: [row({ data: r.request().postDataJSON().data })] });
    }
    if (m === 'GET') return r.fulfill({ json: saved.length ? [row({ data: (saved[0] as { data: unknown }).data })] : [] });
    if (m === 'DELETE') {
      saved.length = 0;
      return r.fulfill({ json: [] });
    }
    return r.fulfill({ json: [] });
  });
  await page.route(`${HOST}/storage/v1/**`, (r) => {
    const m = r.request().method();
    if (r.request().url().includes('/object/list/')) return r.fulfill({ json: [] });
    return r.fulfill({ json: m === 'POST' ? { Key: 'ok' } : [] });
  });
  await page.addInitScript(() => {
    // Seed a persisted session so the app boots signed-in (key shape verified in Step 2).
    const session = {
      access_token: 'stub-access',
      refresh_token: 'stub-refresh',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: 'u-1', email: 'e2e@savig.test', aud: 'authenticated' },
    };
    window.localStorage.setItem('sb-stub-auth-token', JSON.stringify(session));
  });
  await page.goto('/');

  // Draw something so the saved project is non-trivial.
  const stage = page.locator('section[aria-label="Stage"]');
  await page.getByRole('group', { name: 'Tools' }).getByRole('button', { name: 'Rectangle', exact: true }).click();
  const box = (await stage.locator('svg').first().boundingBox())!;
  await page.mouse.move(box.x + 40, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 100);
  await page.mouse.up();
  await page.getByRole('button', { name: 'Select', exact: true }).click();

  // Save to Cloud via the palette.
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k'); // VERIFY against command-palette.spec.ts and use the real gesture
  await page.getByRole('textbox').fill('Save to Cloud');
  await page.keyboard.press('Enter');
  await expect.poll(() => saved.length).toBeGreaterThan(0);

  // Open the Cloud dialog: the saved project lists; open it back.
  await page.getByRole('button', { name: 'Cloud account' }).click();
  const dialog = page.getByRole('dialog', { name: 'Cloud projects' });
  await expect(dialog.getByText('Cloud Short').or(dialog.getByText(/Untitled|Short/))).toBeVisible();
  await dialog.getByRole('button', { name: 'Open', exact: true }).first().click();
  await expect(stage.locator('[data-savig-object]')).toHaveCount(1); // rect came back from the "cloud"

  // Delete it.
  await page.getByRole('button', { name: 'Cloud account' }).click();
  await dialog.getByRole('button', { name: /Delete/ }).first().click();
  await expect.poll(() => saved.length).toBe(0);
});

test('signed-out dialog shows the sign-in panel with the PKCE caveat', async ({ page }) => {
  // (True env-gating — cloud UI absent without env vars — is unit-covered in Task 4; the e2e
  // server always runs WITH the dummy vars, so here we cover the signed-out UI instead.)
  await page.route(`${HOST}/**`, (r) => r.fulfill({ json: {} }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Cloud account' }).click();
  const dialog = page.getByRole('dialog', { name: 'Cloud projects' });
  await expect(dialog.getByLabel('Email for magic link')).toBeVisible();
  await expect(dialog.getByText(/same browser/i)).toBeVisible();
});
```

NOTE: selectors marked VERIFY must be read from the real components/specs first (`command-palette.spec.ts` for the palette gesture; the dialog's real labels from Task 6). PostgREST query params mean the `projects**` glob must tolerate `?select=...` suffixes. If supabase-js boot fires requests not covered by the three routes, add stubs for exactly what it calls (Step 2's findings) rather than a catch-all that masks bugs.

- [ ] **Step 4: Run it** — `pkill -f vite; node_modules/.bin/playwright test e2e/cloud-projects.spec.ts`, iterate stubs until green; then the FULL `node_modules/.bin/playwright test` (the dummy-env change affects every react spec — all must stay green).

- [ ] **Step 5: Docs** — INDEX: add an M10 IN-PROGRESS→DONE entry (feature summary, spec/plan paths, "cloud optional / local-first", NOT pushed note, CLOUD-SETUP.md pointer). Master spec 2026-06-19: at the "**No backend.** Everything runs in the browser." bullet, append: "(Amended by M10, 2026-09-14: local-first with OPTIONAL Supabase cloud — see specs/2026-09-14-cloud-projects-accounts-design.md §2.)"

- [ ] **Step 6: Full gauntlet + commit** — `node_modules/.bin/vitest run` + `node_modules/.bin/tsc --noEmit` + `node_modules/.bin/eslint .` + `node_modules/.bin/playwright test`; exact counts in the report. `git add -A && git commit -m "feat(cloud): stubbed-supabase e2e journey + M10 docs"`
