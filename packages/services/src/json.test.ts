import { describe, expect, it } from 'vitest';
import { stableJson } from './json';

describe('stableJson', () => {
  it('sorts object keys recursively', () => {
    expect(stableJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it('preserves array order', () => {
    expect(stableJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('produces identical output regardless of key insertion order', () => {
    expect(stableJson({ x: 1, y: 2 })).toBe(stableJson({ y: 2, x: 1 }));
  });
});
