// Flow tests for cloudActions.ts (spec Task 6). The supabase adapter (`./supabaseCloudStore`) is
// mocked wholesale — these tests exercise the FLOW logic (store reads/writes, toasts, the
// three-way saveCloudProject outcome fold), not the real network. `@savig/services` is mocked via
// `vi.mock(..., async (importOriginal) => ...)` rather than `vi.spyOn` — spyOn on this package's
// namespace exports throws "Cannot redefine property" under Vitest's ESM transform (the module's
// exports are frozen), so importOriginal + override is the supported mechanism here.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useEditor } from '../store/store';
import * as services from '@savig/services';
import {
  saveToCloudFlow,
  openCloudProjectFlow,
  deleteCloudProjectFlow,
  signInWithMagicLink,
  signInWithGitHub,
  signOut,
} from './cloudActions';

vi.mock('./supabaseCloudStore', () => ({
  getCloudStore: vi.fn(async () => ({}) as never),
  getSupabase: vi.fn(async () => fakeSupabase),
}));

const fakeSupabase = {
  auth: {
    signInWithOtp: vi.fn(async () => ({ data: {}, error: null })),
    signInWithOAuth: vi.fn(async () => ({ data: {}, error: null })),
    signOut: vi.fn(async () => ({ error: null })),
  },
};

vi.mock('@savig/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@savig/services')>()),
  saveCloudProject: vi.fn(),
  loadCloudProject: vi.fn(),
  deleteCloudProject: vi.fn(),
}));

const saveSpy = vi.spyOn(services, 'saveCloudProject');
const loadSpy = vi.spyOn(services, 'loadCloudProject');
const deleteSpy = vi.spyOn(services, 'deleteCloudProject');

