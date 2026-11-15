// Blend modes agent surface (spec 2026-11-15-blend-modes): core, DSL, describe, validate.
import { describe, expect, it } from 'vitest';
import { createProject } from '@savig/engine';
import { addRect } from './build';
import { setBlendMode } from './blend';
import { compileShort, decompileProject, type ShortDoc } from './dsl';
import { describeProject } from './describe';
import { validateProject } from './validate';
import { createMask } from './masks';

describe('setBlendMode', () => {
  it('sets, clears with normal or null, and fails loud', () => {
    const { project } = addRect(createProject(), { x: 0, y: 0, width: 10, height: 10, id: 'a' });
    const on = setBlendMode(project, ['a'], 'screen');
    expect(on.objects[0].blendMode).toBe('screen');
    expect('blendMode' in setBlendMode(on, ['a'], 'normal').objects[0]).toBe(false);
    expect('blendMode' in setBlendMode(on, ['a'], null).objects[0]).toBe(false);
    expect(() => setBlendMode(project, ['a'], 'add' as never)).toThrow(/unknown blend mode/);
    expect(() => setBlendMode(project, ['nope'], 'screen')).toThrow(/no object/);
  });
});

describe('DSL / describe / validate', () => {
  it('compiles `blend`, round-trips it, and describe shows it', () => {
    const doc: ShortDoc = { objects: [{ type: 'rect', id: 'r', x: 0, y: 0, width: 10, height: 10, blend: 'multiply' }, { type: 'rect', id: 'n', x: 0, y: 0, width: 5, height: 5, blend: 'normal' }] };
    const p = compileShort(doc);
    expect(p.objects.find((o) => o.id === 'r')!.blendMode).toBe('multiply');
    expect('blendMode' in p.objects.find((o) => o.id === 'n')!).toBe(false);
    const back = decompileProject(p);
    expect(back.objects![0]).toMatchObject({ id: 'r', blend: 'multiply' });
    expect('blend' in back.objects![1]).toBe(false);
    expect(compileShort(back)).toEqual(p);
    expect(describeProject(p)).toContain('blend=multiply');
    expect(() => compileShort({ objects: [{ type: 'rect', x: 0, y: 0, width: 1, height: 1, blend: 'add' as never }] })).toThrow(/unknown blend mode/);
  });

  it('validate: unknown mode is an error, a blend inside mask content a warning', () => {
    let p = addRect(createProject(), { x: 0, y: 0, width: 10, height: 10, id: 'm' }).project;
    p = addRect(p, { x: 0, y: 0, width: 10, height: 10, id: 't' }).project;
    p = createMask(p, 'm', ['t']);
    p = { ...p, objects: p.objects.map((o) => (o.id === 'm' ? { ...o, blendMode: 'screen' as const } : o.id === 't' ? { ...o, blendMode: 'bogus' as never } : o)) };
    const codes = validateProject(p).map((i) => `${i.severity}:${i.code}`);
    expect(codes).toContain('warn:blend-in-mask');
    expect(codes).toContain('error:blend-unknown');
  });
});
