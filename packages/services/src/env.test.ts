import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

describe('services test environment', () => {
  it('provides DOMParser (jsdom)', () => {
    const doc = new DOMParser().parseFromString('<svg/>', 'image/svg+xml');
    expect(doc.documentElement.tagName).toBe('svg');
  });

  it('provides indexedDB (fake-indexeddb)', () => {
    expect(typeof indexedDB).toBe('object');
    expect(indexedDB).not.toBeNull();
  });

  it('round-trips bytes through fflate', () => {
    const zipped = zipSync({ 'a.txt': strToU8('hello') });
    const out = unzipSync(zipped);
    expect(strFromU8(out['a.txt'])).toBe('hello');
  });
});
