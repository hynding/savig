const FORBIDDEN_TAGS = ['script', 'foreignObject'];
const SMIL_TAGS = ['animate', 'animateTransform', 'animateMotion', 'set', 'mpath'];
const REF_ATTRS = ['href', 'xlink:href', 'src'];

// Remove animation/handler/script content and external references so the
// SVG is safe to inline into one document. Mutates `svg`; returns warnings.
export function sanitizeSvgElement(svg: Element): string[] {
  const warnings: string[] = [];

  for (const tag of [...FORBIDDEN_TAGS, ...SMIL_TAGS]) {
    const matches = svg.querySelectorAll(tag);
    if (matches.length > 0 && tag === 'foreignObject') {
      warnings.push(`Removed unsupported <foreignObject> (${matches.length}).`);
    }
    matches.forEach((node) => node.remove());
  }

  const all = [svg, ...Array.from(svg.querySelectorAll('*'))];
  for (const el of all) {
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name)) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (REF_ATTRS.includes(attr.name) && /^\s*(https?:|\/\/)/i.test(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
  }

  for (const style of Array.from(svg.querySelectorAll('style'))) {
    style.textContent = stripCssAnimations(style.textContent ?? '');
  }

  return warnings;
}

function stripCssAnimations(css: string): string {
  // Drop @keyframes blocks and any `animation`/`animation-*` declarations.
  let out = css.replace(/@(-\w+-)?keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/gi, '');
  out = out.replace(/(^|[;{])\s*animation(-[\w-]+)?\s*:[^;}]*;?/gi, '$1');
  return out.trim();
}
