import { describe, expect, it } from 'vitest';
import { createProject, createVectorAsset, type Project } from '@savig/engine';
import { sanitizeWidthProfile } from './sanitizeWidthProfile';

function withProfile(shapeType: 'path' | 'rect', widthProfile: unknown): Project {
  const p = createProject();
  const a = createVectorAsset(shapeType, { id: 'va', path: { closed: false, nodes: [] } });
  (a.style as unknown as Record<string, unknown>).widthProfile = widthProfile;
  p.assets.push(a);
  return p;
}
const styleOf = (p: Project) => (p.assets[0] as unknown as { style: Record<string, unknown> }).style;

describe('sanitizeWidthProfile', () => {
  it('normalizes a messy profile on a path', () => {
    const out = sanitizeWidthProfile(withProfile('path', [{ t: 1, w: 0 }, { t: 0, w: 99 }, { t: 'x', w: 1 }]));
    expect(styleOf(out).widthProfile).toEqual([{ t: 0, w: 20 }, { t: 1, w: 0 }]);
  });

  it('drops a profile on a non-path, an unusable one, or a uniform one', () => {
    expect('widthProfile' in styleOf(sanitizeWidthProfile(withProfile('rect', [{ t: 0, w: 2 }])))).toBe(false);
    expect('widthProfile' in styleOf(sanitizeWidthProfile(withProfile('path', 'junk')))).toBe(false);
    expect('widthProfile' in styleOf(sanitizeWidthProfile(withProfile('path', [{ t: 0, w: 1 }])))).toBe(false);
  });

  it('leaves a clean project untouched', () => {
    const p = withProfile('path', [{ t: 0, w: 2 }, { t: 1, w: 0 }]);
    expect(sanitizeWidthProfile(p)).toBe(p);
    const plain = createProject();
    expect(sanitizeWidthProfile(plain)).toBe(plain);
  });
});
