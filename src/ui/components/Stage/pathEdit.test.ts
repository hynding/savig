import { describe, it, expect } from 'vitest';
import { insertNodeAt, deleteNodeAt, moveAnchor, moveHandle, toggleSmooth, joinHandle, spliceNodeEasings, spliceCorrespondence } from './pathEdit';
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

const smooth: PathData = {
  nodes: [{ anchor: { x: 10, y: 10 }, in: { x: -5, y: 0 }, out: { x: 5, y: 0 } }],
  closed: false,
};

describe('moveAnchor', () => {
  it('sets the anchor (handles are relative offsets, so they ride along)', () => {
    const out = moveAnchor(smooth, 0, { x: 20, y: 20 });
    expect(out.nodes[0].anchor).toEqual({ x: 20, y: 20 });
    expect(out.nodes[0].out).toEqual({ x: 5, y: 0 });
  });
});

describe('moveHandle', () => {
  it('mirrors the opposite handle when mirror=true', () => {
    const out = moveHandle(smooth, 0, 'out', { x: 0, y: 8 }, true);
    expect(out.nodes[0].out).toEqual({ x: 0, y: 8 });
    expect(out.nodes[0].in).toEqual({ x: 0, y: -8 });
  });
  it('leaves the opposite handle alone when mirror=false', () => {
    const out = moveHandle(smooth, 0, 'out', { x: 0, y: 8 }, false);
    expect(out.nodes[0].out).toEqual({ x: 0, y: 8 });
    expect(out.nodes[0].in).toEqual({ x: -5, y: 0 });
  });
});

describe('toggleSmooth', () => {
  it('drops handles when smoothing a node that already has handles (-> corner)', () => {
    const out = toggleSmooth(smooth, 0);
    expect(out.nodes[0].in).toBeUndefined();
    expect(out.nodes[0].out).toBeUndefined();
  });
  it('adds mirrored handles to a corner node (-> smooth)', () => {
    const corner: PathData = {
      nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 20, y: 0 } }],
      closed: false,
    };
    // prev=node0(0,0), next=node2(20,0): tangent chord/4 = (5,0); in mirrors out.
    const out = toggleSmooth(corner, 1);
    expect(out.nodes[1].out).toEqual({ x: 5, y: 0 });
    expect(out.nodes[1].in).toEqual({ x: -5, y: 0 });
  });

  it('orients an open-path endpoint handle toward its single neighbor (no wrap)', () => {
    const corner: PathData = {
      nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 10, y: 0 } }, { anchor: { x: 10, y: 10 } }],
      closed: false,
    };
    // Node 0 of an OPEN path: tangent must follow 0->1 (horizontal), not wrap to node 2.
    const out = toggleSmooth(corner, 0);
    expect(out.nodes[0].out).toEqual({ x: 2.5, y: 0 });
    expect(out.nodes[0].in).toEqual({ x: -2.5, y: 0 });
  });
});

describe('joinHandle', () => {
  it('enforces mirrored handles', () => {
    const broken: PathData = {
      nodes: [{ anchor: { x: 0, y: 0 }, in: { x: -5, y: 0 }, out: { x: 2, y: 9 } }],
      closed: false,
    };
    const out = joinHandle(broken, 0);
    expect(out.nodes[0].in).toEqual({ x: -out.nodes[0].out!.x, y: -out.nodes[0].out!.y });
  });
});

describe('spliceNodeEasings', () => {
  it('insert adds a hole at index, shifting later entries', () => {
    expect(spliceNodeEasings(['easeIn', 'linear'], 1, 'insert')).toEqual(['easeIn', undefined, 'linear']);
  });
  it('delete removes the entry at index', () => {
    expect(spliceNodeEasings(['easeIn', 'linear', 'easeOut'], 1, 'delete')).toEqual(['easeIn', 'easeOut']);
  });
  it('collapses to undefined when no real entries remain', () => {
    expect(spliceNodeEasings(['easeIn'], 0, 'delete')).toBeUndefined();
  });
  it('returns undefined unchanged (nothing to maintain)', () => {
    expect(spliceNodeEasings(undefined, 0, 'insert')).toBeUndefined();
  });
  it('does not mutate the input', () => {
    const src = ['easeIn', 'linear'];
    spliceNodeEasings(src as ('easeIn' | 'linear')[], 0, 'delete');
    expect(src).toEqual(['easeIn', 'linear']);
  });
});

describe('spliceCorrespondence', () => {
  it('insert: new node inherits its predecessor target (adjacent merge, stays valid)', () => {
    expect(spliceCorrespondence([2, 0, 1], 2, 'insert')).toEqual([2, 0, 0, 1]); // new@2 inherits c[1]=0
  });
  it('insert at index 0 inherits c[0]', () => {
    expect(spliceCorrespondence([2, 0, 1], 0, 'insert')).toEqual([2, 2, 0, 1]);
  });
  it('delete removes the entry at index', () => {
    expect(spliceCorrespondence([2, 0, 1], 1, 'delete')).toEqual([2, 1]);
  });
  it('returns undefined unchanged', () => {
    expect(spliceCorrespondence(undefined, 0, 'insert')).toBeUndefined();
  });
  it('does not mutate the input', () => {
    const src = [2, 0, 1];
    spliceCorrespondence(src, 1, 'delete');
    expect(src).toEqual([2, 0, 1]);
  });
});
