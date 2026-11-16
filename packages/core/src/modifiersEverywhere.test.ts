// Modifiers everywhere (spec 2026-11-16-modifiers-everywhere): agent surface + samplers.
import { describe, expect, it } from 'vitest';
import { createKeyframe, createProject, sampleCamera, sampleFilters, sampleObject } from '@savig/engine';
import { addRect, setKeyframe, setTrim, setTrimKeyframe } from './build';
import { addFilter, removeFilter, setFilterKeyframe } from './filters';
import { setCamera, setCameraKeyframe } from './camera';
import { setCameraModifier, setModifier } from './modifiers';
import { validateProject } from './validate';
import { compileShort, decompileProject } from './dsl';
import { describeProject } from './describe';

const rect = () => addRect(createProject({ width: 100, height: 100 }), { x: 0, y: 0, width: 10, height: 10, id: 'r' }).project;

describe('object modifiers beyond the transform', () => {
  it('wiggles a filter param around its static value, clamped to the param range', () => {
    const added = addFilter(rect(), 'r', { kind: 'blur', id: 'f1', params: { blur: 1 } });
    const filterId = added.filterId;
    let p = added.project;
    p = setModifier(p, 'r', `filter:${filterId}.blur`, { wiggle: { amplitude: 5, frequency: 3, seed: 2 } });
    const vals = [0.1, 0.4, 0.7, 1.3].map((t) => sampleFilters(p.objects[0], t)[0].params.blur);
    expect(new Set(vals).size).toBeGreaterThan(1);
    for (const v of vals) expect(v).toBeGreaterThanOrEqual(0); // clamped at the blur minimum
    for (const v of vals) expect(v).toBeLessThanOrEqual(6);
  });

  it('loops a filter param track', () => {
    let p = addFilter(rect(), 'r', { kind: 'blur', id: 'f1' }).project;
    p = setFilterKeyframe(p, { objectId: 'r', filterId: 'f1', param: 'blur', time: 0, value: 0 });
    p = setFilterKeyframe(p, { objectId: 'r', filterId: 'f1', param: 'blur', time: 1, value: 10 });
    p = setModifier(p, 'r', 'filter:f1.blur', { loop: 'cycle' });
    expect(sampleFilters(p.objects[0], 1.5)[0].params.blur).toBeCloseTo(5, 6);
  });

  it('removing a filter removes its modifiers; a modifier on a missing filter fails loud', () => {
    let p = addFilter(rect(), 'r', { kind: 'blur', id: 'f1' }).project;
    p = setModifier(p, 'r', 'filter:f1.blur', { wiggle: { amplitude: 1, frequency: 1 } });
    p = setModifier(p, 'r', 'x', { wiggle: { amplitude: 1, frequency: 1 } });
    p = removeFilter(p, 'r', 'f1');
    expect(Object.keys(p.objects[0].modifiers ?? {})).toEqual(['x']);
    expect(() => setModifier(p, 'r', 'filter:f9.blur', { loop: 'cycle' })).toThrow(/no filter "f9"/);
  });

  it('loops and wiggles the trim window', () => {
    let p = setTrim(rect(), 'r', { start: 0, end: 1, offset: 0 });
    p = setTrimKeyframe(p, { objectId: 'r', prop: 'end', time: 0, value: 0 });
    p = setTrimKeyframe(p, { objectId: 'r', prop: 'end', time: 1, value: 1 });
    p = setModifier(p, 'r', 'trimEnd', { loop: 'cycle' });
    expect(sampleObject(p.objects[0], 1.25).trim!.end).toBeCloseTo(0.25, 6);
    p = setModifier(p, 'r', 'trimOffset', { wiggle: { amplitude: 0.1, frequency: 2 } });
    const offs = [0.2, 0.6, 0.9].map((t) => sampleObject(p.objects[0], t).trim!.offset);
    expect(new Set(offs).size).toBeGreaterThan(1);
  });

  it('loops a fill color track; colors refuse a wiggle', () => {
    let p = rect();
    const o = p.objects[0];
    p = { ...p, objects: [{ ...o, colorTracks: { fill: [{ time: 0, value: '#000000', easing: 'linear' }, { time: 1, value: '#ffffff', easing: 'linear' }] } }] };
    p = setModifier(p, 'r', 'fill', { loop: 'pingpong' });
    expect(sampleObject(p.objects[0], 1.5).fill).toBe(sampleObject(p.objects[0], 0.5).fill);
    expect(sampleObject(p.objects[0], 2).fill).toBe(sampleObject(p.objects[0], 0).fill);
    expect(() => setModifier(p, 'r', 'fill', { wiggle: { amplitude: 1, frequency: 1 } })).toThrow(/loops only/);
  });

  it('validate flags a modifier whose target is gone and a wiggle on a loop-only target', () => {
    const p = rect();
    const bad = { ...p, objects: [{ ...p.objects[0], modifiers: { trimEnd: { loop: 'cycle' as const }, fill: { wiggle: { amplitude: 1, frequency: 1 } } } }] };
    const codes = validateProject(bad).map((i) => i.code);
    expect(codes).toContain('modifier-target-missing');
    expect(codes).toContain('modifier-invalid');
  });
});

