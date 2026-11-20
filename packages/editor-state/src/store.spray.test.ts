import { describe, it, expect, beforeEach } from 'vitest';
import { store } from './store';
import { objectAABB } from '@savig/interaction';
import { sprayParticles } from '@savig/engine';

beforeEach(() => store.getState().newProject());

const project = () => store.getState().history.present;
const pts = [{ x: 100, y: 100 }, { x: 200, y: 100 }];

describe('spray slice', () => {
  it('clamps options', () => {
    store.getState().setSprayOptions({ density: 999, radius: -3, scaleMin: 3, scaleMax: 1, color: 'nope', dotSize: 0, symbolId: '' });
    const o = store.getState().spray;
    expect(o).toMatchObject({ density: 50, radius: 1, scaleMin: 1, scaleMax: 3, color: '#336699', dotSize: 1, symbolId: null });
  });

  it('sprays dots centred on the particles as one group and one undo step', () => {
    store.getState().setSprayOptions({ radius: 20, density: 3, scaleMin: 1, scaleMax: 1, dotSize: 10 });
    const gid = store.getState().sprayStroke(pts, 5)!;
    const expected = sprayParticles(pts, { ...store.getState().spray, seed: 5 });
    const objs = project().objects;
    const group = objs.find((o) => o.id === gid)!;
    expect(group.isGroup).toBe(true);
    expect(group.name).toBe('Spray');
    const dots = objs.filter((o) => o.parentId === gid);
    expect(dots).toHaveLength(expected.length);
    const a = project().assets.find((x) => x.id === dots[0].assetId)!;
    const box = objectAABB(dots[0], a, 0)!;
    expect((box.minX + box.maxX) / 2).toBeCloseTo(expected[0].x, 5);
    expect((box.minY + box.maxY) / 2).toBeCloseTo(expected[0].y, 5);
    expect(box.maxX - box.minX).toBeCloseTo(10, 5);
    expect(store.getState().selectedObjectId).toBe(gid);
    store.getState().sprayStroke(pts, 6);
    expect(project().objects.find((o) => o.name === 'Spray 2')).toBeTruthy();
    store.getState().undo();
    store.getState().undo();
    expect(project().objects).toHaveLength(0);
  });

  it('sprays scaled, rotated symbol instances', () => {
    store.getState().addVectorShape('rect', { x: 0, y: 0, width: 20, height: 20 });
    store.getState().createSymbol();
    const sym = project().assets.find((a) => a.kind === 'symbol')!;
    store.getState().setSprayOptions({ symbolId: sym.id, density: 2, scaleMin: 0.5, scaleMax: 2, rotation: 180 });
    const gid = store.getState().sprayStroke([{ x: 300, y: 300 }], 9)!;
    const inst = project().objects.filter((o) => o.parentId === gid);
    expect(inst).toHaveLength(2);
    const parts = sprayParticles([{ x: 300, y: 300 }], { ...store.getState().spray, seed: 9 });
    expect(inst[0].assetId).toBe(sym.id);
    expect(inst[0].base.scaleX).toBeCloseTo(parts[0].scale, 9);
    expect(inst[0].base.rotation).toBeCloseTo(parts[0].rotation, 9);
    expect(inst[0].base.x + inst[0].anchorX).toBeCloseTo(parts[0].x, 9);
  });

  it('a missing symbol falls back to dots; empty strokes do nothing', () => {
    store.getState().setSprayOptions({ symbolId: 'gone', density: 1 });
    const gid = store.getState().sprayStroke([{ x: 0, y: 0 }], 1)!;
    const child = project().objects.find((o) => o.parentId === gid)!;
    expect(project().assets.find((a) => a.id === child.assetId)!.kind).toBe('vector');
    expect(store.getState().sprayStroke([], 1)).toBeNull();
  });
});
