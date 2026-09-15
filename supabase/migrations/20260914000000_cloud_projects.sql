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