describe('camera modifiers', () => {
  it('shakes the camera around its framing and loops its keys', () => {
    let p = setCamera(rect(), { x: 50, y: 50 });
    p = setCameraModifier(p, 'x', { wiggle: { amplitude: 8, frequency: 4, seed: 3 } });
    const xs = [0.1, 0.35, 0.8].map((t) => sampleCamera(p.camera!, t).x);
    expect(new Set(xs).size).toBe(3);
    for (const x of xs) expect(Math.abs(x - 50)).toBeLessThanOrEqual(8);
    expect(sampleCamera(p.camera!, 0.5).y).toBe(50);

    p = setCameraKeyframe(p, { axis: 'zoom', time: 0, value: 1 });
    p = setCameraKeyframe(p, { axis: 'zoom', time: 1, value: 2 });
    p = setCameraModifier(p, 'zoom', { loop: 'pingpong' });
    expect(sampleCamera(p.camera!, 1.5).zoom).toBeCloseTo(1.5, 6);
    // setCamera keeps modifiers; clear removes them.
    p = setCamera(p, { rotation: 5 });
    expect(Object.keys(p.camera!.modifiers!)).toEqual(['x', 'zoom']);
    p = setCameraModifier(setCameraModifier(p, 'x', { clear: true }), 'zoom', { clear: true });
    expect('modifiers' in p.camera!).toBe(false);
    expect(() => setCameraModifier(p, 'roll' as never, { loop: 'cycle' })).toThrow(/camera axis/);
  });

  it('round-trips through the DSL and shows in describe', () => {
    let p = addFilter(rect(), 'r', { kind: 'glow', id: 'g1' }).project;
    p = setModifier(p, 'r', 'filter:g1.strength', { wiggle: { amplitude: 0.5, frequency: 2, seed: 1 } });
    p = setCameraModifier(p, 'rotation', { wiggle: { amplitude: 2, frequency: 3 } });
    const doc = decompileProject(p);
    const back = compileShort(JSON.parse(JSON.stringify(doc)));
    expect(back.objects[0].modifiers).toEqual(p.objects[0].modifiers);
    expect(back.camera!.modifiers).toEqual(p.camera!.modifiers);
    expect(describeProject(p)).toMatch(/Camera modifiers: rotation~wiggle\(2@3Hz\)/);
    expect(describeProject(p)).toMatch(/filter:g1\.strength~wiggle/);
  });

  it('validate warns about a camera loop with no keys', () => {
    const p = setCameraModifier(rect(), 'y', { loop: 'cycle' });
    expect(validateProject(p).some((i) => i.code === 'modifier-loop-no-keys' && /camera/.test(i.message))).toBe(true);
  });
});

describe('primitive and motion-path modifiers', () => {
  it('sampleObject: a keyless wiggle on a polygon rotation regenerates the path', () => {
    const o = { ...rect().objects[0], modifiers: { primitiveRotation: { wiggle: { amplitude: 20, frequency: 2 } } } };
    const spec = { kind: 'polygon' as const, cx: 0, cy: 0, radius: 10, rotation: 0, sides: 5, cornerRadius: 0 };
    const a = sampleObject(o, 0.2, spec).path;
    const b = sampleObject(o, 0.7, spec).path;
    expect(a).toBeDefined();
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    // no modifier, no track: no regeneration (parity)
    expect(sampleObject(rect().objects[0], 0.2, spec).path).toBeUndefined();
  });

  it('loops motion-path progress', () => {
    const o = {
      ...rect().objects[0],
      motionPath: { path: { nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 100, y: 0 } }], closed: false }, orient: false, progress: [createKeyframe(0, 0), createKeyframe(1, 1)] },
      modifiers: { motionProgress: { loop: 'cycle' as const } },
    } as never;
    expect(sampleObject(o, 1.25).x).toBeCloseTo(sampleObject(o, 0.25).x, 6);
  });
});

it('keyframing x still works alongside new-target modifiers', () => {
  let p = setKeyframe(rect(), { objectId: 'r', property: 'x', time: 0, value: 0 });
  p = setTrim(p, 'r', { end: 0.5 });
  p = setModifier(p, 'r', 'trimEnd', { wiggle: { amplitude: 0.1, frequency: 1 } });
  expect(sampleObject(p.objects[0], 0).x).toBe(0);
});
