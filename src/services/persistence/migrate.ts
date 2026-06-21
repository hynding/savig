import type { Project } from '../../engine';
import { SavigLoadError, UnsupportedVersionError } from '../errors';

export const CURRENT_VERSION = 3;

// Keyed by the version being upgraded FROM.
// v1 -> v2 introduced vector assets + geometry tracks.
// v2 -> v3 introduced path vector assets + stroke cap/join (both optional);
// old files have neither, so each upgrade only stamps the version.
export const migrations: Record<number, (doc: Project) => Project> = {
  1: (doc) => ({ ...doc, meta: { ...doc.meta, version: 2 } }),
  2: (doc) => ({ ...doc, meta: { ...doc.meta, version: 3 } }),
};

export function migrateProject(doc: unknown): Project {
  if (!isProjectShape(doc)) {
    throw new SavigLoadError('File does not contain a Savig project.');
  }
  let version = doc.meta.version;
  if (version > CURRENT_VERSION) {
    throw new UnsupportedVersionError(
      `Project version ${version} is newer than supported (${CURRENT_VERSION}). Update Savig to open it.`,
    );
  }
  let project = doc;
  while (version < CURRENT_VERSION) {
    const migrate = migrations[version];
    if (!migrate) throw new SavigLoadError(`No migration from version ${version}.`);
    project = migrate(project);
    version += 1;
  }
  return project;
}

function isProjectShape(doc: unknown): doc is Project {
  return (
    typeof doc === 'object' &&
    doc !== null &&
    'meta' in doc &&
    typeof (doc as Project).meta?.version === 'number' &&
    Array.isArray((doc as Project).objects)
  );
}
