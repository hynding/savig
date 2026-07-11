import { describe, it, expect, beforeEach } from 'vitest';
import { store } from '@savig/editor-state';
import { canAlign, canDistribute, canBool, canGroup, canUngroup, canCreateSymbol, canOutlineStroke, canShapeBuilder, canBlend, hasSelection, vectorSelected } from './predicates';
import type { PathData } from '@savig/engine';

beforeEach(() => {
  store.getState().newProject();
});

const addRect = (x: number) => {
  store.getState().addVectorShape('rect', { x, y: 0, width: 10, height: 10 });
  return store.getState().selectedObjectId!;
};

const addStrokedPath = () => {
  const path: PathData = { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }] };
  store.getState().addVectorPath(path); // default style: stroke '#000000', strokeWidth 2
  return store.getState().selectedObjectId!;
};

describe('command availability predicates', () => {
  it('hasSelection', () => {
    expect(hasSelection(store.getState())).toBe(false);
    addRect(0);
    expect(hasSelection(store.getState())).toBe(true);
  });

  it('canUngroup only when a group is selected', () => {
    const a = addRect(0);
    const b = addRect(60);
    store.getState().selectObjects([a, b]);
    expect(canUngroup(store.getState())).toBe(false); // two plain rects
    store.getState().groupSelected();
    expect(canUngroup(store.getState())).toBe(true); // group container selected
  });

  it('canAlign needs 2 movable; canDistribute needs 3', () => {
    const a = addRect(0);
    const b = addRect(60);
    store.getState().selectObjects([a, b]);
    expect(canAlign(store.getState())).toBe(true);
    expect(canDistribute(store.getState())).toBe(false);
    const c = addRect(120);
    store.getState().selectObjects([a, b, c]);
    expect(canDistribute(store.getState())).toBe(true);
  });

  it('canBool for 2 vector shapes; canGroup for 2 selected', () => {
    const a = addRect(0);
    const b = addRect(5);
    store.getState().selectObjects([a, b]);
    expect(canBool(store.getState())).toBe(true);
    expect(canGroup(store.getState())).toBe(true);
  });

  it('canCreateSymbol for a selected top-level unlocked object', () => {
    addRect(0);
    expect(canCreateSymbol(store.getState())).toBe(true);
  });

  it('vectorSelected: true for a vector primary selection, false for a group primary selection (Fix 3)', () => {
    const a = addRect(0);
    expect(vectorSelected(store.getState())).toBe(true);

    const b = addRect(60);
    store.getState().selectObjects([a, b]);
    store.getState().groupSelected();
    expect(vectorSelected(store.getState())).toBe(false);
  });

  it('canOutlineStroke: true for a single stroked path, false for a rect / multi-select / no stroke', () => {
    expect(canOutlineStroke(store.getState())).toBe(false); // nothing selected

    const pathId = addStrokedPath();
    expect(canOutlineStroke(store.getState())).toBe(true);

    // A non-path vector (rect) doesn't qualify.
    const rectId = addRect(0);
    expect(canOutlineStroke(store.getState())).toBe(false);

    // Multi-select of 2 doesn't qualify (even though one is a stroked path).
    store.getState().selectObjects([pathId, rectId]);
    expect(canOutlineStroke(store.getState())).toBe(false);

    // Back to a single stroked path selection: true again.
    store.getState().selectObject(pathId);
    expect(canOutlineStroke(store.getState())).toBe(true);

    // No visible stroke -> false.
    store.getState().setVectorStyle({ stroke: 'none' });
    expect(canOutlineStroke(store.getState())).toBe(false);
  });

  it('canShapeBuilder: true for 2-6 plain closed vector leaves, false outside that gate', () => {
    expect(canShapeBuilder(store.getState())).toBe(false); // nothing selected

    const a = addRect(0);
    const b = addRect(20);
    store.getState().selectObjects([a, b]);
    expect(canShapeBuilder(store.getState())).toBe(true);

    // A group container fails the gate (mirrors the store's own eligibility).
    store.getState().groupSelected();
    expect(canShapeBuilder(store.getState())).toBe(false);
  });

  it('canOutlineStroke: false for a group container and for a live-boolean result', () => {
    const a = addStrokedPath();
    const b = addStrokedPath();
    store.getState().selectObjects([a, b]);
    store.getState().groupSelected();
    expect(canOutlineStroke(store.getState())).toBe(false); // group container selected

    store.getState().newProject();
    const x = addStrokedPath();
    const y = addStrokedPath();
    store.getState().selectObjects([x, y]);
    store.getState().booleanOp('union', { live: true });
    expect(canOutlineStroke(store.getState())).toBe(false); // live-boolean result selected
  });

  it('canBlend: true for exactly 2 vector paths, false outside that gate', () => {
    expect(canBlend(store.getState())).toBe(false); // nothing selected

    const a = addStrokedPath();
    const b = addStrokedPath();
    store.getState().selectObjects([a, b]);
    expect(canBlend(store.getState())).toBe(true);

    // A non-path vector (rect) doesn't qualify.
    const rectId = addRect(0);
    store.getState().selectObjects([a, rectId]);
    expect(canBlend(store.getState())).toBe(false);

    // 3 selected doesn't qualify even though all are paths.
    const c = addStrokedPath();
    store.getState().selectObjects([a, b, c]);
    expect(canBlend(store.getState())).toBe(false);

    // Back to exactly 2 paths: true again.
    store.getState().selectObjects([a, b]);
    expect(canBlend(store.getState())).toBe(true);

    // A group container fails the gate.
    store.getState().groupSelected();
    const g = store.getState().selectedObjectId!;
    const d = addStrokedPath();
    store.getState().selectObjects([g, d]);
    expect(canBlend(store.getState())).toBe(false);
  });
});
