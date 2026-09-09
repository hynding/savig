import { describe, expect, it, test } from 'vitest';
import { createProject } from '@savig/engine';
import { SavigLoadError, UnsupportedVersionError } from '../errors';
import { CURRENT_VERSION, migrateProject } from './migrate';
import v4fixture from './__fixtures__/project-v4.json';

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
    expect(CURRENT_VERSION).toBe(7);
    expect(migrated.objects).toEqual(v1.objects);
    expect(migrated.assets).toEqual(v1.assets);
    expect(migrated.audioClips).toEqual(v1.audioClips);
  });

  it('migrates a v2 project (no paths) to the current version, content unchanged except the version', () => {
    const v2 = createProject();
    v2.meta.version = 2;
    const migrated = migrateProject(v2);
    expect(migrated.meta.version).toBe(CURRENT_VERSION);
    expect(migrated.assets).toEqual(v2.assets);
    expect(migrated.objects).toEqual(v2.objects);
  });
});

describe('v3 -> v4 (path shape morphing)', () => {
  it('migrates a v3 project (no shapeTrack) to the current version unchanged except version', () => {
    const base = createProject();
    const v3 = { ...base, meta: { ...base.meta, version: 3 } };
    const migrated = migrateProject(v3);
    expect(migrated.meta.version).toBe(CURRENT_VERSION);
    expect(migrated.objects).toEqual(v3.objects);
  });
});

describe('migration v4 -> current (8b-1a)', () => {
  test('migrates a v4 fixture to CURRENT_VERSION, leaves scenes absent, preserves objects (parity)', () => {
    const migrated = migrateProject(structuredClone(v4fixture));
    expect(migrated.meta.version).toBe(CURRENT_VERSION);
    expect((migrated as { scenes?: unknown }).scenes).toBeUndefined();
    expect(migrated.objects).toHaveLength(1);
    expect(migrated.objects[0].id).toBe('o1');
  });

  test('CURRENT_VERSION is 7', () => {
    expect(CURRENT_VERSION).toBe(7);
  });
});

describe('migration v5 -> v6 (multitrack audio)', () => {
  test('stamps CURRENT_VERSION, leaves audioTracks absent (parity)', () => {
    const v5 = createProject();
    v5.meta.version = 5;
    const migrated = migrateProject(v5);
    expect(migrated.meta.version).toBe(CURRENT_VERSION);
    expect(migrated.audioTracks).toBeUndefined();
  });
});

describe('migration v6 -> v7 (M9 interactivity/scripting)', () => {
  test('stamps CURRENT_VERSION, leaves interactions absent and objects behaviors-free (parity)', () => {
    const v6 = createProject();
    v6.meta.version = 6;
    const migrated = migrateProject(v6);
    expect(migrated.meta.version).toBe(CURRENT_VERSION);
    expect(migrated.interactions).toBeUndefined();
  });
});

describe('migrateProject — malformed audio shapes never throw a raw TypeError', () => {
  test('audioTracks: {} does not throw and comes out absent', () => {
    const doc = { ...createProject(), audioTracks: {} };
    expect(() => migrateProject(doc)).not.toThrow();
    const migrated = migrateProject(doc);
    expect(migrated.audioTracks).toBeUndefined();
    expect('audioTracks' in migrated).toBe(false);
  });

  test('audioClips: {} does not throw', () => {
    const doc = { ...createProject(), audioClips: {} };
    expect(() => migrateProject(doc)).not.toThrow();
  });

  test('assets: {} does not throw', () => {
    const doc = { ...createProject(), assets: {} };
    expect(() => migrateProject(doc)).not.toThrow();
  });
});
