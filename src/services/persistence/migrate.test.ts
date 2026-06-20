import { describe, expect, it } from 'vitest';
import { createProject } from '../../engine';
import { SavigLoadError, UnsupportedVersionError } from '../errors';
import { CURRENT_VERSION, migrateProject } from './migrate';

describe('migrateProject', () => {
  it('passes through a current-version project', () => {
    const project = createProject();
    expect(migrateProject(project).meta.version).toBe(CURRENT_VERSION);
  });

  it('throws UnsupportedVersionError for a newer file', () => {
    const future = createProject();
    future.meta.version = CURRENT_VERSION + 1;
    expect(() => migrateProject(future)).toThrow(UnsupportedVersionError);
  });

  it('throws SavigLoadError for non-project input', () => {
    expect(() => migrateProject({ nope: true })).toThrow(SavigLoadError);
    expect(() => migrateProject(null)).toThrow(SavigLoadError);
  });
});

describe('v1 -> v2 migration', () => {
  it('upgrades a v1 project to the current version, leaving content unchanged', () => {
    const v1 = createProject();
    v1.meta.version = 1; // simulate an M1-era file
    const migrated = migrateProject(v1);
    expect(migrated.meta.version).toBe(CURRENT_VERSION);
    expect(CURRENT_VERSION).toBe(2);
    expect(migrated.objects).toEqual(v1.objects);
    expect(migrated.assets).toEqual(v1.assets);
    expect(migrated.audioClips).toEqual(v1.audioClips);
  });
});
