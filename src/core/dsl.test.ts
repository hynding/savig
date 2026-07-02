import { describe, it, expect } from 'vitest';
import { computeProjectDuration } from '@savig/engine';
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
    expect(back.objects!.map((o) => o.id)).toEqual(['box', 'dot']); // group skipped
  });
});

const sceneDoc: ShortDoc = {
  meta: { name: 'Multi', width: 100, height: 100, fps: 30 },
  scenes: [
    { name: 'A', duration: 2, objects: [{ type: 'rect', x: 0, y: 0, width: 10, height: 10, id: 'a1' }] },
    { name: 'B', duration: 1.5, transitionIn: { kind: 'crossfade', duration: 0.5 },
      objects: [{ type: 'ellipse', x: 5, y: 5, width: 20, height: 20, id: 'b1' }] },
  ],
};

describe('core/dsl multi-scene', () => {
  it('compileShort builds Project.scenes and leaves objects empty', () => {
    const p = compileShort(sceneDoc);
    expect(p.objects).toEqual([]);
    expect(p.scenes!.map((s) => s.name)).toEqual(['A', 'B']);
    expect(p.scenes![0].duration).toBe(2);
    expect(p.scenes![1].transitionIn).toEqual({ kind: 'crossfade', duration: 0.5 });
    expect(p.scenes![0].objects.map((o) => o.id)).toEqual(['a1']);
    expect(p.assets.some((a) => a.id === 'a1-asset')).toBe(true); // assets global across scenes
    expect(p.assets.some((a) => a.id === 'b1-asset')).toBe(true);
  });

  it('compileShort fails loud when objects and scenes are both present', () => {
    expect(() => compileShort({ objects: [{ type: 'rect', x: 0, y: 0, width: 1, height: 1 }], scenes: [] } as ShortDoc))
      .toThrow();
  });

  it('decompileProject emits scenes; round-trips stably', () => {
    const p1 = compileShort(sceneDoc);
    const doc2 = decompileProject(p1);
    expect(doc2.scenes).toBeDefined();
    expect(doc2.objects).toBeUndefined();
    const p2 = compileShort(doc2);
    expect(p2.scenes!.map((s) => ({ name: s.name, duration: s.duration }))).toEqual(p1.scenes!.map((s) => ({ name: s.name, duration: s.duration })));
    for (let i = 0; i < p1.scenes!.length; i++) {
      expect(p2.scenes![i].objects.map((o) => ({ base: o.base, shapeBase: o.shapeBase }))).toEqual(
        p1.scenes![i].objects.map((o) => ({ base: o.base, shapeBase: o.shapeBase })),
      );
      expect(p2.scenes![i].transitionIn).toEqual(p1.scenes![i].transitionIn);
    }
  });

  it('single-scene doc still compiles/decompiles unchanged (parity)', () => {
    const doc2: ShortDoc = { meta: { name: 'S' }, objects: [{ type: 'rect', x: 1, y: 2, width: 3, height: 4, id: 'r' }] };
    const round = decompileProject(compileShort(doc2));
    expect(round.scenes).toBeUndefined();
    expect(round.objects!.map((o) => o.id)).toEqual(['r']);
  });
});
