import { describe, expect, it } from 'vitest';
import { createFrameLayer, createProject, createSceneObject, createSymbolAsset, createVectorAsset } from '@savig/engine';
import type { FrameLayer, Project, SceneObject } from '@savig/engine';
import { validateProject } from './validate';

function project(objects: SceneObject[]): Project {
  const p = createProject({ fps: 10 });
  p.assets.push(createVectorAsset('rect', { id: 'va' }));
  p.objects.push(...objects);
  return p;
}
const layer = (frames: Partial<FrameLayer> = {}) => ({
  ...createFrameLayer({ id: 'L', zOrder: 0, keys: [{ id: 'k1', time: 0 }, { id: 'k2', time: 0.5 }], end: 1 }),
  ...(Object.keys(frames).length ? { frames: { keys: [{ id: 'k1', time: 0 }], end: 1, ...frames } } : {}),
});
const child = (id: string, extra: Partial<SceneObject> = {}) =>
  createSceneObject('va', { id, parentId: 'L', frameKeyId: 'k1', base: { x: 10, y: 10, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 }, ...extra });
const codes = (p: Project) => validateProject(p).map((i) => i.code);

describe('validate — frame layers', () => {
  it('accepts a well-formed layer with keyed children', () => {
    expect(validateProject(project([layer(), child('a'), child('b', { frameKeyId: 'k2' })]))).toEqual([]);
  });

  it('rejects frames on a non-group', () => {
    expect(codes(project([createSceneObject('va', { id: 'x', frames: { keys: [{ id: 'k', time: 0 }], end: 1 } })]))).toContain('frames-on-non-group');
  });

  it('rejects empty, unsorted, duplicate and negative keys', () => {
    expect(codes(project([layer({ keys: [] })]))).toContain('frame-keys-empty');
    expect(codes(project([layer({ keys: [{ id: 'a', time: 0.5 }, { id: 'b', time: 0 }] })]))).toContain('frame-keys-unsorted');
    expect(codes(project([layer({ keys: [{ id: 'a', time: 0 }, { id: 'b', time: 0 }] })]))).toContain('frame-key-duplicate-time');
    expect(codes(project([layer({ keys: [{ id: 'a', time: 0 }, { id: 'a', time: 0.2 }] })]))).toContain('frame-key-duplicate-id');
    expect(codes(project([layer({ keys: [{ id: 'a', time: -1 }] })]))).toContain('frame-key-negative-time');
  });

  it('rejects an end at or before the last key', () => {
    expect(codes(project([layer({ keys: [{ id: 'a', time: 1 }], end: 1 })]))).toContain('frame-end-before-last-key');
  });

  it('warns about orphan, dangling and unkeyed children (they render always-on)', () => {
    expect(codes(project([createSceneObject('va', { id: 'o', frameKeyId: 'k1' })]))).toContain('frame-key-orphan');
    expect(codes(project([layer(), child('d', { frameKeyId: 'nope' })]))).toContain('frame-key-dangling');
    expect(codes(project([layer(), child('u', { frameKeyId: undefined })]))).toContain('frame-layer-child-unkeyed');
  });

  it('checks frame layers inside symbols too', () => {
    const p = project([]);
    p.assets.push(createSymbolAsset({ id: 'S', objects: [layer({ keys: [] })] }));
    expect(codes(p)).toContain('frame-keys-empty');
  });

  it('allows a live boolean whose operands share its key; rejects cross-key or whole-layer operands', () => {
    const bool = (operandIds: string[], extra: Partial<SceneObject> = {}) =>
      child('bool', { boolean: { op: 'union', operandIds }, ...extra });
    expect(codes(project([layer(), child('a'), child('b'), bool(['a', 'b'])]))).not.toContain('boolean-frame-operand');
    expect(codes(project([layer(), child('a'), child('b', { frameKeyId: 'k2' }), bool(['a', 'b'])]))).toContain('boolean-frame-operand');
    expect(codes(project([layer(), child('a'), bool(['L'], { parentId: undefined, frameKeyId: undefined })]))).toContain('boolean-frame-operand');
  });
});
