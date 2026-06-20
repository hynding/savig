import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { zipBundle } from './zipBundle';

describe('zipBundle', () => {
  it('zips the files and round-trips their contents', () => {
    const zipped = zipBundle({ 'index.html': '<html></html>', 'savig-runtime.js': 'RT();' });
    const out = unzipSync(zipped);
    expect(strFromU8(out['index.html'])).toBe('<html></html>');
    expect(strFromU8(out['savig-runtime.js'])).toBe('RT();');
  });
});
