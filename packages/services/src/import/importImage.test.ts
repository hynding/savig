import { describe, expect, it } from 'vitest';
import { base64ToBytes } from '../bytes';
import { ImageImportError } from '../errors';
import { isSafeImageDataUrl } from '../persistence/sanitizeImages';
import { importImage, MAX_IMAGE_BYTES, sniffImage } from './importImage';

// A real 2x2 red PNG.
const PNG = base64ToBytes('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==');

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? Array.from(p, (c) => c.charCodeAt(0)) : p)));

describe('sniffImage', () => {
  it('reads a PNG size from IHDR', () => {
    expect(sniffImage(PNG)).toEqual({ mimeType: 'image/png', width: 2, height: 2 });
  });

  it('reads a GIF logical screen size', () => {
    expect(sniffImage(bytes('GIF89a', [0x40, 0x01, 0xf0, 0x00], [0, 0, 0]))).toEqual({ mimeType: 'image/gif', width: 320, height: 240 });
  });

  it('walks JPEG segments to the SOF frame header', () => {
    const jpeg = bytes(
      [0xff, 0xd8],
      [0xff, 0xe0, 0x00, 0x04, 0x00, 0x00], // APP0, 2 payload bytes
      [0xff, 0xc4, 0x00, 0x03, 0x00], // DHT is not a frame header
      [0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x02, 0x80, 0x03], // SOF0 h=300 w=640
      new Array(10).fill(0),
    );
    expect(sniffImage(jpeg)).toEqual({ mimeType: 'image/jpeg', width: 640, height: 300 });
  });

  it('reads WebP VP8, VP8L and VP8X sizes', () => {
    const riff = (chunk: string, body: number[]) => bytes('RIFF', [0, 0, 0, 0], 'WEBP', chunk, [0, 0, 0, 0], body);
    // VP8: frame tag (3) + start code (3), then 14-bit width/height at 26/28.
    expect(sniffImage(riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, 100, 0, 50, 0, 0, 0]))).toMatchObject({ width: 100, height: 50 });
    // VP8L: signature 0x2f then 14-bit (w-1), 14-bit (h-1).
    const w = 64 - 1, h = 32 - 1;
    const bits = w | (h << 14);
    expect(sniffImage(riff('VP8L', [0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >> 24) & 0xff, 0, 0, 0, 0]))).toMatchObject({ mimeType: 'image/webp', width: 64, height: 32 });
    // VP8X: flags(4) then 24-bit (w-1), (h-1).
    expect(sniffImage(riff('VP8X', [0, 0, 0, 0, 199, 0, 0, 99, 0, 0]))).toMatchObject({ width: 200, height: 100 });
  });

  it('rejects anything else, truncated headers and zero sizes', () => {
    expect(sniffImage(bytes('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffImage(PNG.subarray(0, 20))).toBeNull();
    expect(sniffImage(bytes('GIF89a', [0, 0, 0, 0]))).toBeNull();
  });
});

describe('importImage', () => {
  it('builds an image asset with a safe data URL, natural size and a clean name', () => {
    const a = importImage('photos/Red dot.png', PNG);
    expect(a).toMatchObject({ kind: 'image', name: 'Red dot', mimeType: 'image/png', width: 2, height: 2 });
    expect(isSafeImageDataUrl(a.dataUrl)).toBe(true);
    expect(a.id).toMatch(/^img-/);
    expect(importImage('copy.png', PNG).id).toBe(a.id); // content-addressed
  });

  it('sniffs the type instead of trusting the file name', () => {
    expect(importImage('looks-like.jpg', PNG).mimeType).toBe('image/png');
  });

  it('refuses unsupported and oversized files', () => {
    expect(() => importImage('a.svg', bytes('<svg/>'))).toThrow(ImageImportError);
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set(PNG);
    expect(() => importImage('big.png', big)).toThrow(/larger than 10 MB/);
  });
});
