import { describe, expect, it } from 'vitest';
import { createProject, createSymbolAsset, sprayParticles } from '@savig/engine';
import { addRect } from './build';
import { describeProject } from './describe';
import { spray } from './spray';

describe('core spray', () => {
  it('sprays deterministic dots into a group with stable ids', () => {
    const pts = [{ x: 100, y: 100 }, { x: 160, y: 100 }];
    const r = spray(createProject(), { points: pts, radius: 20, density: 2, color: '#C00', seed: 3 });
    expect(r.id).toBe('spray1');
    const expected = sprayParticles(pts, { radius: 20, density: 2, seed: 3 });
    expect(r.count).toBe(expected.length);
    const kids = r.project.objects.filter((o) => o.parentId === 'spray1');
    expect(kids.map((k) => k.id).slice(0, 2)).toEqual(['spray1-1', 'spray1-2']);
    const a = r.project.assets.find((x) => x.id === 'spray1-1-asset')!;
    expect(a.kind === 'vector' && a.style.fill).toBe('#cc0000');
    expect(kids[0].base.x + (kids[0].shapeBase!.radiusX as number)).toBeCloseTo(expected[0].x, 9);
    expect(spray(r.project, { points: pts }).id).toBe('spray2');
    expect(describeProject(r.project)).toContain('Spray');
  });

  it('sprays symbol instances pivoting about the symbol content centre', () => {
    const rect = addRect(createProject(), { x: 10, y: 20, width: 20, height: 10, id: 'r' }).project;
    const sym = createSymbolAsset({ id: 'leaf', name: 'Leaf', objects: rect.objects, width: 20, height: 10 });
    const p = { ...rect, objects: [], assets: [...rect.assets, sym] };
    const r = spray(p, { points: [{ x: 300, y: 300 }], symbolId: 'leaf', density: 3, scaleMin: 1, scaleMax: 1, rotation: 0, seed: 2 });
    const kids = r.project.objects.filter((o) => o.parentId === r.id);
    expect(kids).toHaveLength(3);
    expect(kids[0].assetId).toBe('leaf');
    expect(kids[0].anchorX).toBeCloseTo(20, 6);
    expect(kids[0].anchorY).toBeCloseTo(25, 6);
  });

  it('fails loudly on bad input', () => {
    const p = createProject();
    expect(() => spray(p, { points: [] })).toThrow(/at least one point/);
    expect(() => spray(p, { points: [{ x: NaN, y: 0 }] })).toThrow(/numbers/);
    expect(() => spray(p, { points: [{ x: 0, y: 0 }], symbolId: 'nope' })).toThrow(/not a symbol/);
    expect(() => spray(p, { points: [{ x: 0, y: 0 }], color: 'red' })).toThrow(/hex color/);
    expect(() => spray(p, { points: [{ x: 0, y: 0 }], dotSize: 0 })).toThrow(/dotSize/);
    const r = spray(p, { points: [{ x: 0, y: 0 }], id: 'x' });
    expect(() => spray(r.project, { points: [{ x: 0, y: 0 }], id: 'x' })).toThrow(/taken/);
  });
});
