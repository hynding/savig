import { describe, it, expect } from 'vitest';
import { createProject } from '../engine';
import { addText, setKeyframe } from './build';
import { renderFrameSvg, renderFramePng } from './render';
import { compileShort, decompileProject, type ShortDoc } from './dsl';
import { validateProject } from './validate';

describe('core/text addText', () => {
  it('adds a text object + text asset, positioned by base', () => {
    const { project, id } = addText(createProject(), { content: 'Hello', x: 40, y: 60, id: 't', fontSize: 32, fill: '#222' });
    const obj = project.objects.find((o) => o.id === id)!;
    expect(obj.base.x).toBe(40);
    expect(obj.base.y).toBe(60);
    const asset = project.assets.find((a) => a.id === 't-asset')!;
    expect(asset.kind).toBe('text');
    expect(asset.kind === 'text' && asset.content).toBe('Hello');
    expect(asset.kind === 'text' && asset.fontSize).toBe(32);
    expect(validateProject(project)).toEqual([]);
  });

  it('renders a <text> in the static frame SVG, with content escaped, and animates via opacity', () => {
    let p = addText(createProject(), { content: 'A & B <ok>', x: 10, y: 10, id: 't', fill: '#000' }).project;
    p = setKeyframe(p, { objectId: 't', property: 'opacity', time: 0, value: 0 });
    p = setKeyframe(p, { objectId: 't', property: 'opacity', time: 1, value: 1 });
    const svg = renderFrameSvg(p, 1);
    expect(svg).toContain('<text');
    expect(svg).toContain('A &amp; B &lt;ok&gt;'); // XML-escaped content
    // opacity is baked at t=1 (~1) and differs from t=0
    expect(renderFrameSvg(p, 0)).not.toEqual(svg);
    // and it rasterizes
    expect([...renderFramePng(p, 1, { width: 80 }).slice(0, 4)]).toEqual([137, 80, 78, 71]);
  });
});

describe('core/text DSL', () => {
  it('compiles a text object and round-trips through decompile', () => {
    const doc: ShortDoc = {
      objects: [{ type: 'text', id: 'title', content: 'Title', x: 20, y: 30, fontSize: 40, textAnchor: 'middle', style: { fill: '#09c' } }],
    };
    const p1 = compileShort(doc);
    const a1 = p1.assets.find((a) => a.id === 'title-asset')!;
    expect(a1.kind === 'text' && a1.content).toBe('Title');
    expect(a1.kind === 'text' && a1.textAnchor).toBe('middle');
    // round-trip equivalent
    const p2 = compileShort(decompileProject(p1));
    const a2 = p2.assets.find((a) => a.id === 'title-asset')!;
    expect(a2).toEqual(a1);
    expect(p2.objects.find((o) => o.id === 'title')!.base).toEqual(p1.objects.find((o) => o.id === 'title')!.base);
  });
});
