// Inlining multiple SVGs into one document collides their internal ids,
// silently corrupting gradients/filters/clip-paths/<use>. Namespacing every
// id by a per-asset prefix and rewriting all references fixes this.
export function namespaceIds(svg: Element, prefix: string): void {
  const all = [svg, ...Array.from(svg.querySelectorAll('*'))];

  const idMap = new Map<string, string>();
  for (const el of all) {
    const id = el.getAttribute('id');
    if (id) {
      const next = `${prefix}__${id}`;
      idMap.set(id, next);
      el.setAttribute('id', next);
    }
  }
  if (idMap.size === 0) return;

  const rewrite = (value: string): string =>
    value
      .replace(/url\(\s*#([^)\s]+)\s*\)/g, (m, id) =>
        idMap.has(id) ? `url(#${idMap.get(id)})` : m,
      )
      .replace(/^#([^\s]+)$/, (m, id) => (idMap.has(id) ? `#${idMap.get(id)}` : m));

  for (const el of all) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name === 'id') continue;
      const next = rewrite(attr.value);
      if (next !== attr.value) el.setAttribute(attr.name, next);
    }
  }
}
