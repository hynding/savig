import { describe, it, expect } from 'vitest';
import { insertNodeAt, deleteNodeAt } from './pathEdit';
import type { PathData } from '../../../engine';

const line: PathData = {
  nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }],
  closed: false,
};

describe('insertNodeAt', () => {
  it('inserts a node at the midpoint of a segment', () => {
    const out = insertNodeAt(line, 0, 0.5);
    expect(out.nodes).toHaveLength(3);
    expect(out.nodes[1].anchor).toEqual({ x: 5, y: 0 });
  });
});

describe('deleteNodeAt', () => {
  it('removes a node', () => {
    const three: PathData = { nodes: [...line.nodes, { anchor: { x: 10, y: 10 } }], closed: false };
    const out = deleteNodeAt(three, 1);
    expect(out.nodes.map((n) => n.anchor)).toEqual([{ x: 0, y: 0 }, { x: 10, y: 10 }]);
  });

  it('refuses to drop below 2 nodes', () => {
    expect(deleteNodeAt(line, 0)).toEqual(line);
  });
});
