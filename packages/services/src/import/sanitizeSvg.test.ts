import { describe, expect, it } from 'vitest';
import { sanitizeSvgElement } from './sanitizeSvg';

function parse(svg: string): Element {
  return new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
}

describe('sanitizeSvgElement', () => {
  it('removes <script> elements', () => {
    const el = parse('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect/></svg>');
    sanitizeSvgElement(el);
    expect(el.querySelector('script')).toBeNull();
    expect(el.querySelector('rect')).not.toBeNull();
  });

  it('removes <metadata> (embedded savig project data must not enter assets)', () => {
    const svg = parse('<svg xmlns="http://www.w3.org/2000/svg"><metadata data-savig-source="project">{}</metadata><rect/></svg>');
    sanitizeSvgElement(svg);
    expect(svg.querySelector('metadata')).toBeNull();
  });

  it('keeps safe SMIL animation elements', () => {
    const svg = parse(`<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10">
    <animate attributeName="width" values="10;20;10" dur="1s" repeatCount="indefinite"/>
    <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="2s"/>
  </rect><path d="M0 0 L10 10" id="p"/><circle r="2"><animateMotion dur="3s"><mpath href="#p"/></animateMotion></circle></svg>`);
    const warnings = sanitizeSvgElement(svg);
    expect(svg.querySelectorAll('animate, animateTransform, animateMotion, mpath').length).toBe(4);
    expect(warnings).toEqual([]);
  });

  it.each([
    ['href', '<set attributeName="href" to="javascript:alert(1)"/>'],
    ['xlink:href', '<animate attributeName="xlink:href" values="javascript:x"/>'],
    ['style', '<animate attributeName="style" values="fill:red"/>'],
    ['id', '<set attributeName="id" to="savig-asset-x"/>'],
    ['class', '<set attributeName="class" to="toolbar"/>'],
    ['data-savig-object', '<set attributeName="data-savig-object" to="torso"/>'],
    ['onclick', '<set attributeName="onclick" to="x"/>'],
    ['HREF', '<set attributeName="HREF" to="javascript:x"/>'],
  ])('removes SMIL animating unsafe attribute %s (with warning)', (_name, smil) => {
    const svg = parse(`<svg xmlns="http://www.w3.org/2000/svg"><a>${smil}</a></svg>`);
    const warnings = sanitizeSvgElement(svg);
    expect(svg.querySelectorAll('set, animate').length).toBe(0);
    expect(warnings.length).toBe(1);
  });

  it('still strips unsafe refs and on* attributes ON SMIL elements it keeps', () => {
    const svg = parse('<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"><animateMotion dur="1s" onend="alert(1)"><mpath href="https://evil.example/x#p"/></animateMotion></circle></svg>');
    sanitizeSvgElement(svg);
    const motion = svg.querySelector('animateMotion')!;
    expect(motion.hasAttribute('onend')).toBe(false);
    expect(svg.querySelector('mpath')!.hasAttribute('href')).toBe(false);
  });

  it.each(['animate', 'animateTransform', 'set', 'animateMotion'])(
    'strips href/xlink:href retargeting attributes from <%s> but keeps the element',
    (tag) => {
      const svg = parse(
        `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><rect id="safe"><${tag} attributeName="opacity" xlink:href="#savig-asset-x" href="#savig-asset-x" to="0"/></rect></svg>`,
      );
      const warnings = sanitizeSvgElement(svg);
      const el = svg.querySelector(tag)!;
      expect(el).not.toBeNull();
      expect(el.hasAttribute('href')).toBe(false);
      expect(el.hasAttribute('xlink:href')).toBe(false);
      expect(warnings).toEqual([]);
    },
  );

  it('does not strip href on <mpath> (governed by the #fragment ref allowlist instead)', () => {
    const svg = parse(
      '<svg xmlns="http://www.w3.org/2000/svg"><path id="p" d="M0 0 L10 10"/><circle r="2"><animateMotion dur="3s"><mpath href="#p"/></animateMotion></circle></svg>',
    );
    sanitizeSvgElement(svg);
    expect(svg.querySelector('mpath')!.getAttribute('href')).toBe('#p');
  });

  it('removes inline event handler attributes', () => {
    const el = parse('<svg xmlns="http://www.w3.org/2000/svg"><rect onclick="x()" onload="y()"/></svg>');
    sanitizeSvgElement(el);
    const rect = el.querySelector('rect')!;
    expect(rect.hasAttribute('onclick')).toBe(false);
    expect(rect.hasAttribute('onload')).toBe(false);
  });

  it('strips external http(s) href/xlink:href but keeps internal #refs', () => {
    const el = parse('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="https://evil.example/x.svg"/><use href="#local"/></svg>');
    sanitizeSvgElement(el);
    const uses = el.querySelectorAll('use');
    expect(uses[0].hasAttribute('xlink:href')).toBe(false);
    expect(uses[1].getAttribute('href')).toBe('#local');
  });

  it('strips javascript: and data:text/html href/xlink:href (allowlist)', () => {
    const el = parse('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><a href="javascript:alert(1)"/><a xlink:href="data:text/html,hi"/><a href="#ok"/></svg>');
    sanitizeSvgElement(el);
    const links = el.querySelectorAll('a');
    expect(links[0].hasAttribute('href')).toBe(false);
    expect(links[1].hasAttribute('xlink:href')).toBe(false);
    expect(links[2].getAttribute('href')).toBe('#ok');
  });

  it('keeps inline raster data: image references', () => {
    const el = parse('<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,iVBORw0KGgo="/></svg>');
    sanitizeSvgElement(el);
    expect(el.querySelector('image')!.getAttribute('href')).toBe('data:image/png;base64,iVBORw0KGgo=');
  });

  it('removes <foreignObject> and warns', () => {
    const el = parse('<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div/></foreignObject></svg>');
    const warnings = sanitizeSvgElement(el);
    expect(el.querySelector('foreignObject')).toBeNull();
    expect(warnings.some((w) => /foreignObject/i.test(w))).toBe(true);
  });

  it('strips @keyframes and animation declarations from <style>', () => {
    const el = parse('<svg xmlns="http://www.w3.org/2000/svg"><style>@keyframes spin{from{}to{}} .a{fill:red;animation:spin 1s;}</style></svg>');
    sanitizeSvgElement(el);
    const css = el.querySelector('style')!.textContent ?? '';
    expect(css).not.toMatch(/@keyframes/);
    expect(css).not.toMatch(/animation/);
    expect(css).toMatch(/fill:\s*red/);
  });
});
