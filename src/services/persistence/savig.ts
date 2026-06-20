import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { Project } from '../../engine';
import { SavigLoadError } from '../errors';
import { stableJson } from '../json';
import type { AssetBinaries } from '../export/buildBundle';
import { migrateProject } from './migrate';

export interface SavigFile {
  project: Project;
  binaries: AssetBinaries;
}

const PROJECT_ENTRY = 'project.json';
const ASSET_PREFIX = 'assets/';

export function saveSavig(file: SavigFile): Uint8Array {
  const entries: Record<string, Uint8Array> = {
    [PROJECT_ENTRY]: strToU8(stableJson(file.project)),
  };
  for (const id of Object.keys(file.binaries).sort()) {
    entries[`${ASSET_PREFIX}${id}`] = file.binaries[id];
  }
  return zipSync(entries);
}

export function loadSavig(bytes: Uint8Array): SavigFile {
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(bytes);
  } catch {
    throw new SavigLoadError('File is not a valid .savig archive.');
  }

  const projectEntry = unzipped[PROJECT_ENTRY];
  if (!projectEntry) throw new SavigLoadError('Archive is missing project.json.');

  let raw: unknown;
  try {
    raw = JSON.parse(strFromU8(projectEntry));
  } catch {
    throw new SavigLoadError('project.json is corrupt.');
  }
  // migrateProject throws SavigLoadError / UnsupportedVersionError, which
  // propagate unwrapped so callers can distinguish them.
  const project = migrateProject(raw);

  const binaries: AssetBinaries = {};
  for (const path of Object.keys(unzipped)) {
    if (path.startsWith(ASSET_PREFIX)) binaries[path.slice(ASSET_PREFIX.length)] = unzipped[path];
  }

  return { project, binaries };
}
