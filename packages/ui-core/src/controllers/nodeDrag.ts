// Framework-neutral node-tool anchor-drag controller with snapping (slice 5, group B). Extracted
// from `Stage/useNodeDrag.ts`. The store is INJECTED (W2); the grab flag + snap targets live in a
// closure. The path-edit itself stays in the pen/node state machine (`usePathTools`), injected
// here as a neutral `NodePathTools` port so the controller calls `onNodeDrag`/`onNodePointerUp`
// directly. The three client→local coordinate conversions are DOM/CTM-bound and stay in the app
// adapter, injected as lazy accessors bound over the current pointer event; the controller invokes
// them only after the node-tool + active-grab gate (matching the original's `if (!active()) return`
// before any conversion). The snap-guide overlay was React state (`setSnapGuides`); the controller
// now RETURNS the guide descriptor (W5) the adapter pushes into its own state.
import { computeSnap, snapToVertices, SNAP_PX, type AABB } from '@savig/interaction';
import type { ControllerStore } from './store';
import type { Point } from './coords';

/** The subset of `usePathTools`' return the node-drag delegates to. Neutral (plain data + fns). */
export interface NodePathTools {
  grab: { kind: string } | null | undefined;
  onNodeDrag: (p: Point) => void;
  onNodePointerUp: () => void;
}

/** Per-move ports the adapter binds over the live pointer event (its CTM does the conversion). */
export interface NodeDragMoveCtx {
  clientToLocal: () => Point | null; // stage-local
  clientToObjectLocal: () => Point | null; // object-local (the dragged anchor's frame)
  stageToObjectLocal: (sx: number, sy: number) => Point | null;
  pathTools: NodePathTools | null;
  zoom: number;
  /** metaKey || ctrlKey held — bypasses snapping for this move. */
  bypass: boolean;
}

export interface NodeMoveResult {
  consumed: boolean;
  /** Present only when the drag ran (a valid object-local point) — the snap-guide crosshair to
   *  show (`{ x: null, y: null }` clears it). Absent = leave the adapter's guides untouched. */
  snapGuides?: { x: number | null; y: number | null };
}

export function makeNodeDragController(store: ControllerStore) {
  let grab = false;
  let snapTargets: AABB[] | null = null; // snap targets for the active node-anchor drag
  let vertices: Point[] | null = null; // other paths' vertices (content coords)

  const active = () => store.getState().activeTool === 'node' && grab;

  return {
    beginGrab(targets: AABB[], verts: Point[]): void {
      grab = true;
      snapTargets = targets;
      vertices = verts;
    },

    move(ctx: NodeDragMoveCtx): NodeMoveResult {
      if (!active()) return { consumed: false };
      const local = ctx.clientToObjectLocal();
      if (!local) return { consumed: true }; // no valid object-local point this move; still consume
      let nx = local.x;
      let ny = local.y;
      // Snap a dragged ANCHOR to other objects' edges/centers + the artboard. Targets are
      // stage-space, so snap the node's STAGE position then convert back to object-local (the
      // overlay CTM handles rotation/scale — no rotation gate needed for a point snap). Bezier
      // control HANDLES are never snapped.
      const snapActive = store.getState().snapEnabled && !ctx.bypass;
      const isAnchor = ctx.pathTools?.grab?.kind === 'anchor';
      const stage = ctx.clientToLocal();
      let guides: { x: number | null; y: number | null } = { x: null, y: null };
      if (isAnchor && snapActive && stage) {
        const thr = SNAP_PX / ctx.zoom;
        // Priority: snap onto another path's VERTEX (a 2D point → pins both axes, crosshair
        // guide), else fall back to the edge/center + artboard AABB snap.
        const vtx = vertices?.length ? snapToVertices(stage, vertices, thr) : null;
        if (vtx) {
          const back = ctx.stageToObjectLocal(vtx.x, vtx.y);
          if (back) {
            nx = back.x;
            ny = back.y;
          }
          guides = { x: vtx.x, y: vtx.y };
        } else if (snapTargets) {
          const r = computeSnap({ minX: stage.x, maxX: stage.x, minY: stage.y, maxY: stage.y }, snapTargets, thr);
          if (r.guideX !== null || r.guideY !== null) {
            const back = ctx.stageToObjectLocal(stage.x + r.dx, stage.y + r.dy);
            if (back) {
              nx = back.x;
              ny = back.y;
            }
          }
          guides = { x: r.guideX, y: r.guideY };
        }
      }
      ctx.pathTools?.onNodeDrag({ x: nx, y: ny });
      return { consumed: true, snapGuides: guides };
    },

    end(ctx: { pathTools: NodePathTools | null }): { consumed: boolean; clearGuides: boolean } {
      if (!active()) return { consumed: false, clearGuides: false };
      ctx.pathTools?.onNodePointerUp();
      grab = false;
      snapTargets = null;
      vertices = null;
      return { consumed: true, clearGuides: true }; // adapter clears node-snap guides
    },
  };
}

export type NodeDragController = ReturnType<typeof makeNodeDragController>;
