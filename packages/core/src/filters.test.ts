// Filters slice 3 (spec 2026-11-13-filters): headless builders, DSL round-trip, describe, template.
import { describe, expect, it } from 'vitest';
import { createProject, sampleFilters } from '@savig/engine';
import type { Project } from '@savig/engine';
import { addRect } from './build';
import { addFilter, animateFilter, removeFilter, setFilter, setFilterKeyframe } from './filters';
import { compileShort, decompileProject, type ShortDoc } from './dsl';
import { describeProject } from './describe';
import { validateProject } from './validate';
import { getTemplate } from './templates';
import { renderFrameRgba } from './node/render';

function scene(): Project {
  let p = createProject({ width: 100, height: 100 });
  ({ project: p } = addRect(p, { id: 'r', x: 40, y: 40, width: 20, height: 20, style: { fill: '#ff0000', stroke: 'none', strokeWidth: 0 } }));
  return p;
}
const o = (p: Project, id: string) => p.objects.find((x) => x.id === id)!;

describe('filter builders', () => {
  it('add / set / animate / remove', () => {
    const added = addFilter(scene(), 'r', { kind: 'glow', params: { blur: 3 } });
    const id = added.filterId;
    let p = added.project;
    expect(o(p, 'r').filters![0]).toMatchObject({ id, kind: 'glow', params: { blur: 3, strength: 1.5, opacity: 1 }, color: '#ffcc00' });
    p = setFilter(p, 'r', id, { params: { strength: 4 }, color: '#00ff00', enabled: false });
    expect(o(p, 'r').filters![0]).toMatchObject({ params: { strength: 4 }, color: '#00ff00', enabled: false });
    p = setFilter(p, 'r', id, { enabled: true });
    expect('enabled' in o(p, 'r').filters![0]).toBe(false);
    p = animateFilter(p, 'r', id, 'strength', [{ t: 1, value: 2 }, { t: 0, value: 0 }]);
    expect(o(p, 'r').filterTracks![`${id}.strength`].map((k) => [k.time, k.value])).toEqual([[0, 0], [1, 2]]);
    p = setFilterKeyframe(p, { objectId: 'r', filterId: id, param: 'strength', time: 0.5, value: 5, easing: 'easeIn' });
    expect(sampleFilters(o(p, 'r'), 0.5)[0].params.strength).toBe(5);
    p = removeFilter(p, 'r', id);
    expect('filters' in o(p, 'r') || 'filterTracks' in o(p, 'r')).toBe(false);
  });

  it('fails loud on bad references, kinds, params and colors', () => {
    const p = scene();
    expect(() => addFilter(p, 'nope', { kind: 'blur' })).toThrow(/no object/);
    expect(() => addFilter(p, 'r', { kind: 'sparkle' as never })).toThrow(/unknown filter kind/);
    expect(() => addFilter(p, 'r', { kind: 'blur', params: { dx: 1 } })).toThrow(/no param "dx"/);
    expect(() => addFilter(p, 'r', { kind: 'blur', params: { blur: NaN } })).toThrow(/finite/);
    expect(() => addFilter(p, 'r', { kind: 'blur', color: '#fff' })).toThrow(/no color/);
    const { project } = addFilter(p, 'r', { kind: 'blur', id: 'b' });
    expect(() => addFilter(project, 'r', { kind: 'blur', id: 'b' })).toThrow(/already/);
    expect(() => setFilter(project, 'r', 'x', {})).toThrow(/no filter/);
    expect(() => animateFilter(project, 'r', 'b', 'blur', [])).toThrow(/at least one/);
    expect(() => setFilterKeyframe(project, { objectId: 'r', filterId: 'b', param: 'hue', time: 0, value: 1 })).toThrow(/no param/);
  });
});

describe('DSL filters', () => {
  const doc: ShortDoc = {
    meta: { width: 100, height: 100 },
    objects: [
      {
        type: 'rect', id: 'r', x: 0, y: 0, width: 10, height: 10,
        filters: [
          { kind: 'dropShadow', id: 'ds', dx: 8, color: '#112233' },
          { kind: 'glow', id: 'g', enabled: false, animate: { strength: [{ t: 0, value: 0 }, { t: 1, value: 3, easing: 'easeOut' }] } },
        ],
      },
      {
        type: 'frames', id: 'L', keys: [{ time: 0, objects: [{ type: 'ellipse', x: 0, y: 0, width: 4, height: 4 }] }],
        filters: [{ kind: 'adjustColor', id: 'ac', hue: 90 }],
      },
    ],
  } as ShortDoc;

  it('compiles, validates and round-trips', () => {
    const p = compileShort(doc);
    expect(o(p, 'r').filters!.map((f) => f.kind)).toEqual(['dropShadow', 'glow']);
    expect(o(p, 'r').filters![0]).toMatchObject({ params: { dx: 8, dy: 4 }, color: '#112233' });
    expect(o(p, 'r').filterTracks!['g.strength'][1]).toMatchObject({ time: 1, value: 3, easing: 'easeOut' });
    expect(o(p, 'L').filters![0].params.hue).toBe(90);
    expect(validateProject(p).filter((i) => i.severity === 'error')).toEqual([]);
    const back = decompileProject(p);
    const r = back.objects!.find((x) => (x as { id?: string }).id === 'r')! as { filters: unknown[] };
    expect(r.filters).toEqual([
      { kind: 'dropShadow', id: 'ds', dx: 8, color: '#112233' },
      { kind: 'glow', id: 'g', enabled: false, animate: { strength: [{ t: 0, value: 0 }, { t: 1, value: 3, easing: 'easeOut' }] } },
    ]);
    expect(compileShort(back)).toEqual(p);
  });

  it('a filter-free doc decompiles without filters; bad filters fail loud', () => {
    let p = createProject();
    ({ project: p } = addRect(p, { id: 'e', x: 0, y: 0, width: 5, height: 5 }));
    expect(JSON.stringify(decompileProject(p))).not.toContain('filter');
    expect(() => compileShort({ objects: [{ type: 'rect', x: 0, y: 0, width: 1, height: 1, filters: [{ kind: 'blur', dx: 3 }] }] } as never)).toThrow(/no param/);
  });

  it('describe lists the stack with off/animated markers', () => {
    const text = describeProject(compileShort(doc));
    expect(text).toContain('filters: dropShadow:ds, glow:g (off) [strength@[0,1]]');
  });
});

describe('glowing-title template', () => {
  it('builds a valid project; the backdrop blur sharpens and the title glows over time', () => {
    const p = getTemplate('glowing-title')!.build();
    expect(validateProject(p).filter((i) => i.severity === 'error')).toEqual([]);
    expect(o(p, 'title').filters!.map((f) => f.kind)).toEqual(['dropShadow', 'glow']);
    expect(sampleFilters(o(p, 'sky'), 0)[0].params.blur).toBe(12);
    expect(sampleFilters(o(p, 'sky'), 1)[0].params.blur).toBe(0);
    const a = renderFrameRgba(p, 0, { width: 320 });
    const b = renderFrameRgba(p, 1, { width: 320 });
    expect(Buffer.from(a.pixels).equals(Buffer.from(b.pixels))).toBe(false);
  });
});
