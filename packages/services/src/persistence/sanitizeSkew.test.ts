import { describe, expect, it } from 'vitest';
import { createProject, createSceneObject } from '@savig/engine';
import { sanitizeSkew } from './sanitizeSkew';
import { migrateProject } from './migrate';

describe('sanitizeSkew', () => {
  it('keeps finite skew and drops zero or bad values', () => {
    const p = createProject();
    const mk = (id: string, skewX: unknown, skewY?: unknown) => {
      const o = createSceneObject('a', { id });
      return { ...o, base: { ...o.base, skewX, ...(skewY !== undefined ? { skewY } : {}) } } as never;
    };
    p.objects.push(mk('ok', 20, -10), mk('zero', 0), mk('nan', Number.NaN), mk('str', '30'));
    const out = sanitizeSkew(p);
    expect(out.objects[0].base).toMatchObject({ skewX: 20, skewY: -10 });
    for (const o of out.objects.slice(1)) expect('skewX' in o.base).toBe(false);
  });

  it('leaves objects without skew untouched', () => {
    const p = createProject();
    const o = createSceneObject('a', { id: 'plain' });
    p.objects.push(o);
    expect(sanitizeSkew(p).objects[0]).toBe(o);
  });

  it('runs on load', () => {
    const p = createProject();
    const o = createSceneObject('a', { id: 'x' });
    p.objects.push({ ...o, base: { ...o.base, skewX: 'bad' as never } });
    expect('skewX' in migrateProject(JSON.parse(JSON.stringify(p))).objects[0].base).toBe(false);
  });
});

describe('sanitizeSkew — 3D rotation', () => {
  it('keeps finite rotationX/Y and drops zero or bad values', () => {
    const p = createProject();
    const o = createSceneObject('a', { id: 'r' });
    p.objects.push({ ...o, base: { ...o.base, rotationX: 30, rotationY: 'x' as never } });
    const out = sanitizeSkew(p).objects[0].base;
    expect(out.rotationX).toBe(30);
    expect('rotationY' in out).toBe(false);
  });
});
