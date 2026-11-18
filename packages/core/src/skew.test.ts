import { describe, expect, it } from 'vitest';
import { addRect, compileShort, createProject, decompileProject, describeProject, setSkew, validateProject } from './index';

describe('setSkew (spec 2026-11-18-skew-distort)', () => {
  it('sets, keys and clears skew', () => {
    let p = addRect(createProject(), { x: 0, y: 0, width: 10, height: 10, id: 'r' }).project;
    p = setSkew(p, 'r', { skewX: 15, skewY: -5 });
    expect(p.objects[0].base).toMatchObject({ skewX: 15, skewY: -5 });
    p = setSkew(p, 'r', { skewX: 30, time: 2 });
    expect(p.objects[0].tracks.skewX).toEqual([{ time: 2, value: 30, easing: 'linear' }]);
    p = setSkew(p, 'r', { skewY: 0 });
    expect('skewY' in p.objects[0].base).toBe(false);
    expect(() => setSkew(p, 'nope', { skewX: 1 })).toThrow(/no object/);
    expect(() => setSkew(p, 'r', { skewX: Number.NaN })).toThrow(/between/);
  });

  it('describe shows a base skew', () => {
    const p = setSkew(addRect(createProject(), { x: 0, y: 0, width: 10, height: 10, id: 'r' }).project, 'r', { skewY: 12 });
    expect(describeProject(p)).toContain('sky=12°');
  });

  it('round-trips through the DSL (base and animate)', () => {
    const doc = {
      meta: { width: 100, height: 100 },
      objects: [{ type: 'rect' as const, id: 'r', x: 10, y: 10, width: 20, height: 20, base: { skewX: 25 }, animate: { skewY: [{ t: 0, value: 0 }, { t: 1, value: 10 }] } }],
    };
    const p = compileShort(doc);
    expect(p.objects[0].base.skewX).toBe(25);
    const back = decompileProject(p);
    const r = back.objects![0] as { base?: Record<string, number>; animate?: Record<string, unknown[]> };
    expect(r.base).toMatchObject({ skewX: 25 });
    expect(r.animate?.skewY).toHaveLength(2);
    expect(compileShort(back).objects[0].base.skewX).toBe(25);
  });

  it('validate warns when a keyed skew goes past the limit', () => {
    let p = addRect(createProject(), { x: 0, y: 0, width: 10, height: 10, id: 'r' }).project;
    p = { ...p, objects: p.objects.map((o) => ({ ...o, tracks: { skewX: [{ time: 0, value: 120, easing: 'linear' as const }] } })) };
    expect(validateProject(p).map((i) => i.code)).toContain('skew-clamped');
  });
});
