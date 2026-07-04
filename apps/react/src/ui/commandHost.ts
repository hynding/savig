import type { CommandHost } from '@savig/ui-core';
import { useEditor } from './store/store';
import * as fileOps from './fileOps';

/** Overlay visibility callbacks the App provides (React-local view state). */
export interface OverlayApi {
  openPalette: () => void;
  openShortcuts: () => void;
  closeOverlay: () => void;
}

/** The app's implementation of the neutral CommandHost interface: store action for New, browser
 *  file ops for Open/Save/Export, and overlay toggles for the palette/shortcuts sheet. */
export function makeCommandHost(overlay: OverlayApi): CommandHost {
  return {
    newProject: () => useEditor.getState().newProject(),
    openProject: () => void fileOps.openProject(),
    saveProject: () => void fileOps.saveProject(),
    exportProject: () => void fileOps.exportProject(),
    openPalette: overlay.openPalette,
    openShortcuts: overlay.openShortcuts,
    closeOverlay: overlay.closeOverlay,
  };
}
