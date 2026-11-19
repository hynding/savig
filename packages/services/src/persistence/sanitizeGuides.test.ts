import { describe, expect, it } from 'vitest';
import type { Project } from '@savig/engine';
import { sanitizeGuides } from './sanitizeGuides';

const base = { meta: {}, assets: [], objects: [], audioClips: [] } as unknown as Project;

describe('sanitizeGuides', () => {
  it('leaves a project without guides untouched', () => {
    expect(sanitizeGuides(base)).toBe(base);
  });
  it('drops malformed guides and rounds positions', () => {
    const p = { ...base, guides: [{ axis: 'x', pos: 10.4 }, { axis: 'z', pos: 1 }, { axis: 'y', pos: NaN }, 'junk', { axis: 'y', pos: 7.6 }] } as unknown as Project;
    expect(sanitizeGuides(p).guides).toEqual([{ axis: 'x', pos: 10 }, { axis: 'y', pos: 8 }]);
  });
  it('removes the field when nothing survives', () => {
    const p = { ...base, guides: 'nope' } as unknown as Project;
    expect('guides' in sanitizeGuides(p)).toBe(false);
  });
});
