import { describe, it, expect } from 'vitest';
import { parsePathD } from './parsePathD';

describe('parsePathD', () => {
  it('absolute M L with implicit repeat', () => {
    expect(parsePathD('M0 0 L10 0 10 10')).toEqual([
      { type: 'M', x: 0, y: 0 }, { type: 'L', x: 10, y: 0 }, { type: 'L', x: 10, y: 10 },
    ]);
  });
  it('relative m l fold against the running point', () => {
    expect(parsePathD('m5 5 l5 0')).toEqual([
      { type: 'M', x: 5, y: 5 }, { type: 'L', x: 10, y: 5 },
    ]);
  });
  it('H/V fold to absolute L', () => {
    expect(parsePathD('M0 0 H10 V20')).toEqual([
      { type: 'M', x: 0, y: 0 }, { type: 'L', x: 10, y: 0 }, { type: 'L', x: 10, y: 20 },
    ]);
  });
  it('S reflects the previous cubic control point into a C', () => {
    const out = parsePathD('M0 0 C0 10 10 10 10 0 S20 -10 20 0');
    expect(out[2]).toEqual({ type: 'C', x1: 10, y1: -10, x2: 20, y2: -10, x: 20, y: 0 });
  });
  it('Z closes and resets the running point to the subpath start', () => {
    const out = parsePathD('M2 2 L8 2 Z l1 0');
    expect(out[2]).toEqual({ type: 'Z' });
    expect(out[3]).toEqual({ type: 'L', x: 3, y: 2 }); // relative to (2,2), not (8,2)
  });
  it('A passes flags + endpoint through (absolute)', () => {
    const out = parsePathD('M0 0 A5 5 0 0 1 10 0');
    expect(out[1]).toEqual({ type: 'A', rx: 5, ry: 5, rot: 0, large: false, sweep: true, x: 10, y: 0 });
  });
  it('A flags may be packed with no separators (large=1, sweep=1)', () => {
    // the two flags are single 0/1 chars; "11" must scan as large=1 then sweep=1, not the number 11
    const out = parsePathD('M0 0 a5 5 0 11 10 0');
    expect(out[1]).toEqual({ type: 'A', rx: 5, ry: 5, rot: 0, large: true, sweep: true, x: 10, y: 0 });
  });
  it('exponent + no-separator coordinates scan correctly', () => {
    expect(parsePathD('M0 0 L-1.5e1.5')).toEqual([
      { type: 'M', x: 0, y: 0 }, { type: 'L', x: -15, y: 0.5 }, // "-1.5e1" then ".5"
    ]);
  });
  it('malformed d returns the partial list without throwing', () => {
    expect(() => parsePathD('M0 0 L10 garbage')).not.toThrow();
    expect(parsePathD('M0 0 L10 garbage')[0]).toEqual({ type: 'M', x: 0, y: 0 });
  });
  it('Q quadratic and T reflection', () => {
    const out = parsePathD('M0 0 Q5 10 10 0 T20 0');
    expect(out[1]).toEqual({ type: 'Q', x1: 5, y1: 10, x: 10, y: 0 });
    expect(out[2]).toEqual({ type: 'Q', x1: 15, y1: -10, x: 20, y: 0 }); // reflect (5,10) about (10,0)
  });
});
