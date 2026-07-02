import type { Project } from '@savig/engine';
import { RUNTIME_JS } from '@savig/runtime/runtimeSource.generated';
import { buildExportBundle, type AssetBinaries } from './buildBundle';
import { zipBundle } from './zipBundle';

// One-call production export: real bundled runtime + deterministic bundle + zip.
export function exportProject(project: Project, binaries: AssetBinaries): Uint8Array {
  return zipBundle(buildExportBundle(project, binaries, RUNTIME_JS));
}
