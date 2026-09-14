# Cloud Projects & Accounts (M10) — Design

**Date:** 2026-09-14 · **Status:** approved approach (scope Q&A 2026-09-14) · **Platform:** Supabase

## 1. Goal & scope

Let a signed-in user **save projects to the cloud, list them, and open them from any device** —
while the app stays **local-first**: everything that works today (anonymous editing, IndexedDB
autosave, file save/open, all exports) keeps working unchanged with zero cloud configuration.

**In scope (v1):** Supabase auth (email magic link + GitHub OAuth); a `projects` table
(project JSON + metadata, owner-only RLS); a private Storage bucket for binaries; "Save to
Cloud", "Open from Cloud…" palette commands + a Cloud Projects dialog + a toolbar account
control; last-write-wins saves guarded by an `updated_at` freshness check; env-gated — cloud UI
hides entirely when Supabase env vars are absent.

**Out of scope (v1)** — §12: share links, render service (native ffmpeg/WebM — spec 2026-09-12
§11), realtime collaboration (M11), background auto-sync, binary orphan GC, account deletion UI.

## 2. Constraint revision

The master spec (2026-06-19 §"No backend") said "**No backend. Everything runs in the
browser.**" M10 amends this to: **local-first, cloud optional** — the browser app remains fully
functional standalone; Supabase is an optional, additive remote. No app-hosting change (GitHub
Pages stays); Supabase is a separate managed service the client talks to directly.

## 3. Architecture (approved: direct supabase-js, hybrid storage)

- **No API layer.** `supabase-js` (pinned, lazily imported) talks straight to Supabase with the
  **publishable key**; RLS is the entire authorization contract. (An Edge-Function layer only
  becomes relevant with the future render service.)
- **Hybrid storage:** the project JSON lives in Postgres `jsonb` (queryable metadata, cheap
  updates); binaries (audio bytes) live in a private Storage bucket. Assets are already
  content-addressed in this codebase (importAudio), so **binaries are immutable**: a save
  uploads only binaries the cloud doesn't have yet; a load fetches the row + the binaries its
  `assets` list names.
