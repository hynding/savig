// Escape attribute values inlined into exported HTML/SVG. Values may originate
// from a loaded .savig (untrusted), so a crafted value must not break out of the
// attribute and inject markup. Shared by renderShape and gradient emission.
export function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
