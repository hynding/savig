import { describe, expect, it } from 'vitest';
import { createProject } from '@savig/engine';
import type { VectorAsset } from '@savig/engine';
import { addRect, addText } from './build';
import { describeProject } from './describe';
import { addSwatch, applySwatch, editSwatch } from './swatches';

function base() {
  let p = addRect(createProject(), { x: 0, y: 0, width: 10, height: 10, id: 'r' }).project;
  p = addRect(p, { x: 20, y: 0, width: 10, height: 10, id: 's' }).project;
  return p;
}
const fill = (p: ReturnType<typeof base>, id: string) => {
  const o = p.objects.find((x) => x.id === id)!;
  return (p.assets.find((a) => a.id === o.assetId) as VectorAsset).style.fill;
};

describe('core swatches', () => {
  it('adds swatches with deterministic ids and recolors linked shapes', () => {
    const a = addSwatch(base(), { color: '#2266CC', name: 'Brand', global: true });
    expect(a.id).toBe('swatch1');
    let p = applySwatch(a.project, 'swatch1', 'fill', ['r', 's']);
    expect(fill(p, 'r')).toBe('#2266cc');
    expect(describeProject(p)).toContain('"Brand" [swatch1] #2266cc global -> r.fill, s.fill');
    p = editSwatch(p, 'swatch1', { color: '#cc3311' });
    expect(fill(p, 's')).toBe('#cc3311');
    const b = addSwatch(p, { color: '#000' });
    expect(b.id).toBe('swatch2');
    expect(describeProject(b.project)).toContain('"#000000" [swatch2] #000000');
    p = editSwatch(b.project, 'swatch1', { delete: true });
    expect(p.swatches!.map((s) => s.id)).toEqual(['swatch2']);
    expect(fill(p, 'r')).toBe('#cc3311');
  });

  it('paints text and fails loudly on bad input', () => {
    const t = addText(base(), { x: 0, y: 0, content: 'Hi', id: 't' }).project;
    const { project } = addSwatch(t, { color: '#123456' });
    const p = applySwatch(project, 'swatch1', 'fill', ['t']);
    const txt = p.assets.find((a) => a.id === p.objects.find((o) => o.id === 't')!.assetId)!;
    expect((txt as { fill: string }).fill).toBe('#123456');
    expect(() => addSwatch(t, { color: 'blue' })).toThrow(/hex color/);
    expect(() => applySwatch(project, 'nope', 'fill', ['r'])).toThrow(/unknown swatch/);
    expect(() => applySwatch(project, 'swatch1', 'fill', ['ghost'])).toThrow(/no object/);
    expect(() => applySwatch(project, 'swatch1', 'fill', [])).toThrow(/at least one/);
    expect(() => editSwatch(project, 'swatch1', {})).toThrow(/needs/);
    expect(() => editSwatch(project, 'swatch1', { color: 'x' })).toThrow(/hex color/);
  });
});
