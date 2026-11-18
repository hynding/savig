import { describe, expect, it } from 'vitest';
import { addRect, createProject, cutRegion } from './index';

describe('cutRegion (spec 2026-11-18-lasso)', () => {
  it('cuts the looped part into a new drawing, and fails loud on a loop holding all of it', () => {
    const p = addRect(createProject(), { x: 0, y: 0, width: 100, height: 100, id: 'r' }).project;
    const { project, id } = cutRegion(p, 'r', [{ x: 50, y: -10 }, { x: 120, y: -10 }, { x: 120, y: 120 }, { x: 50, y: 120 }]);
    expect(project.objects.map((o) => o.id)).toContain(id);
    expect(project.objects).toHaveLength(2);
    expect(() => cutRegion(p, 'r', [{ x: -10, y: -10 }, { x: 200, y: -10 }, { x: 200, y: 200 }, { x: -10, y: 200 }])).toThrow(/entirely inside/);
    expect(() => cutRegion(p, 'nope', [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }])).toThrow(/no object/);
  });
});
