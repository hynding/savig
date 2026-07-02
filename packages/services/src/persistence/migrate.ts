import type { Project } from '@savig/engine';
import { SavigLoadError, UnsupportedVersionError } from '../errors';

export const CURRENT_VERSION = 5;

// Keyed by the version being upgraded FROM.
// v1 -> v2 introduced vector assets + geometry tracks.
// v2 -> v3 introduced path vector assets + stroke cap/join (both optional).
// v3 -> v4 introduced animatable path shape (shapeTrack on objects, optional);
// old files have none, so each upgrade only stamps the version.
// v4 -> v5 introduced multi-scene sequencing (Project.scenes, optional). Old files have no
// `scenes` key, which is already the valid single-scene representation, so this only stamps
// the version (absent scenes = byte-identical parity).
export const migrations: Record<number, (doc: Project) => Project> = {
  1: (doc) => ({ ...doc, meta: { ...doc.meta, version: 2 } }),
  2: (doc) => ({ ...doc, meta: { ...doc.meta, version: 3 } }),
  3: (doc) => ({ ...doc, meta: { ...doc.meta, version: 4 } }),
  4: (doc) => ({ ...doc, meta: { ...doc.meta, version: 5 } }),
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
