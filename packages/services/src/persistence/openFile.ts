import { strFromU8 } from 'fflate';
import { SavigLoadError } from '../errors';
import { base64ToBytes } from '../bytes';
import type { AssetBinaries } from '../export/buildBundle';
import { loadSavig, type SavigFile } from './savig';
import { migrateProject } from './migrate';

export type OpenedFile =
  | { kind: 'project'; file: SavigFile }
  | { kind: 'plain-svg'; source: string };

/** Sniff open-dialog bytes: .savig zip, an SVG with an embedded savig project (round-trip
 *  export), or a plain SVG the caller may wrap as an asset. Version gating for embedded
 *  projects is migrateProject — identical to the .savig path. */
export function loadProjectOrSvg(bytes: Uint8Array): OpenedFile {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return { kind: 'project', file: loadSavig(bytes) };

  const source = strFromU8(bytes);
  const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (doc.querySelector('parsererror') || doc.documentElement.tagName.toLowerCase() !== 'svg') {
    throw new SavigLoadError('File is neither a .savig archive nor an SVG document.');
  }

  const meta = doc.querySelector('metadata[data-savig-source="project"]');
  if (!meta) return { kind: 'plain-svg', source };

  let payload: { project?: unknown; audio?: Record<string, string> };
  try {
    payload = JSON.parse(meta.textContent ?? '');
  } catch {
    throw new SavigLoadError('Embedded Savig project data is corrupt.');
  }
  const project = migrateProject(payload.project);
  const binaries: AssetBinaries = {};
  const audio = payload.audio;
  if (audio !== undefined) {
    if (typeof audio !== 'object' || audio === null || Array.isArray(audio)) {
      throw new SavigLoadError('Embedded Savig project data is corrupt.');
    }
    try {
      for (const [id, b64] of Object.entries(audio)) binaries[id] = base64ToBytes(b64);
    } catch {
      throw new SavigLoadError('Embedded Savig project data is corrupt.');
    }
  }
  return { kind: 'project', file: { project, binaries } };
}
