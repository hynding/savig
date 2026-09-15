import { describe, it, expect, beforeEach } from 'vitest';
import { setCommandCapabilities, commandCapabilities } from './capabilities';
import { COMMANDS } from './registry';
import { commandPaletteViewModel } from '../viewmodels/commandPalette';
import { store } from '@savig/editor-state';

beforeEach(() => {
  setCommandCapabilities({ cloudConfigured: false });
  store.getState().newProject();
});

describe('command capabilities + cloud command visibility', () => {
  it('defaults to cloudConfigured false', () => {
    expect(commandCapabilities().cloudConfigured).toBe(false);
  });

  it('cloud commands are HIDDEN from the palette when unconfigured, present when configured', () => {
    // Real export is `commandPaletteViewModel(state, query, isMac)` returning `PaletteResult[]`
    // directly (no `.items` wrapper) — adapted from the brief's sketch per the NOTE.
    const ids = (q: string) => commandPaletteViewModel(store.getState(), q, false).map((i) => i.id);
    expect(ids('cloud')).not.toContain('file.saveToCloud');
    setCommandCapabilities({ cloudConfigured: true });
    const withCloud = ids('cloud');
    expect(withCloud).toContain('file.saveToCloud');
    expect(withCloud).toContain('file.openFromCloud');
    expect(withCloud).toContain('account.signInOut');
  });

  it('every cloud command routes to its host action', () => {
    setCommandCapabilities({ cloudConfigured: true });
    const called: string[] = [];
    const host = {
      saveToCloud: () => called.push('save'),
      openCloudProjects: () => called.push('open'),
      openCloudAccount: () => called.push('account'),
    } as never;
    for (const id of ['file.saveToCloud', 'file.openFromCloud', 'account.signInOut']) {
      COMMANDS.find((c) => c.id === id)!.run({ state: store.getState(), host } as never);
    }
    expect(called).toEqual(['save', 'open', 'account']);
  });
});
