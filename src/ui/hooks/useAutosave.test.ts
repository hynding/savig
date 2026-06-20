import { renderHook, act, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { useAutosave } from './useAutosave';
import { useEditor } from '../store/store';
import { saveSavig } from '../../services';
import type { AutosaveStore } from '../../services';
import { createProject } from '../../engine';

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

it('debounce-saves on document change', async () => {
  const store = memStore();
  renderHook(() => useAutosave(store, 10));
  act(() => {
    const p = useEditor.getState().history.present;
    useEditor.getState().commit({ ...p, meta: { ...p.meta, name: 'Edited' } });
  });
  await waitFor(() => expect(store.save).toHaveBeenCalled());
});
