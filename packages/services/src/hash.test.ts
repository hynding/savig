import { describe, expect, it } from 'vitest';
import { hashContent } from './hash';

describe('hashContent', () => {
  it('is deterministic and 8 hex chars', () => {
    const h = hashContent('hello world');
    expect(h).toMatch(/^[0-9a-f]{8}$/);
    expect(hashContent('hello world')).toBe(h);
  });

  it('differs for different content', () => {
    expect(hashContent('a')).not.toBe(hashContent('b'));
  });

  it('hashes strings and bytes equivalently for ASCII', () => {
    expect(hashContent('abc')).toBe(hashContent(new Uint8Array([97, 98, 99])));
  });
});
