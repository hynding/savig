import type { CommandHost } from '@savig/ui-core';
import { requestNewProject } from './confirmReplace';
import * as fileOps from './fileOps';

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
    // Task 6 lands the real cloud-projects dialog and swaps `saveToCloud` to the actual save
    // flow (`void import('./cloud/cloudActions').then((m) => m.saveToCloudFlow())`); for now all
    // three just surface the 'cloud' overlay (see CloudDialog placeholder + App.tsx) — reachable
    // only once the app registers `setCommandCapabilities({ cloudConfigured: true })`, i.e. once
    // VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY are configured (cloud/env.ts).
    saveToCloud: overlay.openCloud,
    openCloudProjects: overlay.openCloud,
    openCloudAccount: overlay.openCloud,
  };
}
