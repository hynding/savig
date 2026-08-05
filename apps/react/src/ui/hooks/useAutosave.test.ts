import { renderHook, act, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { useAutosave } from './useAutosave';
import { useEditor } from '../store/store';
import { createAutosaveStore, saveSavig } from '@savig/services';
import type { AutosaveStore } from '@savig/services';
import { createProject } from '@savig/engine';

function memStore(initial: Uint8Array | null = null) {
  let data = initial;
  const store: AutosaveStore = {
    save: vi.fn(async (b: Uint8Array) => {
      data = b;
    }),
    load: vi.fn(async () => data),
    clear: vi.fn(async () => {
      data = null;
    }),
  };
  return store;
}

beforeEach(() => useEditor.getState().newProject());

it('recovers an autosaved project on mount', async () => {
  const bytes = saveSavig({ project: createProject({ name: 'Recovered' }), binaries: {} });
  renderHook(() => useAutosave(memStore(bytes), 10));
  await waitFor(() => expect(useEditor.getState().history.present.meta.name).toBe('Recovered'));
});

it('does not re-save the project it just recovered', async () => {
  const store = memStore(saveSavig({ project: createProject({ name: 'Recovered' }), binaries: {} }));
  renderHook(() => useAutosave(store, 10));
  await waitFor(() => expect(useEditor.getState().history.present.meta.name).toBe('Recovered'));
  await new Promise((r) => setTimeout(r, 40)); // longer than the debounce
  expect(store.save).not.toHaveBeenCalled();
});

it('debounce-saves on document change', async () => {
  const store = memStore();
  renderHook(() => useAutosave(store, 10));
  act(() => {
    const p = useEditor.getState().history.present;
    useEditor.getState().commit({ ...p, meta: { ...p.meta, name: 'Edited' } });
  });
  await waitFor(() => expect(store.save).toHaveBeenCalled());
});

it('flushes a pending debounced save on pagehide', async () => {
  const store = memStore();
  renderHook(() => useAutosave(store, 60_000)); // debounce far in the future
  act(() => {
    const p = useEditor.getState().history.present;
    useEditor.getState().commit({ ...p, meta: { ...p.meta, name: 'Edited' } });
  });
  expect(store.save).not.toHaveBeenCalled();
  act(() => {
    window.dispatchEvent(new Event('pagehide'));
  });
  expect(store.save).toHaveBeenCalledTimes(1);
});

// Regression (template-load / play-breaks bug): the DEFAULT persistence backend must be stable
// across re-renders. A default parameter `store = createAutosaveStore()` runs on EVERY render,
// which rebuilt the controller and re-fired recover() on every App re-render — restoring stale
// autosave bytes over the live project (template loads silently undone, playback stopped via
// TRANSIENT_DEFAULTS' playing:false) and clearing pending debounced saves on effect cleanup.
describe('default backend stability across re-renders', () => {
  afterEach(async () => {
    await createAutosaveStore().clear(); // fake-indexeddb is global — don't leak bytes across tests
  });

  it('does not restore stale autosave bytes over a project loaded after mount', async () => {
    const seeded = createAutosaveStore();
    await seeded.save(saveSavig({ project: createProject({ name: 'Stale' }), binaries: {} }));
    const { rerender } = renderHook(() => useAutosave(undefined, 10));
    await waitFor(() => expect(useEditor.getState().history.present.meta.name).toBe('Stale'));
    act(() => {
      useEditor.getState().setProject(createProject({ name: 'Fresh template' }));
    });
    rerender(); // e.g. an overlay closing re-renders <App> — must NOT re-run recover
    await new Promise((r) => setTimeout(r, 50));
    expect(useEditor.getState().history.present.meta.name).toBe('Fresh template');
  });

  it('a pending debounced save survives a re-render', async () => {
    const { rerender } = renderHook(() => useAutosave(undefined, 10));
    await new Promise((r) => setTimeout(r, 20)); // let the mount recover() resolve (no bytes)
    act(() => {
      const p = useEditor.getState().history.present;
      useEditor.getState().commit({ ...p, meta: { ...p.meta, name: 'Edited' } });
    });
    rerender(); // must NOT rebuild the controller and clear the pending debounce timer
    await waitFor(async () => {
      expect(await createAutosaveStore().load()).not.toBeNull();
    });
  });
});
