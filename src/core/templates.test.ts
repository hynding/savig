import { describe, it, expect } from 'vitest';
import { computeProjectDuration } from '@savig/engine';
import { templates, getTemplate } from './templates';
import { validateProject } from './validate';
import { renderFramePng } from './render';

describe('core/templates', () => {
  it('every template has unique id + metadata', () => {
    const ids = templates.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of templates) {
      expect(t.title.length).toBeGreaterThan(2);
      expect(t.description.length).toBeGreaterThan(10);
    }
  });

  it('getTemplate finds by id', () => {
    expect(getTemplate('bouncing-ball')?.title).toBe('Bouncing ball');
    expect(getTemplate('nope')).toBeUndefined();
  });

  for (const t of templates) {
    describe(`template "${t.id}"`, () => {
      it('builds a valid, animated, renderable short', () => {
        const p = t.build();
        // no validation ERRORS (warnings like off-artboard are tolerated)
        const errors = validateProject(p).filter((i) => i.severity === 'error');
        expect(errors).toEqual([]);
        // it actually animates
        expect(computeProjectDuration(p)).toBeGreaterThan(0);
        expect(p.objects.length).toBeGreaterThan(0);
        // renders a frame to a PNG
        const png = renderFramePng(p, 0, { width: 96 });
        expect([...png.slice(0, 4)]).toEqual([137, 80, 78, 71]);
      });

      it('is reproducible (build() twice is structurally equal)', () => {
        expect(t.build()).toEqual(t.build());
      });
    });
  }
});
