// Pure unit tests for `makeNodeDragController` — no React. Uses a FAKE store (activeTool +
// snapEnabled) and FAKE ports (coordinate converters + a pathTools spy), so we can assert the
// gating (node tool + active grab), the snap priority (vertex over AABB), and the returned
// guide descriptor. The snap math itself (computeSnap/snapToVertices) is interaction-tested.
import type { AABB } from '@savig/interaction';
import { makeNodeDragController, type NodeDragMoveCtx, type NodePathTools } from './nodeDrag';
import type { ControllerStore } from './store';
import type { Point } from './coords';

function fakeStore(activeTool: string, snapEnabled: boolean): ControllerStore {
  return { getState: () => ({ activeTool, snapEnabled }) } as unknown as ControllerStore;
}

function fakePathTools(kind: string): NodePathTools & { drags: Point[]; ups: number } {
  const drags: Point[] = [];
  let ups = 0;
  return {
    grab: { kind },
    onNodeDrag: (p) => drags.push(p),
    onNodePointerUp: () => {
      ups += 1;
    },
    drags,
    get ups() {
      return ups;
    },
  };
}

function moveCtx(over: Partial<NodeDragMoveCtx> & { pathTools: NodePathTools | null }): NodeDragMoveCtx {
  return {
    clientToLocal: () => ({ x: 0, y: 0 }),
    clientToObjectLocal: () => ({ x: 0, y: 0 }),
    stageToObjectLocal: (sx, sy) => ({ x: sx, y: sy }),
    zoom: 1,
    bypass: false,
    ...over,
  };
}

describe('makeNodeDragController — gating', () => {
  it('does not consume when the tool is not the node tool', () => {
    const c = makeNodeDragController(fakeStore('select', true));
    c.beginGrab([], []);
    expect(c.move(moveCtx({ pathTools: fakePathTools('anchor') })).consumed).toBe(false);
  });

  it('does not consume without an active grab', () => {
    const c = makeNodeDragController(fakeStore('node', true));
    expect(c.move(moveCtx({ pathTools: fakePathTools('anchor') })).consumed).toBe(false);
  });
});

describe('makeNodeDragController — dragging + snapping', () => {
  it('drags the raw object-local point with no snap when the grab is not an anchor', () => {
    const c = makeNodeDragController(fakeStore('node', true));
    const pt = fakePathTools('handle'); // bezier handles never snap
    c.beginGrab([{ minX: 100, maxX: 120, minY: 40, maxY: 60 }], [{ x: 100, y: 100 }]);
    const r = c.move(moveCtx({ pathTools: pt, clientToObjectLocal: () => ({ x: 7, y: 8 }) }));
    expect(r.consumed).toBe(true);
    expect(r.snapGuides).toEqual({ x: null, y: null });
    expect(pt.drags).toEqual([{ x: 7, y: 8 }]);
  });

  it('snaps an anchor onto a nearby vertex (priority over AABB) and reports a crosshair guide', () => {
    const c = makeNodeDragController(fakeStore('node', true));
    const pt = fakePathTools('anchor');
    const targets: AABB[] = [{ minX: 200, maxX: 220, minY: 200, maxY: 220 }];
    c.beginGrab(targets, [{ x: 100, y: 100 }]);
    // stage point (103,103) is within SNAP_PX (6) of the vertex (100,100)
    const r = c.move(moveCtx({ pathTools: pt, clientToLocal: () => ({ x: 103, y: 103 }), clientToObjectLocal: () => ({ x: 5, y: 5 }) }));
    expect(r.snapGuides).toEqual({ x: 100, y: 100 });
    // stageToObjectLocal is identity in the fake, so the snapped stage point (100,100) flows through
    expect(pt.drags).toEqual([{ x: 100, y: 100 }]);
  });

  it('bypasses snapping when Cmd/Ctrl is held', () => {
    const c = makeNodeDragController(fakeStore('node', true));
    const pt = fakePathTools('anchor');
    c.beginGrab([], [{ x: 100, y: 100 }]);
    const r = c.move(moveCtx({ pathTools: pt, bypass: true, clientToLocal: () => ({ x: 103, y: 103 }), clientToObjectLocal: () => ({ x: 5, y: 5 }) }));
    expect(r.snapGuides).toEqual({ x: null, y: null });
    expect(pt.drags).toEqual([{ x: 5, y: 5 }]); // raw object-local, unsnapped
  });
});

describe('makeNodeDragController — end', () => {
  it('finishes the path edit, clears guides, and resets the grab', () => {
    const c = makeNodeDragController(fakeStore('node', true));
    const pt = fakePathTools('anchor');
    c.beginGrab([], []);
    const r = c.end({ pathTools: pt });
    expect(r).toEqual({ consumed: true, clearGuides: true });
    expect(pt.ups).toBe(1);
    // grab was reset — a later move no longer consumes
    expect(c.move(moveCtx({ pathTools: pt })).consumed).toBe(false);
  });

  it('end without an active grab is not consumed', () => {
    const c = makeNodeDragController(fakeStore('node', true));
    expect(c.end({ pathTools: null })).toEqual({ consumed: false, clearGuides: false });
  });
});
