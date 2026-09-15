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
