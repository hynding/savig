import { describe, expect, it } from 'vitest';
import { ellipsePerimeter, rectPerimeter, resolvePathLengths, svgPathLength } from './pathLength';

const parse = (markup: string) => new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement;

describe('svgPathLength', () => {
  it('measures lines, H/V, relative commands and Z', () => {
    expect(svgPathLength('M 0 0 L 30 40')).toBeCloseTo(50, 9);
    expect(svgPathLength('M0 0H10V10h-10z')).toBeCloseTo(40, 9);
    expect(svgPathLength('M 0 0 10 0 10 10')).toBeCloseTo(20, 9); // implicit lineto after M
    expect(svgPathLength('M 0 0 L 10 0 Z M 100 100 l 0 5')).toBeCloseTo(25, 9); // two subpaths
  });

  it('measures cubic, smooth cubic, quadratic and arc segments', () => {
    // A straight-line cubic is exactly its chord.
    expect(svgPathLength('M 0 0 C 10 0 20 0 30 0')).toBeCloseTo(30, 6);
    // Quarter circle of r=100 as an arc.
    expect(svgPathLength('M 100 0 A 100 100 0 0 1 0 100')).toBeCloseTo((Math.PI * 100) / 2, 1);
    // Half circle the other way round is still pi*r.
    expect(svgPathLength('M 0 0 A 50 50 0 0 0 100 0')).toBeCloseTo(Math.PI * 50, 1);
    // Standard 4-cubic circle approximation (k=0.5523) is within 0.03% of 2*pi*r.
    const k = 55.228;
    const circle = `M 100 0 C 100 ${k} ${k} 100 0 100 C ${-k} 100 -100 ${k} -100 0 C -100 ${-k} ${-k} -100 0 -100 C ${k} -100 100 ${-k} 100 0 Z`;
    expect(svgPathLength(circle) / (2 * Math.PI * 100)).toBeCloseTo(1, 3);
    expect(svgPathLength('M 0 0 Q 10 0 20 0 T 40 0')).toBeCloseTo(40, 6);
    expect(svgPathLength('M 0 0 C 0 0 10 0 10 0 S 20 0 20 0')).toBeCloseTo(20, 6);
  });
});

describe('shape perimeters', () => {
  it('rect (square corners, rounded, rx-only auto ry, clamped radii)', () => {
    expect(rectPerimeter(100, 50)).toBe(300);
    expect(rectPerimeter(100, 50, 10, 10)).toBeCloseTo(2 * 80 + 2 * 30 + 2 * Math.PI * 10, 2);
    expect(rectPerimeter(100, 50, 10)).toBeCloseTo(rectPerimeter(100, 50, 10, 10), 9);
    expect(rectPerimeter(20, 20, 50, 50)).toBeCloseTo(2 * Math.PI * 10, 2); // radii clamp to half-size
  });

  it('ellipse / circle', () => {
    expect(ellipsePerimeter(50, 50)).toBeCloseTo(2 * Math.PI * 50, 2);
    // Ramanujan II for a=100, b=50
    const h = (50 / 150) ** 2;
    const ram = Math.PI * 150 * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
    expect(ellipsePerimeter(100, 50)).toBeCloseTo(ram, 1);
  });
});

describe('resolvePathLengths', () => {
  it('scales a normalized dash array + offset by the real length and drops pathLength', () => {
    const svg = parse('<svg xmlns="http://www.w3.org/2000/svg"><path d="M 0 0 L 200 0" pathLength="1" stroke-dasharray="0.25 0.25" stroke-dashoffset="-0.1"/></svg>');
    resolvePathLengths(svg);
    const p = svg.querySelector('path')!;
    expect(p.hasAttribute('pathLength')).toBe(false);
    expect(p.getAttribute('stroke-dasharray')).toBe('50 50');
    expect(p.getAttribute('stroke-dashoffset')).toBe('-20');
  });

  it('handles rects and ellipses (trim windows) and a non-1 pathLength', () => {
    const svg = parse(
      '<svg xmlns="http://www.w3.org/2000/svg">'
      + '<rect width="100" height="50" pathLength="1" stroke-dasharray="0.5 0.5"/>'
      + '<ellipse cx="50" cy="50" rx="50" ry="50" pathLength="10" stroke-dasharray="5 5"/>'
      + '</svg>',
    );
    resolvePathLengths(svg);
    expect(svg.querySelector('rect')!.getAttribute('stroke-dasharray')).toBe('150 150');
    const [a, b] = svg.querySelector('ellipse')!.getAttribute('stroke-dasharray')!.split(' ').map(Number);
    expect(a).toBeCloseTo(Math.PI * 50, 1);
    expect(b).toBeCloseTo(Math.PI * 50, 1);
  });

  it('scales a text-on-path startOffset that references a normalized def', () => {
    const svg = parse(
      '<svg xmlns="http://www.w3.org/2000/svg"><defs><path id="tp" d="M 0 0 L 400 0" pathLength="1" fill="none"/></defs>'
      + '<text><textPath href="#tp" startOffset="0.25">Hi</textPath></text></svg>',
    );
    resolvePathLengths(svg);
    expect(svg.querySelector('textPath')!.getAttribute('startOffset')).toBe('100');
    expect(svg.querySelector('#tp')!.hasAttribute('pathLength')).toBe(false);
  });

  it('leaves solid strokes, percentages and elements without pathLength alone', () => {
    const svg = parse(
      '<svg xmlns="http://www.w3.org/2000/svg">'
      + '<path id="a" d="M 0 0 L 10 0" stroke-dasharray="2 2"/>'
      + '<path id="b" d="M 0 0 L 10 0" pathLength="1"/>'
      + '<path id="c" d="M 0 0 L 10 0" pathLength="1" stroke-dasharray="10% 5%"/>'
      + '</svg>',
    );
    resolvePathLengths(svg);
    expect(svg.querySelector('#a')!.getAttribute('stroke-dasharray')).toBe('2 2');
    expect(svg.querySelector('#b')!.hasAttribute('stroke-dasharray')).toBe(false);
    expect(svg.querySelector('#c')!.getAttribute('stroke-dasharray')).toBe('10% 5%');
  });
});
