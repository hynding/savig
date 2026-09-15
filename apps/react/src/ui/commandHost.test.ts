// makeCommandHost's saveToCloud wiring (final-review M1): a signed-out Save must open the sign-in
// UI (the 'cloud' overlay) IN ADDITION to the toast saveToCloudFlow itself pushes — spec §6:
// "they open the sign-in UI with a toast". cloudActions is mocked so this test only asserts the
// commandHost's own routing, not the flow's internals (covered by cloudActions.test.ts).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useEditor } from './store/store';
import { makeCommandHost, type OverlayApi } from './commandHost';

vi.mock('./cloud/cloudActions', () => ({
  saveToCloudFlow: vi.fn(async () => {}),
}));

function makeOverlay(): OverlayApi {
  return {
    openPalette: vi.fn(),
    openShortcuts: vi.fn(),
    openTemplates: vi.fn(),
    openExportVideo: vi.fn(),
    openGettingStarted: vi.fn(),
    openCloud: vi.fn(),
    closeOverlay: vi.fn(),
  };
}

beforeEach(() => {
  useEditor.getState().newProject();
});

describe('makeCommandHost.saveToCloud', () => {
  it('signed out: opens the cloud overlay (in addition to the flow toast)', () => {
    useEditor.getState().setCloudUser(null);
    const overlay = makeOverlay();
    const host = makeCommandHost(overlay);
    host.saveToCloud();
    expect(overlay.openCloud).toHaveBeenCalledTimes(1);
  });

  it('signed in: does NOT open the cloud overlay', () => {
    useEditor.getState().setCloudUser({ id: 'u1', email: null });
    const overlay = makeOverlay();
    const host = makeCommandHost(overlay);
    host.saveToCloud();
    expect(overlay.openCloud).not.toHaveBeenCalled();
  });
});
