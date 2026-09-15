import type { CommandHost } from '@savig/ui-core';
import { requestNewProject } from './confirmReplace';
import * as fileOps from './fileOps';
import { saveToCloudFlow } from './cloud/cloudActions';
import { useEditor } from './store/store';

/** Overlay visibility callbacks the App provides (React-local view state). */
export interface OverlayApi {
  openPalette: () => void;
  openShortcuts: () => void;
  openTemplates: () => void;
  openExportVideo: () => void;
  openGettingStarted: () => void;
  openCloud: () => void;
  closeOverlay: () => void;
}

/** The app's implementation of the neutral CommandHost interface: store action for New, browser
 *  file ops for Open/Save/Export, and overlay toggles for the palette/shortcuts sheet. */
export function makeCommandHost(overlay: OverlayApi): CommandHost {
  return {
    newProject: requestNewProject,
    openProject: () => void fileOps.openProject(),
    saveProject: () => void fileOps.saveProject(),
    exportProject: () => void fileOps.exportProject(),
    exportSvg: () => void fileOps.exportSvg(),
    exportAnimatedSvg: () => void fileOps.exportAnimatedSvg(),
    openPalette: overlay.openPalette,
    openShortcuts: overlay.openShortcuts,
    openTemplates: overlay.openTemplates,
    openExportVideo: overlay.openExportVideo,
    openGettingStarted: overlay.openGettingStarted,
    closeOverlay: overlay.closeOverlay,
    // Save runs the real flow directly (no dialog round-trip needed for the common case — a
    // conflict toasts pointing at the dialog); Open/Account are inherently dialog-driven (need
    // the projects list / sign-in controls) so they always surface the 'cloud' overlay
    // (CloudDialog.tsx) — reachable only once the app registers
    // `setCommandCapabilities({ cloudConfigured: true })`, i.e. once VITE_SUPABASE_URL /
    // VITE_SUPABASE_PUBLISHABLE_KEY are configured (cloud/env.ts). A signed-out Save ALSO opens
    // that overlay (spec §6: "they open the sign-in UI with a toast") in addition to
    // saveToCloudFlow's own toast, so the user lands on the sign-in panel instead of having to
    // find it themselves.
    saveToCloud: () => {
      if (!useEditor.getState().cloudUser) overlay.openCloud();
      void saveToCloudFlow();
    },
    openCloudProjects: overlay.openCloud,
    openCloudAccount: overlay.openCloud,
  };
}
