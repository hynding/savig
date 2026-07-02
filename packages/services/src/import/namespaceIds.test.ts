import { describe, expect, it } from 'vitest';
import { namespaceIds } from './namespaceIds';

function parse(svg: string): Element {
  return new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
}

describe('namespaceIds', () => {
  it('prefixes id attributes', () => {
    const el = parse('<svg xmlns="http://www.w3.org/2000/svg"><linearGradient id="g1"/></svg>');
    namespaceIds(el, 'a3f2');
    expect(el.querySelector('linearGradient')!.getAttribute('id')).toBe('a3f2__g1');
  });

  it('rewrites url(#id) references in attributes', () => {
    const el = parse('<svg xmlns="http://www.w3.org/2000/svg"><linearGradient id="g1"/><rect fill="url(#g1)"/></svg>');
    namespaceIds(el, 'a3f2');
    expect(el.querySelector('rect')!.getAttribute('fill')).toBe('url(#a3f2__g1)');
  });

  it('rewrites url(#id) inside inline style', () => {
    const el = parse('<svg xmlns="http://www.w3.org/2000/svg"><clipPath id="c"/><rect style="clip-path:url(#c)"/></svg>');
    namespaceIds(el, 'a3f2');
    expect(el.querySelector('rect')!.getAttribute('style')).toContain('url(#a3f2__c)');
  });

  it('rewrites href and xlink:href hash references', () => {
    const el = parse('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><rect id="r"/><use href="#r"/><use xlink:href="#r"/></svg>');
    namespaceIds(el, 'a3f2');
    const uses = el.querySelectorAll('use');
    expect(uses[0].getAttribute('href')).toBe('#a3f2__r');
    expect(uses[1].getAttribute('xlink:href')).toBe('#a3f2__r');
  });

  it('does not touch unrelated attributes', () => {
    const el = parse('<svg xmlns="http://www.w3.org/2000/svg"><rect fill="red"/></svg>');
    namespaceIds(el, 'a3f2');
    expect(el.querySelector('rect')!.getAttribute('fill')).toBe('red');
  });
});
