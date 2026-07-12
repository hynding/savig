import { describe, expect, test } from 'vitest';
import {
  ALL_ANIMATABLE_PROPERTIES,
  ANIMATABLE_PROPERTIES,
  DEFAULT_TRANSFORM,
  DEFAULT_VECTOR_STYLE,
  createGroupObject,
  createKeyframe,
  createProject,
  createSceneObject,
  createSymbolAsset,
  createVectorAsset,
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
    expect(project.meta.version).toBe(5);
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

describe('createVectorAsset', () => {
  test('creates a rect vector asset with defaults and a uuid id', () => {
    const asset = createVectorAsset('rect');
    expect(asset.kind).toBe('vector');
    expect(asset.shapeType).toBe('rect');
    expect(asset.name).toBe('Rectangle');
    expect(asset.style).toEqual(DEFAULT_VECTOR_STYLE);
    expect(asset.id).toMatch(/[0-9a-f-]{36}/);
  });

  test('names an ellipse and accepts overrides', () => {
    const asset = createVectorAsset('ellipse', {
      id: 'fixed',
      style: { fill: '#f00', stroke: 'none', strokeWidth: 0 },
    });
    expect(asset.name).toBe('Ellipse');
    expect(asset.id).toBe('fixed');
    expect(asset.style.fill).toBe('#f00');
  });

  test('names a path asset "Path" and sets shapeType', () => {
    const asset = createVectorAsset('path');
    expect(asset.shapeType).toBe('path');
    expect(asset.name).toBe('Path');
    expect(asset.kind).toBe('vector');
  });

  test('accepts a PathData override', () => {
    const path = { nodes: [{ anchor: { x: 0, y: 0 } }], closed: false };
    const asset = createVectorAsset('path', { path });
    expect(asset.path).toEqual(path);
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

  test('ALL_ANIMATABLE_PROPERTIES has exactly 16 members with no duplicates', () => {
    expect(ALL_ANIMATABLE_PROPERTIES.length).toBe(16);
    expect(new Set(ALL_ANIMATABLE_PROPERTIES).size).toBe(16);
  });

  test('ALL_ANIMATABLE_PROPERTIES covers the transform/geometry/primitive props + textPathOffset', () => {
    expect([...ALL_ANIMATABLE_PROPERTIES].sort()).toEqual(
      [
        'x',
        'y',
        'scaleX',
        'scaleY',
        'rotation',
        'opacity',
        'width',
        'height',
        'cornerRadius',
        'radiusX',
        'radiusY',
        'sides',
        'starPoints',
        'innerRatio',
        'primitiveRotation',
        'textPathOffset',
      ].sort(),
    );
  });
});

describe('createGroupObject (slice 45)', () => {
  test('is a group container: isGroup, no asset, identity base, given anchor/zOrder', () => {
    const g = createGroupObject({ id: 'g1', anchorX: 50, anchorY: 30, zOrder: 7 });
    expect(g.isGroup).toBe(true);
    expect(g.assetId).toBe('');
    expect(g.name).toBe('Group');
    expect(g.zOrder).toBe(7);
    expect([g.anchorX, g.anchorY]).toEqual([50, 30]);
    expect(g.base).toEqual({ x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 });
    expect(g.tracks).toEqual({});
  });
});

describe('createSymbolAsset (slice 47a)', () => {
  test('creates an empty symbol asset with defaults and a uuid', () => {
    const s = createSymbolAsset();
    expect(s.kind).toBe('symbol');
    expect(s.objects).toEqual([]);
    expect(s.id).toMatch(/[0-9a-f-]{8,}/);
    expect(typeof s.duration).toBe('number');
  });
  test('applies overrides', () => {
    const s = createSymbolAsset({ name: 'Spinner', width: 120, height: 80 });
    expect(s.name).toBe('Spinner');
    expect(s.width).toBe(120);
    expect(s.height).toBe(80);
  });
});
