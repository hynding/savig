import { describe, expect, test } from 'vitest';
import {
  addSwatch, applySwatchToAssets, isSwatchLinked, linkedSwatch, moveSwatch, removeSwatch, sanitizeSwatches,
  swatchColor, swatchUsage, updateSwatch,
} from './swatches';
import type { Project, TextAsset, VectorAsset } from './types';

const vec = (id: string, fill: string, stroke = '#000000'): VectorAsset => ({
  id, kind: 'vector', name: id, shapeType: 'path', path: 'M0 0 L10 0 L10 10 Z', style: { fill, stroke, strokeWidth: 1 },
} as unknown as VectorAsset);
const text = (id: string, fill: string): TextAsset => ({ id, kind: 'text', name: id, content: 'hi', fontSize: 12, fill });

function project(): Project {
  return {
    meta: { version: 1, name: 'p', width: 100, height: 100, fps: 24, duration: 1, background: '#fff' },
    assets: [vec('a', '#ff0000'), vec('b', '#00ff00'), text('t', '#333333')],
    objects: [],
    audioClips: [],
  } as unknown as Project;
}

const asset = (p: Project, id: string) => p.assets.find((a) => a.id === id)!;
const style = (p: Project, id: string) => (asset(p, id) as VectorAsset).style;

describe('swatches', () => {
  test('swatchColor normalizes hex and rejects others', () => {
    expect(swatchColor('#ABC')).toBe('#aabbcc');
    expect(swatchColor(' #FF8800 ')).toBe('#ff8800');
    expect(swatchColor('red')).toBeNull();
    expect(swatchColor('none')).toBeNull();
  });

  test('addSwatch normalizes, names by color, rejects duplicates and non-hex', () => {
    const p = addSwatch(project(), { id: 's1', color: '#F00' });
    expect(p.swatches).toEqual([{ id: 's1', name: '#ff0000', color: '#ff0000' }]);
    const g = addSwatch(p, { id: 's2', color: '#00f', name: ' Brand ', global: true });
    expect(g.swatches![1]).toEqual({ id: 's2', name: 'Brand', color: '#0000ff', global: true });
    expect(() => addSwatch(p, { id: 's1', color: '#000' })).toThrow(/already exists/);
    expect(() => addSwatch(p, { id: 's3', color: 'blue' })).toThrow(/hex color/);
  });

  test('applying a plain swatch sets the color without a link', () => {
    let p = addSwatch(project(), { id: 's', color: '#123456' });
    p = applySwatchToAssets(p, 's', 'fill', ['a', 't']);
    expect(style(p, 'a').fill).toBe('#123456');
    expect(style(p, 'a').fillSwatch).toBeUndefined();
    expect((asset(p, 't') as TextAsset).fill).toBe('#123456');
  });

  test('a swatch replaces a static gradient on that paint', () => {
    let p = project();
    p = { ...p, assets: p.assets.map((a) => (a.id === 'a' ? { ...a, style: { ...(a as VectorAsset).style, fillGradient: { type: 'linear', x1: 0, y1: 0, x2: 1, y2: 0, stops: [] } } } as VectorAsset : a)) };
    p = applySwatchToAssets(addSwatch(p, { id: 's', color: '#123456' }), 's', 'fill', ['a']);
    expect(style(p, 'a').fillGradient).toBeUndefined();
    expect(style(p, 'a').fill).toBe('#123456');
  });

  test('a global swatch links paints and recolors them when edited', () => {
    let p = addSwatch(project(), { id: 'g', color: '#123456', global: true });
    p = applySwatchToAssets(p, 'g', 'fill', ['a', 't']);
    p = applySwatchToAssets(p, 'g', 'stroke', ['b']);
    expect(style(p, 'a').fillSwatch).toBe('g');
    expect(swatchUsage(p, 'g')).toBe(3);
    expect(linkedSwatch(p, asset(p, 'b'), 'stroke')?.id).toBe('g');

    p = updateSwatch(p, 'g', { color: '#abcdef' });
    expect(style(p, 'a').fill).toBe('#abcdef');
    expect(style(p, 'b').stroke).toBe('#abcdef');
    expect(style(p, 'b').fill).toBe('#00ff00'); // the fill was never linked
    expect((asset(p, 't') as TextAsset).fill).toBe('#abcdef');
  });

  test('recoloring an object any other way unlinks it', () => {
    let p = addSwatch(project(), { id: 'g', color: '#123456', global: true });
    p = applySwatchToAssets(p, 'g', 'fill', ['a', 'b']);
    // Simulate an Inspector edit on "b" (store writes the color, leaves the link field).
    p = { ...p, assets: p.assets.map((a) => (a.id === 'b' ? { ...a, style: { ...(a as VectorAsset).style, fill: '#999999' } } as VectorAsset : a)) };
    expect(isSwatchLinked(asset(p, 'b'), 'fill', p.swatches![0])).toBe(false);
    expect(swatchUsage(p, 'g')).toBe(1);
    p = updateSwatch(p, 'g', { color: '#000001' });
    expect(style(p, 'a').fill).toBe('#000001');
    expect(style(p, 'b').fill).toBe('#999999');
    expect(style(p, 'b').fillSwatch).toBeUndefined(); // stale link dropped
  });

  test('turning global off unlinks; renaming keeps links; no-op returns same project', () => {
    let p = addSwatch(project(), { id: 'g', color: '#123456', global: true });
    p = applySwatchToAssets(p, 'g', 'fill', ['a']);
    expect(updateSwatch(p, 'g', { name: '#123456' })).toBe(p);
    const renamed = updateSwatch(p, 'g', { name: 'Sky' });
    expect(renamed.swatches![0].name).toBe('Sky');
    expect(style(renamed, 'a').fillSwatch).toBe('g');
    const off = updateSwatch(p, 'g', { global: false });
    expect(off.swatches![0].global).toBeUndefined();
    expect(style(off, 'a').fillSwatch).toBeUndefined();
    expect(style(off, 'a').fill).toBe('#123456');
    expect(updateSwatch(p, 'nope', { color: '#000' })).toBe(p);
    expect(() => updateSwatch(p, 'g', { color: 'x' })).toThrow(/hex color/);
  });

  test('removeSwatch keeps colors, drops links, and drops the field when empty', () => {
    let p = addSwatch(project(), { id: 'g', color: '#123456', global: true });
    p = applySwatchToAssets(p, 'g', 'fill', ['a']);
    const r = removeSwatch(p, 'g');
    expect('swatches' in r).toBe(false);
    expect(style(r, 'a').fill).toBe('#123456');
    expect(style(r, 'a').fillSwatch).toBeUndefined();
    expect(removeSwatch(r, 'g')).toBe(r);
  });

  test('moveSwatch reorders with clamping', () => {
    let p = addSwatch(project(), { id: '1', color: '#111' });
    p = addSwatch(p, { id: '2', color: '#222' });
    p = addSwatch(p, { id: '3', color: '#333' });
    expect(moveSwatch(p, '3', 0).swatches!.map((s) => s.id)).toEqual(['3', '1', '2']);
    expect(moveSwatch(p, '1', 99).swatches!.map((s) => s.id)).toEqual(['2', '3', '1']);
    expect(moveSwatch(p, '2', 1)).toBe(p);
  });

  test('sanitizeSwatches repairs malformed palettes and dangling links', () => {
    const p = project();
    expect(sanitizeSwatches(p)).toBe(p);
    const bad = {
      ...p,
      swatches: [{ id: 'g', color: '#ABC', global: true }, { id: 'g', color: '#000' }, { id: 'x', color: 'red' }, null, { id: 'p', color: '#111111', name: 'Plain' }],
      assets: [
        { ...vec('a', '#aabbcc'), style: { ...vec('a', '#aabbcc').style, fillSwatch: 'g', strokeSwatch: 'missing' } },
        { ...vec('b', '#111111'), style: { ...vec('b', '#111111').style, fillSwatch: 'p' } },
      ],
    } as unknown as Project;
    const out = sanitizeSwatches(bad);
    expect(out.swatches).toEqual([
      { id: 'g', name: '#aabbcc', color: '#aabbcc', global: true },
      { id: 'p', name: 'Plain', color: '#111111' },
    ]);
    expect(style(out, 'a').fillSwatch).toBe('g');
    expect(style(out, 'a').strokeSwatch).toBeUndefined();
    expect(style(out, 'b').fillSwatch).toBeUndefined(); // links only to global swatches
    expect('swatches' in sanitizeSwatches({ ...p, swatches: 'junk' } as unknown as Project)).toBe(false);
  });
});
