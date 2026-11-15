import type { ImageAsset } from '@savig/engine';
import { ImageImportError } from '../errors';
import { hashContent } from '../hash';
import { bytesToBase64 } from '../bytes';

// Bitmap import (spec 2026-11-15-bitmap-import). Pure and DOM-free so the editor, the headless core
// and the MCP server share it: the file type is SNIFFED from its magic bytes (a renamed file or a
// lying browser MIME type can't smuggle anything else in) and the natural size is read from the
// header, so no image decoder is needed.

/** Largest accepted file. The pixels are inlined as base64 in the project, so keep files sane. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

export interface ImageInfo {
  mimeType: ImageAsset['mimeType'];
  width: number;
  height: number;
}

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) { i += 1; continue; } // fill byte
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = u16be(b, i + 2);
    // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the frame size.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: u16be(b, i + 5), width: u16be(b, i + 7) };
    }
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

function webpSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 25) return null;
  const chunk = ascii(b, 12, 4);
  if (chunk === 'VP8L') {
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (b.length < 30) return null;
  if (chunk === 'VP8 ') return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  if (chunk === 'VP8X') return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  return null;
}

/** The type and natural size of a PNG / JPEG / GIF / WebP file, or null when it is none of them
 *  (or its header is truncated / reports a zero size). */
export function sniffImage(bytes: Uint8Array): ImageInfo | null {
  const b = bytes;
  let info: ImageInfo | null = null;
  if (b.length >= 24 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG' && ascii(b, 12, 4) === 'IHDR') {
    info = { mimeType: 'image/png', width: u32be(b, 16), height: u32be(b, 20) };
  } else if (b.length >= 10 && (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a')) {
    info = { mimeType: 'image/gif', width: u16le(b, 6), height: u16le(b, 8) };
  } else if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    const s = jpegSize(b);
    info = s ? { mimeType: 'image/jpeg', ...s } : null;
  } else if (b.length >= 16 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') {
    const s = webpSize(b);
    info = s ? { mimeType: 'image/webp', ...s } : null;
  }
  return info && info.width > 0 && info.height > 0 ? info : null;
}

/** A display name from a file name: the extension dropped ("photo.png" -> "photo"). */
function displayName(name: string): string {
  const base = name.replace(/^.*[\\/]/, '');
  const stem = base.replace(/\.[^.]+$/, '');
  return stem || base || 'Image';
}

/** Build an `ImageAsset` from a file's bytes. The id is a content hash, so importing the same
 *  picture twice reuses one asset. Throws `ImageImportError` for an unsupported or oversized file. */
export function importImage(name: string, bytes: Uint8Array): ImageAsset {
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw new ImageImportError(`"${name}" is larger than ${MAX_IMAGE_BYTES / (1024 * 1024)} MB.`);
  }
  const info = sniffImage(bytes);
  if (!info) throw new ImageImportError(`"${name}" is not a PNG, JPEG, GIF or WebP image.`);
  return {
    id: `img-${hashContent(bytes)}`,
    kind: 'image',
    name: displayName(name),
    mimeType: info.mimeType,
    dataUrl: `data:${info.mimeType};base64,${bytesToBase64(bytes)}`,
    width: info.width,
    height: info.height,
  };
}
