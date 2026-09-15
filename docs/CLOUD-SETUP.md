# Cloud Projects — Setup Guide (M10)

Savig stays **local-first**: everything (anonymous editing, IndexedDB autosave, file save/open,
all exports) works with zero configuration. Cloud sync ("Save to Cloud" / "Open from Cloud…") is
an **optional, additive** feature backed by [Supabase](https://supabase.com). Without the two env
vars in step 6, the app shows **no cloud UI at all** — no toolbar account button, no palette
commands. This guide is the one-time setup a maintainer/deployer performs; nothing here is needed
to run Savig locally without cloud sync.

Design reference: `docs/superpowers/specs/2026-09-14-cloud-projects-accounts-design.md`.
Schema/RLS reference: `supabase/migrations/20260914000000_cloud_projects.sql`.

## 1. Create a Supabase project

1. Sign in at [supabase.com/dashboard](https://supabase.com/dashboard).
2. Create a new project (pick a region close to your users). Note the **project ref** (the
   short id in the project URL, e.g. `abcdefghijklmnop`) and the **database password** you set.

## 2. Link the Supabase CLI to the project

From the repo root:

```sh
supabase link --project-ref <ref>
```

This associates the local `supabase/` directory (config + migrations, already committed) with
your remote project. You'll be prompted for the database password from step 1.

## 3. Apply the committed migration

```sh
supabase db push
```

This applies `supabase/migrations/20260914000000_cloud_projects.sql`, which creates:

- the `moddatetime` extension (drives `projects.updated_at`);
- table `public.projects` (`id`, `user_id`, `name`, `data`, `schema_version`, `created_at`,
  `updated_at`) with an index on `(user_id, updated_at desc)`;
- row level security on `public.projects`, **owner-only** for all four verbs (`select` / `insert`
  / `update` / `delete`), granted to the `authenticated` role only — `anon` gets nothing;
- the private Storage bucket `project-binaries` (objects live at
  `{user_id}/{project_id}/{asset_id}`), with matching owner-only RLS on `storage.objects` for all
  four verbs.

RLS is the **entire** authorization contract here — there is no API layer in front of it.

## 4. Run the advisors and resolve any findings

```sh
supabase db advisors
```

(Or, if you're using the Supabase MCP server in an editor/agent session, the equivalent
`get_advisors` tool call.) Resolve anything flagged — in particular confirm:

- RLS is enabled on `public.projects` and `storage.objects` (it is, per the migration above);
- no policy is missing a `with check` on `insert`/`update` (all four `projects_*` and
  `binaries_*` policies above carry one where required);
- no table is unexpectedly exposed to `anon`.

## 5. Enable the GitHub auth provider

1. In the GitHub developer settings
   ([github.com/settings/developers](https://github.com/settings/developers)), create a new
   **OAuth App** (not a GitHub App). Set:
   - **Homepage URL**: your deployed app URL (e.g. `https://<user>.github.io/savig/`).
   - **Authorization callback URL**: the value shown by Supabase in the next sub-step
     (`https://<project-ref>.supabase.co/auth/v1/callback`).
2. Copy the generated **Client ID** and **Client Secret**.
3. In the Supabase dashboard: **Authentication → Providers → GitHub** — enable it, paste the
   Client ID and Client Secret, save.

Email **magic link** sign-in needs no separate provider setup — it's on by default under
**Authentication → Providers → Email**.

## 6. Add redirect URLs

Still under **Authentication → URL Configuration**, add both of these to the **Redirect URLs**
allow-list:

- `http://localhost:5173` (local dev)
- `https://<user>.github.io/savig/` (GitHub Pages deploy — substitute your actual Pages path)

Both magic-link and GitHub OAuth redirects are validated against this list.

## 7. Set the two Vite env vars

In the Supabase dashboard: **Settings → API** — copy the **Project URL** and the
**publishable key** (`sb_publishable_...`; do **not** use the `service_role`/secret key anywhere
in this repo — it must never reach client code).

For local dev, create `.env.local` at the repo root (already git-ignored):

```sh
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

For a GitHub Pages deploy that wants cloud sync live, set the same two variables as repo/deploy
environment variables (e.g. GitHub Actions secrets consumed by the Pages build step) so they're
present at build time.

**Without both vars set, the app shows no cloud UI at all** — this is intentional (env-gated
feature, zero-config by default).

## 8. Note: the PKCE same-browser caveat

Magic-link sign-in uses supabase-js's PKCE flow: the code verifier is stored in the browser that
*requested* the link. If the link is opened in a **different** browser or profile than the one
that requested it (e.g. clicked from a phone's mail app when the request was made on desktop),
sign-in will fail. GitHub OAuth has no such constraint. This caveat should be surfaced in the
sign-in UI copy.

## 9. Live smoke checklist (manual, optional — not part of CI)

This is a manual pass against a real linked Supabase project; it is **not** part of the
automated test gauntlet (unit tests use a fake client; e2e mocks the network — see the spec
§10). Run it once after completing steps 1–8, and again after any change touching cloud sync:

1. Sign in via magic link (request the link, open it in the **same** browser).
2. Save a project that includes an audio clip ("Save to Cloud").
3. Reload the page.
4. Open the saved project from the Cloud Projects dialog ("Open from Cloud…").
5. Verify the audio clip plays back correctly.
6. Delete the project from the Cloud Projects dialog and confirm it's gone from the list.

If any step fails, check first: env vars set at build time, redirect URLs match exactly
(including trailing slash), and the `supabase db advisors` output from step 4 is clean.
