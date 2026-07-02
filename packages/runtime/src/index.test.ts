import { describe, expect, it } from 'vitest';
import { applyFrameToNodes } from './frame';

const SVG_NS = 'http://www.w3.org/2000/svg';

describe('applyFrameToNodes', () => {
  it('applies transform/opacity to the wrapper and geometry to the inner shape', () => {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('data-savig-object', 'v1');
    const rect = document.createElementNS(SVG_NS, 'rect');
    g.appendChild(rect);
    const nodes = new Map<string, Element>([['v1', g]]);

    applyFrameToNodes(nodes, [
      {
        objectId: 'v1',
        transform: 'translate(1, 2)',
        opacity: '0.5',
        geometry: { x: '0', y: '0', width: '120', height: '80' },
      },
    ]);

    expect(g.getAttribute('transform')).toBe('translate(1, 2)');
    expect(g.getAttribute('opacity')).toBe('0.5');
    expect(rect.getAttribute('width')).toBe('120');
    expect(rect.getAttribute('height')).toBe('80');
  });

  it('leaves nodes without geometry untouched on the inner element', () => {
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('data-savig-object', 'o1');
    const nodes = new Map<string, Element>([['o1', use]]);
    applyFrameToNodes(nodes, [{ objectId: 'o1', transform: 't', opacity: '1' }]);
    expect(use.getAttribute('transform')).toBe('t');
  });
});
