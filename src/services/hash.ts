// FNV-1a 32-bit content hash. Not cryptographic — used only for
// content-addressed dedupe and SVG id namespacing in M1.
export function hashContent(data: string | Uint8Array): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193);
  }
  // >>> 0 coerces to unsigned 32-bit; pad to a fixed 8-char hex string.
  return (hash >>> 0).toString(16).padStart(8, '0');
}
