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
