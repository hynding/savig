import { describe, it, expect } from 'vitest';
import { applyOverridesPass } from './applyOverridesPass';

function makeNode(tag = 'g'): SVGGraphicsElement {
  return document.createElementNS('http://www.w3.org/2000/svg', tag) as unknown as SVGGraphicsElement;
}

describe('applyOverridesPass', () => {
  it('sets display:none when hidden, and clears it (empty string) when un-hidden', () => {
    const node = makeNode();
    const nodes = new Map([['a', node]]);
    applyOverridesPass(nodes, new Map([['a', { hidden: true }]]));
    expect(node.getAttribute('display')).toBe('none');
    applyOverridesPass(nodes, new Map([['a', { hidden: false }]]));
    expect(node.getAttribute('display')).toBe('');
  });

  it('leaves display untouched when hidden is absent from the override', () => {
    const node = makeNode();
    node.setAttribute('display', 'none');
    applyOverridesPass(new Map([['a', node]]), new Map([['a', { opacity: 1 }]]));
    expect(node.getAttribute('display')).toBe('none');
  });

  it('writes a numeric opacity attribute', () => {
    const node = makeNode();
    applyOverridesPass(new Map([['a', node]]), new Map([['a', { opacity: 0.4 }]]));
    expect(node.getAttribute('opacity')).toBe('0.4');
  });

  it('prepends translate(dx dy) to an existing transform attribute', () => {
    const node = makeNode();
    node.setAttribute('transform', 'rotate(10)');
    applyOverridesPass(new Map([['a', node]]), new Map([['a', { dx: 5, dy: -3 }]]));
    expect(node.getAttribute('transform')).toBe('translate(5 -3) rotate(10)');
  });

  it('defaults a missing dx or dy component to 0', () => {
    const node = makeNode();
    applyOverridesPass(new Map([['a', node]]), new Map([['a', { dx: 5 }]]));
    expect(node.getAttribute('transform')).toBe('translate(5 0) ');
  });

  it('sets textContent only on a <text> node, never on other tags', () => {
    const textNode = makeNode('text');
    const gNode = makeNode('g');
    applyOverridesPass(
      new Map([
        ['t', textNode],
        ['g', gNode],
      ]),
      new Map([
        ['t', { text: 'hi' }],
        ['g', { text: 'nope' }],
      ]),
    );
    expect(textNode.textContent).toBe('hi');
    expect(gNode.textContent).toBe('');
  });

  it('sets textContent on a <text> DESCENDANT when the registered node is its <g> wrapper (real Stage/export DOM shape)', () => {
    const g = makeNode('g');
    const text = makeNode('text');
    text.textContent = 'old';
    g.appendChild(text);
    applyOverridesPass(new Map([['a', g]]), new Map([['a', { text: 'new' }]]));
    expect(text.textContent).toBe('new');
  });

  it('does not touch textContent on a wrapper <g> with no <text> descendant', () => {
    const g = makeNode('g');
    expect(() => applyOverridesPass(new Map([['a', g]]), new Map([['a', { text: 'x' }]]))).not.toThrow();
    expect(g.textContent).toBe('');
  });

  it('targets the <textPath> child, not <text> itself, on a text-on-path leaf — binding preserved, content updated', () => {
    const g = makeNode('g');
    const text = makeNode('text');
    const textPath = makeNode('textPath');
    textPath.setAttribute('href', '#savig-textpath-a');
    textPath.setAttribute('startOffset', '0.25');
    textPath.textContent = 'old';
    text.appendChild(textPath);
    g.appendChild(text);

    applyOverridesPass(new Map([['a', g]]), new Map([['a', { text: 'new' }]]));

    // Content updated on the textPath, NOT duplicated/blown away as a sibling text node on <text>.
    expect(textPath.textContent).toBe('new');
    expect(text.textContent).toBe('new'); // <text>'s only content IS the textPath's
    expect(text.querySelector('textPath')).toBe(textPath); // binding element still present
    // The binding attributes (frame.ts only ever touches `startOffset`, never these) survive.
    expect(textPath.getAttribute('href')).toBe('#savig-textpath-a');
    expect(textPath.getAttribute('startOffset')).toBe('0.25');
  });

  it('text-on-path setText is idempotent across repeated applies (no drift, no duplicate children)', () => {
    const g = makeNode('g');
    const text = makeNode('text');
    const textPath = makeNode('textPath');
    textPath.setAttribute('href', '#savig-textpath-a');
    textPath.textContent = 'old';
    text.appendChild(textPath);
    g.appendChild(text);
    const nodes = new Map([['a', g]]);
    const overrides = new Map([['a', { text: 'score: 3' }]]);

    applyOverridesPass(nodes, overrides);
    applyOverridesPass(nodes, overrides);
    applyOverridesPass(nodes, overrides);

    expect(textPath.textContent).toBe('score: 3');
    expect(text.children.length).toBe(1); // still exactly one <textPath>, never duplicated
    expect(text.querySelector('textPath')).toBe(textPath);
  });

  it('silently skips a renderId with no matching node', () => {
    expect(() => applyOverridesPass(new Map(), new Map([['missing', { hidden: true }]]))).not.toThrow();
  });

  it('re-running after a fresh frame-write of transform yields exactly ONE translate prefix (no double-prepend)', () => {
    const node = makeNode();
    node.setAttribute('transform', 'rotate(10)');
    const nodes = new Map([['a', node]]);
    const overrides = new Map([['a', { dx: 5, dy: 0 }]]);
    applyOverridesPass(nodes, overrides);
    expect(node.getAttribute('transform')).toBe('translate(5 0) rotate(10)');
    // Simulate the NEXT frame's applyFrameToNodes rewriting `transform` from scratch, THEN the
    // post-pass reapplying the same override — same synchronous pattern as the real paint path.
    node.setAttribute('transform', 'rotate(20)');
    applyOverridesPass(nodes, overrides);
    expect(node.getAttribute('transform')).toBe('translate(5 0) rotate(20)');
  });
});
