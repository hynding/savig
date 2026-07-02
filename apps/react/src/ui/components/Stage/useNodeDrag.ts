import { useRef, type RefObject } from 'react';
import { makeNodeDragController, type NodeDragController, type NodePathTools } from '@savig/ui-core';
import type { AABB } from '@savig/interaction';
import { useEditor } from '../../store/store';

export type { NodePathTools };

/** Stage-runtime ports the node-anchor snap needs, threaded from Stage.tsx (unchanged shape): the
 *  three client→local coordinate converters (CTM-based), the snap-guide setter, the mount-captured
 *  zoom, and the pathTools ref the node-drag delegates the edit to. */
export interface NodeDragCtx {
  clientToLocal: (clientX: number, clientY: number) => { x: number; y: number } | null;
  clientToObjectLocal: (clientX: number, clientY: number) => { x: number; y: number } | null;
  stageToObjectLocal: (sx: number, sy: number) => { x: number; y: number } | null;
  setSnapGuides: (g: { x: number | null; y: number | null }) => void;
  zoom: number;
  pathToolsRef: RefObject<NodePathTools>;
}

/** Node-tool anchor dragging with snapping. Thin React adapter over the neutral
 *  `makeNodeDragController` (slice 5): it binds the Stage's CTM coordinate converters over the
 *  live pointer event, passes the current pathTools handle as the edit port, and pushes the
 *  snap-guide descriptor the controller returns into React state. move/end self-gate on the node
 *  tool + an active grab and return true when they consumed the event. */
export function useNodeDrag() {
  const ref = useRef<NodeDragController>();
  if (!ref.current) ref.current = makeNodeDragController(useEditor);
  const ctrl = ref.current;

  return {
    beginGrab: (targets: AABB[], vertices: { x: number; y: number }[]) => ctrl.beginGrab(targets, vertices),
    move: (e: PointerEvent, ctx: NodeDragCtx): boolean => {
      const r = ctrl.move({
        clientToLocal: () => ctx.clientToLocal(e.clientX, e.clientY),
        clientToObjectLocal: () => ctx.clientToObjectLocal(e.clientX, e.clientY),
        stageToObjectLocal: ctx.stageToObjectLocal,
        pathTools: ctx.pathToolsRef.current,
        zoom: ctx.zoom,
        bypass: e.metaKey || e.ctrlKey,
      });
      if (r.snapGuides) ctx.setSnapGuides(r.snapGuides);
      return r.consumed;
    },
    end: (ctx: Pick<NodeDragCtx, 'setSnapGuides' | 'pathToolsRef'>): boolean => {
      const r = ctrl.end({ pathTools: ctx.pathToolsRef.current });
      if (r.clearGuides) ctx.setSnapGuides({ x: null, y: null });
      return r.consumed;
    },
  };
}
