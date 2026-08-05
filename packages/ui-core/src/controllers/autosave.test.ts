// Pure unit tests for `makeAutosaveController` — no React, mirroring playback.test.ts: the real
// vanilla `@savig/editor-state` store + fake persistence/serialization ports, driving the
// controller directly.
import { vi } from 'vitest';
import { store } from '@savig/editor-state';
import { createProject } from '@savig/engine';
import type { Project } from '@savig/engine';
import { makeAutosaveController, type AutosaveDeps } from './autosave';

// Trivial "serialization": bytes are the utf-8 project name.
const enc = (name: string) => new TextEncoder().encode(name);
const serialization = {
  loadSavig: (bytes: Uint8Array) => ({
    project: createProject({ name: new TextDecoder().decode(bytes) }),
    binaries: {} as Record<string, Uint8Array>,
  }),
  saveSavig: (input: { project: Project; binaries: Record<string, Uint8Array> }) =>
    enc(input.project.meta.name),
};

const deps = (over: Partial<AutosaveDeps>): AutosaveDeps => ({
  persistence: { load: async () => null, save: () => {} },
  ...serialization,
  delayMs: 5,
  ...over,
});

beforeEach(() => store.getState().newProject());

describe('makeAutosaveController recover()', () => {
  it('applies the loaded bytes when the document is untouched', async () => {
    const c = makeAutosaveController(store, deps({ persistence: { load: async () => enc('Recovered'), save: () => {} } }));
    await c.recover();
    expect(store.getState().history.present.meta.name).toBe('Recovered');
  });

  it('does not clobber a project changed while the load was in flight', async () => {
    let resolveLoad!: (b: Uint8Array | null) => void;
    const persistence = {
      load: () => new Promise<Uint8Array | null>((r) => { resolveLoad = r; }),
      save: () => {},
    };
    const c = makeAutosaveController(store, deps({ persistence }));
    const pending = c.recover();
    // The user loads a template (or edits) before the async IndexedDB read resolves.
    store.getState().setProject(createProject({ name: 'UserLoaded' }));
    resolveLoad(enc('Stale'));
    await pending;
    expect(store.getState().history.present.meta.name).toBe('UserLoaded');
  });
});

describe('makeAutosaveController flush()', () => {
  it('saves a pending debounced change immediately and cancels the timer', () => {
    const save = vi.fn();
    const c = makeAutosaveController(store, deps({ persistence: { load: async () => null, save }, delayMs: 60_000 }));
    const unwatch = c.watch();
    const p = store.getState().history.present;
    store.getState().commit({ ...p, meta: { ...p.meta, name: 'Edited' } });
    expect(save).not.toHaveBeenCalled(); // still debouncing
    c.flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(new TextDecoder().decode(save.mock.calls[0][0] as Uint8Array)).toBe('Edited');
    c.flush(); // no pending change -> no duplicate save
    expect(save).toHaveBeenCalledTimes(1);
    unwatch();
  });
});