beforeEach(() => {
  useEditor.getState().newProject();
  saveSpy.mockReset();
  loadSpy.mockReset();
  deleteSpy.mockReset();
  fakeSupabase.auth.signInWithOtp.mockClear();
  fakeSupabase.auth.signInWithOAuth.mockClear();
  fakeSupabase.auth.signOut.mockClear();
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

  it('denied: toasts a not-signed-in/not-your-project error', async () => {
    useEditor.getState().setCloudUser({ id: 'u1', email: null });
    useEditor.getState().setCloudLink('p1', 'old-ts');
    saveSpy.mockResolvedValue({ kind: 'denied' });
    await saveToCloudFlow();
    expect(useEditor.getState().toasts.some((t) => t.kind === 'error')).toBe(true);
  });

  it('saveAsNew ignores the current link (always inserts)', async () => {
    useEditor.getState().setCloudUser({ id: 'u1', email: null });
    useEditor.getState().setCloudLink('p1', 'old-ts');
    saveSpy.mockResolvedValue({ kind: 'saved', link: { projectId: 'p2', updatedAt: 'ts2' } });
    await saveToCloudFlow({ saveAsNew: true });
    expect(saveSpy.mock.calls[0][3]).toBeNull();
    expect(useEditor.getState().cloudProjectId).toBe('p2');
  });

  it('overwriteWith re-saves using the given updatedAt as the CAS expectation', async () => {
    useEditor.getState().setCloudUser({ id: 'u1', email: null });
    useEditor.getState().setCloudLink('p1', 'old-ts');
    saveSpy.mockResolvedValue({ kind: 'saved', link: { projectId: 'p1', updatedAt: 'ts-after-overwrite' } });
    await saveToCloudFlow({ overwriteWith: 'server-ts' });
    expect(saveSpy.mock.calls[0][3]).toEqual({ projectId: 'p1', updatedAt: 'server-ts' });
  });

  it('warns but still saves when the project is over the 5 MB soft threshold', async () => {
    useEditor.getState().setCloudUser({ id: 'u1', email: null });
    const s = useEditor.getState();
    s.commit({ ...s.history.present, meta: { ...s.history.present.meta, name: 'x'.repeat(6 * 1024 * 1024) } });
    saveSpy.mockResolvedValue({ kind: 'saved', link: { projectId: 'p1', updatedAt: 'ts' } });
    await saveToCloudFlow();
    expect(saveSpy).toHaveBeenCalledOnce();
    expect(useEditor.getState().toasts.some((t) => /large project/i.test(t.message))).toBe(true);
  });

  it('aborts WITHOUT calling the service when the project is over the hard size limit', async () => {
    useEditor.getState().setCloudUser({ id: 'u1', email: null });
    const s = useEditor.getState();
    s.commit({ ...s.history.present, meta: { ...s.history.present.meta, name: 'x'.repeat(21 * 1024 * 1024) } });
    await saveToCloudFlow();
    expect(saveSpy).not.toHaveBeenCalled();
    expect(useEditor.getState().toasts.some((t) => t.kind === 'error' && /too large/i.test(t.message))).toBe(true);
  });

  it('conflict: invokes the onConflict callback with the serverUpdatedAt, and suppresses the generic toast', async () => {
    useEditor.getState().setCloudUser({ id: 'u1', email: null });
    useEditor.getState().setCloudLink('p1', 'old-ts');
    saveSpy.mockResolvedValue({ kind: 'conflict', serverUpdatedAt: 'server-ts' });
    const onConflict = vi.fn();
    await saveToCloudFlow({ onConflict });
    expect(onConflict).toHaveBeenCalledWith('server-ts');
    // The caller is already showing its own conflict UI (the dialog's inline bar) — the generic
    // "open the Cloud dialog…" toast would be redundant/confusing there.
    expect(useEditor.getState().toasts.some((t) => /newer/i.test(t.message))).toBe(false);
  });

  it('a thrown service error toasts rather than propagating', async () => {
    useEditor.getState().setCloudUser({ id: 'u1', email: null });
    saveSpy.mockRejectedValue(new Error('network down'));
    await saveToCloudFlow();
    expect(useEditor.getState().toasts.some((t) => t.kind === 'error' && /network down/.test(t.message))).toBe(true);
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
    vi.spyOn(window, 'confirm').mockReturnValue(true); // consent given; the load itself then fails
    loadSpy.mockRejectedValue(new Error('object not found'));
    await openCloudProjectFlow('p9');
    expect(useEditor.getState().history.present.objects).toHaveLength(1);
    expect(useEditor.getState().toasts.some((t) => t.kind === 'error')).toBe(true);
  });

  it('gates on confirmReplaceProject BEFORE loading — a decline never fetches and leaves the project untouched, silently', async () => {
    useEditor.getState().addVectorShape('rect', { x: 0, y: 0, width: 5, height: 5 });
    useEditor.getState().setCloudUser({ id: 'u1', email: null });
    const project = { ...useEditor.getState().history.present, meta: { ...useEditor.getState().history.present.meta, name: 'Cloudy' } };
    loadSpy.mockResolvedValue({ project, binaries: {}, link: { projectId: 'p9', updatedAt: 'ts9' } });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await openCloudProjectFlow('p9');
    expect(confirm).toHaveBeenCalled();
    expect(loadSpy).not.toHaveBeenCalled(); // no network fetch before consent
    expect(useEditor.getState().history.present.meta.name).not.toBe('Cloudy');
    expect(useEditor.getState().cloudProjectId).toBeNull();
    expect(useEditor.getState().toasts).toHaveLength(0);
  });

  it('a pristine project skips the confirm prompt entirely (nothing to lose)', async () => {
    useEditor.getState().setCloudUser({ id: 'u1', email: null });
    const confirm = vi.spyOn(window, 'confirm');
    const project = { ...useEditor.getState().history.present, meta: { ...useEditor.getState().history.present.meta, name: 'Cloudy' } };
    loadSpy.mockResolvedValue({ project, binaries: {}, link: { projectId: 'p9', updatedAt: 'ts9' } });
    await openCloudProjectFlow('p9');
    expect(confirm).not.toHaveBeenCalled();
    expect(useEditor.getState().history.present.meta.name).toBe('Cloudy');
  });
});

describe('deleteCloudProjectFlow', () => {
  it('deletes and clears the local link when the deleted project was the linked one', async () => {
    useEditor.getState().setCloudUser({ id: 'u1', email: null });
    useEditor.getState().setCloudLink('p1', 'ts1');
    deleteSpy.mockResolvedValue(undefined);
    await deleteCloudProjectFlow('p1');
    expect(deleteSpy).toHaveBeenCalledOnce();
    expect(useEditor.getState().cloudProjectId).toBeNull();
  });

  it('a delete failure toasts an error', async () => {
    useEditor.getState().setCloudUser({ id: 'u1', email: null });
    deleteSpy.mockRejectedValue(new Error('denied'));
    await deleteCloudProjectFlow('p1');
    expect(useEditor.getState().toasts.some((t) => t.kind === 'error')).toBe(true);
  });
});

describe('sign-in / sign-out helpers', () => {
  it('signInWithMagicLink calls signInWithOtp with an emailRedirectTo built from the current origin', async () => {
    await signInWithMagicLink('a@b.com');
    expect(fakeSupabase.auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'a@b.com',
      options: { emailRedirectTo: window.location.origin + import.meta.env.BASE_URL },
    });
  });

  it('signInWithGitHub calls signInWithOAuth with a redirectTo built from the current origin', async () => {
    await signInWithGitHub();
    expect(fakeSupabase.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'github',
      options: { redirectTo: window.location.origin + import.meta.env.BASE_URL },
    });
  });

  it('signOut calls supabase auth signOut', async () => {
    await signOut();
    expect(fakeSupabase.auth.signOut).toHaveBeenCalledOnce();
  });
});
