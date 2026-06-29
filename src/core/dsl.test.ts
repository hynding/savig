import { describe, it, expect } from 'vitest';
import { computeProjectDuration } from '../engine';
import { describeProject } from './describe';
import { validateProject } from './validate';
import { compileShort, decompileProject, type ShortDoc } from './dsl';

const doc: ShortDoc = {
  meta: { name: 'Slide', width: 640, height: 360, fps: 30 },
  objects: [
    {
      type: 'rect',
      id: 'box',
      x: 100,
      y: 160,
      width: 80,
      height: 80,
      style: { fill: '#3366ff' },
      base: { rotation: 15 },
      animate: {
        x: [
          { t: 0, value: 100 },
          { t: 2, value: 460, easing: 'easeInOut' },
        ],
      },
    },
    { type: 'ellipse', id: 'dot', x: 10, y: 10, width: 40, height: 20 },
  ],
};

describe('core/dsl compileShort', () => {
  it('compiles a declarative short into a Project', () => {
    const p = compileShort(doc);
    expect(p.meta.name).toBe('Slide');
    expect(p.meta.width).toBe(640);
    expect(p.objects.map((o) => o.id)).toEqual(['box', 'dot']);
    const box = p.objects.find((o) => o.id === 'box')!;
    expect(box.base.rotation).toBe(15);
    expect(box.tracks.x!.map((k) => k.time)).toEqual([0, 2]);
    expect(box.tracks.x![1].easing).toBe('easeInOut');
    expect(computeProjectDuration(p)).toBe(2);
    expect(validateProject(p)).toEqual([]);
    expect(describeProject(p)).toContain('"Slide"');
  });

  it('throws on an unknown object type', () => {
    expect(() => compileShort({ objects: [{ type: 'blob' } as never] })).toThrow(/unknown object type/);
  });

  it('throws when objects is missing', () => {
    expect(() => compileShort({} as ShortDoc)).toThrow(/objects must be an array/);
  });
});

describe('core/dsl round-trip', () => {
  it('decompile→compile reproduces an equivalent project (rect/ellipse + base + animate)', () => {
    const p1 = compileShort(doc);
    const p2 = compileShort(decompileProject(p1));
    // Equivalent: same object ids, base transforms, geometry, and tracks.
    expect(p2.objects.map((o) => o.id)).toEqual(p1.objects.map((o) => o.id));
    for (const o1 of p1.objects) {
      const o2 = p2.objects.find((o) => o.id === o1.id)!;
      expect(o2.base).toEqual(o1.base);
      expect(o2.shapeBase).toEqual(o1.shapeBase);
      expect(o2.tracks).toEqual(o1.tracks);
    }
  });

  it('round-trips a path object (position carried in base)', () => {
    const pathDoc: ShortDoc = {
      objects: [{ type: 'path', id: 'p', path: { closed: false, nodes: [{ anchor: { x: 30, y: 40 } }, { anchor: { x: 80, y: 90 } }] } }],
    };
    const p1 = compileShort(pathDoc);
    const p2 = compileShort(decompileProject(p1));
    const a1 = p1.objects.find((o) => o.id === 'p')!;
    const a2 = p2.objects.find((o) => o.id === 'p')!;
    expect(a2.base.x).toBe(a1.base.x);
    expect(a2.base.y).toBe(a1.base.y);
    const path1 = p1.assets.find((a) => a.id === a1.assetId);
    const path2 = p2.assets.find((a) => a.id === a2.assetId);
    expect(path2!.kind === 'vector' && path2!.path).toEqual(path1!.kind === 'vector' ? path1!.path : undefined);
  });

  it('skips non-DSL objects (groups) on decompile', () => {
    const p = compileShort(doc);
    const withGroup = { ...p, objects: [...p.objects, { ...p.objects[0], id: 'g', isGroup: true, assetId: '' }] };
    const back = decompileProject(withGroup);
    expect(back.objects.map((o) => o.id)).toEqual(['box', 'dot']); // group skipped
  });
});
