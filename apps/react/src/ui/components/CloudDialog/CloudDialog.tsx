// Cloud projects browser + account dialog (spec Task 6). Overlay pattern mirrors ExportVideoDialog
// (backdrop, role="dialog", Escape-to-close, focus on mount). Signed OUT shows the two sign-in
// entry points (magic link + GitHub OAuth) plus the PKCE caveat (the magic-link/OAuth redirect
// must land back in the SAME browser that started it — Supabase's PKCE flow keeps its code
// verifier in that browser's storage). Signed IN shows the account row, Save / Save-as-new, the
// project list (fetched fresh on every mount), and — after a conflicting Save — an inline bar to
// resolve it without leaving the dialog.
import { useEffect, useRef, useState } from 'react';
import { listCloudProjects, type CloudProjectMeta } from '@savig/services';
import { useEditor } from '../../store/store';
import { getCloudStore } from '../../cloud/supabaseCloudStore';
import {
  saveToCloudFlow,
  openCloudProjectFlow,
  deleteCloudProjectFlow,
  signInWithMagicLink,
  signInWithGitHub,
  signOut,
} from '../../cloud/cloudActions';
import styles from './CloudDialog.module.css';

export function CloudDialog({ onClose }: { onClose: () => void }) {
  const cloudUser = useEditor((s) => s.cloudUser);
  const cloudProjectId = useEditor((s) => s.cloudProjectId);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [email, setEmail] = useState('');
  const [projects, setProjects] = useState<CloudProjectMeta[]>([]);
  const [conflict, setConflict] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const refresh = async () => {
    const store = await getCloudStore();
    setProjects(await listCloudProjects(store));
  };

  // Re-fetch whenever the signed-in identity changes (sign in, or a different account); the list
  // is otherwise only refreshed after an action that could change it (save/delete).
  const cloudUserId = cloudUser?.id ?? null;
  useEffect(() => {
    if (cloudUserId) void refresh();
  }, [cloudUserId]);

  const save = async (saveAsNew: boolean) => {
    setBusy(true);
    try {
      await saveToCloudFlow({ saveAsNew, onConflict: setConflict });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const overwrite = async () => {
    const serverUpdatedAt = conflict;
    if (!serverUpdatedAt) return;
    setConflict(null);
    setBusy(true);
    try {
      await saveToCloudFlow({ overwriteWith: serverUpdatedAt, onConflict: setConflict });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const openLinkedCloudCopy = async () => {
    setConflict(null);
    if (!cloudProjectId) return;
    await openCloudProjectFlow(cloudProjectId);
    onClose();
  };

  const open = async (id: string) => {
    await openCloudProjectFlow(id);
    onClose();
  };

  const del = async (id: string, name: string) => {
    if (!window.confirm(`Delete "${name}" from the cloud? This cannot be undone.`)) return;
    await deleteCloudProjectFlow(id);
    await refresh();
  };

  return (
    <div
      className={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label="Cloud projects"
      tabIndex={-1}
      ref={dialogRef}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>Cloud projects</h2>
          <button type="button" aria-label="Close" onClick={onClose}>
            Close
          </button>
        </div>

        {!cloudUser ? (
          <div className={styles.signIn}>
            <label>
              Email
              <input
                aria-label="Email for magic link"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <div className={styles.actions}>
              <button type="button" disabled={!email} onClick={() => void signInWithMagicLink(email)}>
                Send magic link
              </button>
              <button type="button" onClick={() => void signInWithGitHub()}>
                Sign in with GitHub
              </button>
            </div>
            <p className={styles.caveat}>
              Open the link in this same browser — cloud sign-in cannot complete in a different one.
            </p>
          </div>
        ) : (
          <div className={styles.signedIn}>
            <div className={styles.accountRow}>
              <span>{cloudUser.email ?? cloudUser.id}</span>
              <button type="button" onClick={() => void signOut()}>
                Sign out
              </button>
            </div>

            {conflict && (
              <div className={styles.conflictBar} data-testid="cloud-conflict-bar">
                <span>Cloud copy is newer.</span>
                <button type="button" onClick={() => void overwrite()}>
                  Overwrite
                </button>
                <button type="button" onClick={() => void openLinkedCloudCopy()}>
                  Open cloud copy
                </button>
                <button type="button" onClick={() => setConflict(null)}>
                  Cancel
                </button>
              </div>
            )}

            <div className={styles.actions}>
              <button type="button" disabled={busy} onClick={() => void save(false)}>
                Save
              </button>
              <button type="button" disabled={busy} onClick={() => void save(true)}>
                Save current project as new
              </button>
            </div>

            <ul className={styles.list}>
              {projects.map((p) => (
                <li key={p.id} className={styles.row} data-testid={`cloud-project-${p.id}`}>
                  <span className={styles.name}>{p.name}</span>
                  <span className={styles.updatedAt}>{p.updatedAt}</span>
                  <button type="button" onClick={() => void open(p.id)}>
                    Open
                  </button>
                  <button type="button" onClick={() => void del(p.id, p.name)}>
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