- **Neutral core + thin app layer** (the repo's DI pattern): `packages/services/src/cloud/`
  holds the logic against an **injectable client interface** (unit-testable with a fake);
  `apps/react` wires the real client, session state, and UI.

## 4. Data model + RLS

```sql
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null default 'Untitled',
  data jsonb not null,                -- the .savig project JSON (post-migration, current version)
  schema_version int not null,        -- copy of data.version for querying/migration sweeps
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()   -- trigger-maintained (moddatetime)
);
create index projects_user_recent on public.projects (user_id, updated_at desc);
alter table public.projects enable row level security;
```

Policies follow the skill checklist exactly — owner-only, `TO authenticated`, `(select
auth.uid()) = user_id`, and **UPDATE carries both `USING` and `WITH CHECK`** (as does INSERT's
`WITH CHECK`) so a row can never be reassigned to another user. All four verbs get a policy.
No `user_metadata` is used anywhere in authorization.

**Storage:** private bucket `project-binaries`, object path `{user_id}/{project_id}/{asset_id}`.
Policies for `authenticated` on **INSERT + SELECT + UPDATE + DELETE**, each scoped by
`(storage.foldername(name))[1] = (select auth.uid())::text` (upsert requires all of
INSERT/SELECT/UPDATE — checklist item). Per-project paths give a clean delete story (project
delete removes its folder); cross-project dedupe of identical audio is deliberately NOT done
(rare; orphan-free lifecycle wins).

**Size guard:** client warns above ~5 MB of project JSON and refuses above the PostgREST
payload limit with a clear message (exact limit verified at implementation time).

## 5. Auth

Email **magic link** + **GitHub OAuth** via supabase-js. Session persistence is supabase-js's
default (localStorage); `onAuthStateChange` mirrors `{ userId, email }` into a transient store
field (`cloudUser`, never in history — the previewMode pattern). Signing out only clears cloud
state — the local project is untouched (local-first invariant). OAuth redirect URLs must
include the GitHub Pages subpath (`https://<user>.github.io/savig/`) and localhost dev — listed
in the §11 ops checklist.

## 6. Client integration

- `packages/services/src/cloud/cloudProjects.ts`: `listProjects`, `saveProject` (insert or
  update + upload missing binaries), `loadProject` (row + binaries → `{project, binaries}`
  through the existing `migrateProject` path), `deleteProject` — all against a narrow injected
  `CloudClientLike` interface (tables + storage + auth surface actually used, nothing more).
- `apps/react/src/ui/cloud/`: lazy client factory (dynamic `import('@supabase/supabase-js')`;
  env-gated), `useCloudSession` hook, `CloudProjectsDialog` (overlay pattern: list with name /
  updated-at, Open / Delete / Save-current-as-new), toolbar account button (sign in choices,
  signed-in email, sign out).
- Palette commands: `file.saveToCloud`, `file.openFromCloud`, `account.signInOut` — all hidden
  (not just disabled) when cloud is unconfigured. When configured but signed OUT, the commands
  stay visible and route to the sign-in flow first (save/open resumes after auth completes or
  is simply re-invoked — v1 keeps it simple: they open the sign-in UI with a toast).
- **Env gating:** `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY`; both absent → zero
  cloud UI, zero supabase-js in the loaded bundle (dynamic import never triggered).

## 7. Sync semantics (v1: explicit, last-write-wins with a guard)

- Saves and opens are **explicit user actions**. Autosave remains IndexedDB-only.
- The store tracks transient `cloudProjectId` + `cloudUpdatedAt` for the currently-linked
  project. On save: if the server row's `updated_at` is newer than `cloudUpdatedAt`, warn
  ("Cloud copy is newer — overwrite / open cloud copy / cancel") before writing. After a
  successful save, refresh `cloudUpdatedAt` from the returned row.
- Open replaces the working project (same confirm-if-dirty gate the template/open flows use)
  and sets the link fields. "Save as new" always inserts a fresh row.
- Binaries upload before the row write (a row must never reference bytes the bucket lacks);
  failed uploads abort the save with a toast.

## 8. Error handling

Every cloud call surfaces failures as toasts (the established pattern) and never corrupts local
state; offline/unconfigured/unauthenticated are distinguished in copy. RLS denials read as
"not signed in / not your project" — never silent empty successes (the checklist's silent-0-rows
UPDATE trap is why the update guard checks the returned row).

## 9. Security (skill checklist applied)

Publishable key only in the client (no service_role anywhere in the repo); RLS on from the
first migration with the exact policy shapes of §4; no `user_metadata` in authz; storage upsert
has INSERT+SELECT+UPDATE; supabase-js **pinned** + lockfile committed; project JSON loaded from
the cloud passes through the SAME migrate/sanitize path as a `.savig` opened from disk
(cloud data is untrusted input, exactly like a file). A security review runs before merge.

## 10. Testing

- **Unit (the bulk):** `cloudProjects` against a fake `CloudClientLike` — save inserts vs
  updates, uploads only missing binaries, binaries-before-row ordering, conflict guard paths,
  load pipes through migrate/sanitize, delete. Dialog/hook tests with the service mocked
  (ExportVideoDialog idiom). Env-gating tests (no vars → no commands registered/rendered).
- **e2e (mocked network):** Playwright with `page.route` stubbing the Supabase REST/storage
  endpoints — sign-in state injected, save/open/list flows through the real UI. No live
  Supabase in CI.
- **Live smoke (manual/optional):** a documented local checklist against a real project +
  `supabase start`; NOT part of the gauntlet.

## 11. Config & ops

Committed `supabase/` dir (config + migrations) using the skill's imperative-migration
workflow (iterate via direct SQL, commit via `supabase db pull`; advisors before committing).
Implementation slice 1 MUST follow skill Principle 1: fetch the changelog + current docs for
auth/storage/RLS APIs before writing client code. **User-side setup checklist** (documented in
the repo, performed in the dashboard): create Supabase project; enable GitHub provider (GitHub
OAuth app id/secret); add redirect URLs (Pages subpath + localhost); apply migrations
(`supabase link` + `supabase db push`); set the two Vite env vars for deploys that want cloud.

## 12. Deferred / non-goals (v1)

Share links (public read-only + "open a copy"); render service (native ffmpeg — unlocks WebM,
spec 2026-09-12 §11); realtime/M11; background auto-sync & offline queue; binary orphan GC and
cross-project dedupe; account deletion / data export UI; MCP cloud tools.
