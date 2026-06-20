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

  it('removes SMIL animation elements', () => {
    const el = parse('<svg xmlns="http://www.w3.org/2000/svg"><rect><animate attributeName="x"/></rect><animateTransform/></svg>');
    sanitizeSvgElement(el);
    expect(el.querySelector('animate')).toBeNull();
    expect(el.querySelector('animateTransform')).toBeNull();
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
