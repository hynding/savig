import { describe, expect, test } from 'vitest';
import {
  ANIMATABLE_PROPERTIES,
  DEFAULT_TRANSFORM,
  createKeyframe,
  createProject,
  createSceneObject,
  newId,
} from './project';

describe('newId', () => {
  test('returns unique non-empty strings', () => {
    expect(newId()).not.toEqual(newId());
    expect(newId().length).toBeGreaterThan(0);
  });
});

describe('createProject', () => {
  test('creates a project with sensible defaults and empty collections', () => {
    const project = createProject();
    expect(project.meta.width).toBe(1280);
    expect(project.meta.height).toBe(720);
    expect(project.meta.fps).toBe(30);
    expect(project.meta.durationMode).toBe('auto');
    expect(project.meta.loop).toBe(false);
    expect(project.meta.version).toBe(1);
    expect(project.assets).toEqual([]);
    expect(project.objects).toEqual([]);
    expect(project.audioClips).toEqual([]);
  });

  test('applies meta overrides', () => {
    const project = createProject({ name: 'Demo', fps: 60 });
    expect(project.meta.name).toBe('Demo');
    expect(project.meta.fps).toBe(60);
  });
});

describe('createSceneObject', () => {
  test('creates an object with default transform and empty tracks', () => {
    const obj = createSceneObject('asset-1');
    expect(obj.assetId).toBe('asset-1');
    expect(obj.base).toEqual(DEFAULT_TRANSFORM);
    expect(obj.tracks).toEqual({});
    expect(obj.id.length).toBeGreaterThan(0);
  });

  test('applies overrides', () => {
    const obj = createSceneObject('asset-1', { id: 'fixed', zOrder: 3 });
    expect(obj.id).toBe('fixed');
    expect(obj.zOrder).toBe(3);
  });

  test('gives each object an independent base (no shared mutable reference)', () => {
    expect(createSceneObject('a').base).not.toBe(DEFAULT_TRANSFORM);
    expect(createSceneObject('a').base).not.toBe(createSceneObject('a').base);
  });
});

describe('createKeyframe', () => {
  test('defaults easing to linear', () => {
    const kf = createKeyframe(1.5, 100);
    expect(kf).toEqual({ time: 1.5, value: 100, easing: 'linear' });
  });

  test('applies overrides', () => {
    const kf = createKeyframe(0, 0, { easing: 'easeIn' });
    expect(kf.easing).toBe('easeIn');
  });
});

describe('constants', () => {
  test('ANIMATABLE_PROPERTIES lists the six animatable props', () => {
    expect([...ANIMATABLE_PROPERTIES]).toEqual([
      'x',
      'y',
      'scaleX',
      'scaleY',
      'rotation',
      'opacity',
    ]);
  });
});
