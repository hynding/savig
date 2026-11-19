import { describe, expect, it } from 'vitest';
import { createProject } from '@savig/engine';
import { addGuide, clearGuides, setGuides } from './guides';
import { describeProject } from './describe';

describe('guide verbs', () => {
  it('adds, replaces and clears guides', () => {
    let p = addGuide(createProject(), 'x', 100.4);
    p = addGuide(p, 'y', 50);
    expect(p.guides).toEqual([{ axis: 'x', pos: 100 }, { axis: 'y', pos: 50 }]);
    expect(describeProject(p)).toContain('Guides: x=100, y=50');
    p = setGuides(p, [{ axis: 'y', pos: 10 }]);
    expect(p.guides).toEqual([{ axis: 'y', pos: 10 }]);
    expect('guides' in clearGuides(p)).toBe(false);
    expect('guides' in setGuides(p, [])).toBe(false);
  });

  it('rejects bad guides', () => {
    expect(() => addGuide(createProject(), 'z' as 'x', 1)).toThrow(/axis/);
    expect(() => setGuides(createProject(), [{ axis: 'x', pos: Number.NaN }])).toThrow(/finite/);
  });
});
