import { describe, expect, it } from 'vitest';
import { escapeAttr } from './svgAttr';

describe('escapeAttr', () => {
  it('escapes the markup-significant characters', () => {
    expect(escapeAttr('a&b<c>d"e')).toBe('a&amp;b&lt;c&gt;d&quot;e');
  });

  it("escapes single quotes so values can't break out of single-quoted attributes", () => {
    expect(escapeAttr("x' onload='alert(1)")).toBe('x&#39; onload=&#39;alert(1)');
  });

  it('leaves plain values untouched', () => {
    expect(escapeAttr('plain-value 1.5px')).toBe('plain-value 1.5px');
  });
});
