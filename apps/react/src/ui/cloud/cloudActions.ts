// Thin flows wiring the store to the neutral cloud orchestration
// (packages/services/src/cloud/cloudProjects.ts). Every flow reads ONE getState() snapshot,
// calls the service, and folds the result back into the store as a link update + a toast — never
// throws (every await is wrapped in try/catch -> pushToast('error', ...)).
import {
  deleteCloudProject,
  loadCloudProject,
  saveCloudProject,
  type CloudLink,
  type CloudStore,
} from '@savig/services';
import { useEditor } from '../store/store';
import { confirmReplaceProject } from '../confirmReplace';
import { getCloudStore, getSupabase } from './supabaseCloudStore';

export interface CloudActionDeps {
  getStore?: () => Promise<CloudStore>;
}

const MB = 1024 * 1024;
const WARN_BYTES = 5 * MB;
// Supabase's Data API (PostgREST) request-body size limit is not documented anywhere with a
// concrete number — checked supabase.com/docs/guides/database/api,
// /guides/platform/going-into-prod, /guides/functions/limits and web search; none state a byte
// cap for REST/PostgREST request bodies (as of 2026-09). Falling back to the spec's own 20 MB
// fallback (see task-6-report.md for the full trail).
const HARD_LIMIT_BYTES = 20 * MB;

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function projectSizeBytes(project: unknown): number {
  return new TextEncoder().encode(JSON.stringify(project)).length;
}

function redirectTo(): string {
  return window.location.origin + import.meta.env.BASE_URL;
}

/** Save the current project to the cloud.
 *  - `saveAsNew`: ignore the current link entirely — always inserts a new row.
 *  - `overwriteWith`: re-save using this `updatedAt` (a conflict's `serverUpdatedAt`) as the CAS
 *    expectation instead of the store's own `cloudUpdatedAt` — the conflict bar's Overwrite button. */
export async function saveToCloudFlow(
  opts?: { saveAsNew?: boolean; overwriteWith?: string; onConflict?: (serverUpdatedAt: string) => void },
  deps?: CloudActionDeps,
): Promise<void> {
  const s = useEditor.getState();
  if (!s.cloudUser) {
    s.pushToast('info', 'Sign in to use cloud projects.');
    return;
  }
  const { history, binaries, cloudProjectId, cloudUpdatedAt } = s;
  const project = history.present;

  const size = projectSizeBytes(project);
  if (size > HARD_LIMIT_BYTES) {
    s.pushToast(
      'error',
      `Project is too large to save to the cloud (${(size / MB).toFixed(1)} MB, limit ${(HARD_LIMIT_BYTES / MB).toFixed(0)} MB).`,
    );
    return;
  }
  if (size > WARN_BYTES) {
    s.pushToast('info', `Large project (${(size / MB).toFixed(1)} MB) — cloud saves may be slow.`);
  }

  const link: CloudLink | null =
    opts?.saveAsNew || !cloudProjectId
      ? null
      : { projectId: cloudProjectId, updatedAt: opts?.overwriteWith ?? cloudUpdatedAt! };

  try {
    const store = await (deps?.getStore ?? getCloudStore)();
    const outcome = await saveCloudProject(store, project, binaries, link);
    if (outcome.kind === 'saved') {
      useEditor.getState().setCloudLink(outcome.link.projectId, outcome.link.updatedAt);
      useEditor.getState().pushToast('info', 'Saved to the cloud.');
    } else if (outcome.kind === 'conflict') {
      useEditor.getState().pushToast('info', 'Cloud copy is newer — open the Cloud dialog to overwrite or load it.');
      opts?.onConflict?.(outcome.serverUpdatedAt);
    } else {
      useEditor.getState().pushToast('error', 'Not signed in, or not your project.');
    }
  } catch (err) {
    useEditor.getState().pushToast('error', `Cloud save failed: ${messageOf(err)}`);
  }
}

/** Load a cloud project and replace the current one. Loads FIRST (so a load failure never
 *  prompts a pointless "replace?" confirm), then gates the actual replacement on
 *  `confirmReplaceProject` — a decline leaves the local project untouched, silently. */
export async function openCloudProjectFlow(id: string, deps?: CloudActionDeps): Promise<void> {
  try {
    const store = await (deps?.getStore ?? getCloudStore)();
    const result = await loadCloudProject(store, id);
    if (!result) {
      useEditor.getState().pushToast('error', 'Cloud project not found.');
      return;
    }
    if (!confirmReplaceProject('Opening a cloud project replaces your current one. Continue?')) return;
    useEditor.getState().setProject(result.project, result.binaries);
    useEditor.getState().setCloudLink(result.link.projectId, result.link.updatedAt);
  } catch (err) {
    useEditor.getState().pushToast('error', `Could not open cloud project: ${messageOf(err)}`);
  }
}

/** Delete a cloud project. Clears the local link when the deleted project was the linked one
 *  (otherwise a subsequent Save would silently target a row that no longer exists). */
export async function deleteCloudProjectFlow(id: string, deps?: CloudActionDeps): Promise<void> {
  try {
    const store = await (deps?.getStore ?? getCloudStore)();
    await deleteCloudProject(store, id);
    if (useEditor.getState().cloudProjectId === id) useEditor.getState().clearCloudLink();
    useEditor.getState().pushToast('info', 'Deleted from the cloud.');
  } catch (err) {
    useEditor.getState().pushToast('error', `Could not delete cloud project: ${messageOf(err)}`);
  }
}

export async function signInWithMagicLink(email: string): Promise<void> {
  try {
    const supabase = await getSupabase();
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo() } });
    if (error) throw error;
    useEditor.getState().pushToast('info', 'Magic link sent — check your email.');
  } catch (err) {
    useEditor.getState().pushToast('error', `Could not send magic link: ${messageOf(err)}`);
  }
}

export async function signInWithGitHub(): Promise<void> {
  try {
    const supabase = await getSupabase();
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'github', options: { redirectTo: redirectTo() } });
    if (error) throw error;
  } catch (err) {
    useEditor.getState().pushToast('error', `Could not sign in with GitHub: ${messageOf(err)}`);
  }
}

export async function signOut(): Promise<void> {
  try {
    const supabase = await getSupabase();
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  } catch (err) {
    useEditor.getState().pushToast('error', `Sign out failed: ${messageOf(err)}`);
  }
}
