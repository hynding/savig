import { useRef, type RefObject } from 'react';
import { useEditor } from '../../store/store';
import { computeSnap, snapToVertices, SNAP_PX, type AABB } from '@savig/interaction';

/** The subset of usePathTools' return the node-drag needs. */
interface NodePathTools {
  grab: { kind: string } | null | undefined;
  onNodeDrag: (p: { x: number; y: number }) => void;
  onNodePointerUp: () => void;
}

/** Stage-runtime values the node-anchor snap needs, captured where the global pointer effect is
 *  registered (so `zoom`'s mount value matches the prior inline branch). */
export interface NodeDragCtx {
  clientToLocal: (clientX: number, clientY: number) => { x: number; y: number } | null;
  clientToObjectLocal: (clientX: number, clientY: number) => { x: number; y: number } | null;
  stageToObjectLocal: (sx: number, sy: number) => { x: number; y: number } | null;
  setSnapGuides: (g: { x: number | null; y: number | null }) => void;
  zoom: number;
  pathToolsRef: RefObject<NodePathTools>;
}

/** Node-tool anchor dragging with snapping (to other paths' vertices, then object edges/centers +
 *  the artboard). Extracted from Stage.tsx (no behavior change). Owns the grab flag + the snap-target
 *  refs; the path-edit state machine itself stays in usePathTools. The grab starts in Stage's
 *  onBackgroundPointerDown (which calls beginGrab with the computed targets/vertices); move/end are
 *  delegated from the shared onMove/onUp and self-gate on the node tool + an active grab. */
export function useNodeDrag() {
  const grabRef = useRef(false);
  const snapRef = useRef<AABB[] | null>(null); // snap targets for the active node-anchor drag
  const vertexRef = useRef<{ x: number; y: number }[] | null>(null); // other paths' vertices (content coords)

  const beginGrab = (targets: AABB[], vertices: { x: number; y: number }[]) => {
    grabRef.current = true;
    snapRef.current = targets;
    vertexRef.current = vertices;
  };

  const active = () => useEditor.getState().activeTool === 'node' && grabRef.current;

  const move = (e: PointerEvent, ctx: NodeDragCtx): boolean => {
    if (!active()) return false;
    const local = ctx.clientToObjectLocal(e.clientX, e.clientY);
    if (local) {
      let nx = local.x;
      let ny = local.y;
      // Snap a dragged ANCHOR to other objects' edges/centers + the artboard. Targets are
      // stage-space, so snap the node's STAGE position then convert back to object-local (the
      // overlay CTM handles rotation/scale — no rotation gate needed for a point snap). Bezier
      // control HANDLES are never snapped.
      const snapActive = useEditor.getState().snapEnabled && !(e.metaKey || e.ctrlKey);
      const isAnchor = ctx.pathToolsRef.current?.grab?.kind === 'anchor';
      const stage = ctx.clientToLocal(e.clientX, e.clientY);
      if (isAnchor && snapActive && stage) {
        const thr = SNAP_PX / ctx.zoom;
        // Priority: snap onto another path's VERTEX (a 2D point → pins both axes, crosshair
        // guide), else fall back to the edge/center + artboard AABB snap.
        const vtx = vertexRef.current?.length ? snapToVertices(stage, vertexRef.current, thr) : null;
        if (vtx) {
          const back = ctx.stageToObjectLocal(vtx.x, vtx.y);
          if (back) {
            nx = back.x;
            ny = back.y;
          }
          ctx.setSnapGuides({ x: vtx.x, y: vtx.y });
        } else if (snapRef.current) {
          const r = computeSnap({ minX: stage.x, maxX: stage.x, minY: stage.y, maxY: stage.y }, snapRef.current, thr);
          if (r.guideX !== null || r.guideY !== null) {
            const back = ctx.stageToObjectLocal(stage.x + r.dx, stage.y + r.dy);
            if (back) {
              nx = back.x;
              ny = back.y;
            }
          }
          ctx.setSnapGuides({ x: r.guideX, y: r.guideY });
        } else {
          ctx.setSnapGuides({ x: null, y: null });
        }
      } else {
        ctx.setSnapGuides({ x: null, y: null });
      }
      ctx.pathToolsRef.current?.onNodeDrag({ x: nx, y: ny });
    }
    return true;
  };

  const end = (ctx: Pick<NodeDragCtx, 'setSnapGuides' | 'pathToolsRef'>): boolean => {
    if (!active()) return false;
    ctx.pathToolsRef.current?.onNodePointerUp();
    grabRef.current = false;
    snapRef.current = null;
    vertexRef.current = null;
    ctx.setSnapGuides({ x: null, y: null }); // clear node-snap guides
    return true;
  };

  return { beginGrab, move, end };
}
