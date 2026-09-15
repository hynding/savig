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
  // Project.version lives at meta.version (packages/engine/src/project.ts createProject) — there
  // is no top-level `version` field on Project.
  const rowPatch = { name: project.meta.name, data: project as unknown, schema_version: project.meta.version };
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
