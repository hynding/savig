// jsdom's SVG elements have no getBBox, so the REAL measurement path only runs in a browser
// (covered by the e2e suite's text selection/marquee flows). What jsdom can pin: the measurer
// never throws in a DOM-less-metrics environment, reports null so callers fall back to the
// estimate, and the cache answers repeat queries without re-touching the DOM.
import { describe, expect, it, vi } from 'vitest';
import { domTextMeasurer } from './measureText';

describe('domTextMeasurer', () => {
  it('returns null (fallback signal) when getBBox is unavailable, without throwing', () => {
    expect(() => domTextMeasurer({ content: 'Hi', fontSize: 10 })).not.toThrow();
    expect(domTextMeasurer({ content: 'Hi', fontSize: 10 })).toBeNull();
  });

  it('caches by content/size/family/anchor: a getBBox-capable node is measured ONCE per key', () => {
    const getBBox = vi.fn(() => ({ x: 1, y: 2, width: 30, height: 12 }));
    const proto = Object.getPrototypeOf(document.createElementNS('http://www.w3.org/2000/svg', 'text')) as {
      getBBox?: typeof getBBox;
    };
    proto.getBBox = getBBox;
    try {
      const a = domTextMeasurer({ content: 'cache-me', fontSize: 14, fontFamily: 'serif', textAnchor: 'middle' });
      const b = domTextMeasurer({ content: 'cache-me', fontSize: 14, fontFamily: 'serif', textAnchor: 'middle' });
      expect(a).toEqual({ x: 1, y: 2, width: 30, height: 12 });
      expect(b).toEqual(a);
      expect(getBBox).toHaveBeenCalledTimes(1);

      domTextMeasurer({ content: 'cache-me', fontSize: 15, fontFamily: 'serif', textAnchor: 'middle' });
      expect(getBBox).toHaveBeenCalledTimes(2); // different size = different key
    } finally {
      delete proto.getBBox;
    }
  });
});
