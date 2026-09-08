import { describe, expect, it } from 'vitest';
import { resolveAuthoredChain, expandOverrides } from './resolve';
import { createProject, createSceneObject, createGroupObject, createVectorAsset, createSymbolAsset } from '../project';
import type { Project, ObjectOverride } from '../types';

const rect = createVectorAsset('rect');

function baseProject(objects: Project['objects'], assets: Project['assets'] = [rect]): Project {
  return { ...createProject(), assets, objects };
}

describe('resolveAuthoredChain', () => {
  it('plain leaf → [leafId]', () => {
    const leaf = createSceneObject(rect.id, { id: 'leaf' });
    const project = baseProject([leaf]);
    expect(resolveAuthoredChain(project, 'leaf')).toEqual(['leaf']);
  });

  it('leaf in nested groups → [leaf, group1, group2], leaf-first', () => {
    const group2 = createGroupObject({ id: 'group2', anchorX: 0, anchorY: 0, zOrder: 0 });
    const group1 = createGroupObject({ id: 'group1', anchorX: 0, anchorY: 0, zOrder: 0 });
    group1.parentId = 'group2';
    const leaf = createSceneObject(rect.id, { id: 'leaf', parentId: 'group1' });
    const project = baseProject([leaf, group1, group2]);
    expect(resolveAuthoredChain(project, 'leaf')).toEqual(['leaf', 'group1', 'group2']);
  });

  it('instance-namespaced leaf inst1/child → [inst1, ...inst1\'s groups]', () => {
    const symbol = createSymbolAsset({ id: 'sym1', objects: [createSceneObject(rect.id, { id: 'child' })] });
    const outerGroup = createGroupObject({ id: 'outerGroup', anchorX: 0, anchorY: 0, zOrder: 0 });
    const inst1 = createSceneObject('sym1', { id: 'inst1', parentId: 'outerGroup' });
    const project = baseProject([inst1, outerGroup], [rect, symbol]);
    expect(resolveAuthoredChain(project, 'inst1/child')).toEqual(['inst1', 'outerGroup']);
  });

  it('nested instance-namespaced leaf inst1/inst2/child collapses to inst1 (outermost instance)', () => {
    const innerSym = createSymbolAsset({ id: 'innerSym', objects: [createSceneObject(rect.id, { id: 'child' })] });
    const outerSym = createSymbolAsset({ id: 'outerSym', objects: [createSceneObject('innerSym', { id: 'inst2' })] });
    const inst1 = createSceneObject('outerSym', { id: 'inst1' });
    const project = baseProject([inst1], [rect, innerSym, outerSym]);
    expect(resolveAuthoredChain(project, 'inst1/inst2/child')).toEqual(['inst1']);
  });

  it('repeater leaf@2 → same chain as leaf', () => {
    const group = createGroupObject({ id: 'g', anchorX: 0, anchorY: 0, zOrder: 0 });
    const leaf = createSceneObject(rect.id, { id: 'leaf', parentId: 'g' });
    const project = baseProject([leaf, group]);
    expect(resolveAuthoredChain(project, 'leaf@2')).toEqual(['leaf', 'g']);
  });

  it('unknown id → []', () => {
    const project = baseProject([]);
    expect(resolveAuthoredChain(project, 'nope')).toEqual([]);
  });

  it('multi-scene: resolves within the containing scene, not others', () => {
    const leafA = createSceneObject(rect.id, { id: 'leafA' });
    const leafB = createSceneObject(rect.id, { id: 'leafB' });
    const project: Project = {
      ...createProject(),
      assets: [rect],
      scenes: [
        { id: 'sceneA', name: 'A', objects: [leafA], duration: 1 },
        { id: 'sceneB', name: 'B', objects: [leafB], duration: 1 },
      ],
    };
    expect(resolveAuthoredChain(project, 'leafA')).toEqual(['leafA']);
    expect(resolveAuthoredChain(project, 'leafB')).toEqual(['leafB']);
  });
});

describe('expandOverrides', () => {
  it('override on a group maps onto both child leaves\' renderIds', () => {
    const group = createGroupObject({ id: 'g', anchorX: 0, anchorY: 0, zOrder: 0 });
    const leafA = createSceneObject(rect.id, { id: 'a', parentId: 'g' });
    const leafB = createSceneObject(rect.id, { id: 'b', parentId: 'g' });
    const project = baseProject([leafA, leafB, group]);
    const overrides = new Map<string, ObjectOverride>([['g', { hidden: true }]]);
    const result = expandOverrides(project, overrides, ['a', 'b']);
    expect(result.get('a')).toEqual({ hidden: true });
    expect(result.get('b')).toEqual({ hidden: true });
  });

  it('override on an instance maps onto inst1/a, inst1/b', () => {
    const symbol = createSymbolAsset({
      id: 'sym1',
      objects: [createSceneObject(rect.id, { id: 'a' }), createSceneObject(rect.id, { id: 'b' })],
    });
    const inst1 = createSceneObject('sym1', { id: 'inst1' });
    const project = baseProject([inst1], [rect, symbol]);
    const overrides = new Map<string, ObjectOverride>([['inst1', { opacity: 0.5 }]]);
    const result = expandOverrides(project, overrides, ['inst1/a', 'inst1/b']);
    expect(result.get('inst1/a')).toEqual({ opacity: 0.5 });
    expect(result.get('inst1/b')).toEqual({ opacity: 0.5 });
  });

  it('leaf override maps onto itself', () => {
    const leaf = createSceneObject(rect.id, { id: 'leaf' });
    const project = baseProject([leaf]);
    const overrides = new Map<string, ObjectOverride>([['leaf', { text: 'hi' }]]);
    const result = expandOverrides(project, overrides, ['leaf']);
    expect(result.get('leaf')).toEqual({ text: 'hi' });
  });

  it('unrelated renderIds untouched', () => {
    const leaf = createSceneObject(rect.id, { id: 'leaf' });
    const other = createSceneObject(rect.id, { id: 'other' });
    const project = baseProject([leaf, other]);
    const overrides = new Map<string, ObjectOverride>([['leaf', { hidden: true }]]);
    const result = expandOverrides(project, overrides, ['leaf', 'other']);
    expect(result.has('other')).toBe(false);
    expect(result.get('leaf')).toEqual({ hidden: true });
  });

  it('nearest ancestor wins on field conflicts', () => {
    const group = createGroupObject({ id: 'g', anchorX: 0, anchorY: 0, zOrder: 0 });
    const leaf = createSceneObject(rect.id, { id: 'leaf', parentId: 'g' });
    const project = baseProject([leaf, group]);
    const overrides = new Map<string, ObjectOverride>([
      ['g', { hidden: true, opacity: 0.2 }],
      ['leaf', { hidden: false }],
    ]);
    const result = expandOverrides(project, overrides, ['leaf']);
    expect(result.get('leaf')).toEqual({ hidden: false, opacity: 0.2 });
  });
});
