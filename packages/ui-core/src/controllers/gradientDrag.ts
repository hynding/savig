// Framework-neutral on-canvas gradient-handle drag controller (slice 5, group B). Extracted from
// `Stage/useGradientDrag.ts`. The store is INJECTED (W2); the drag lives in a closure. The
// pointer→gradient-space mapping uses the handle group's SVG CTM, which is DOM-bound, so it stays
// in the app adapter and is injected as a lazy `getLocal` thunk (`null` = CTM unavailable — the
// original still consumes the event in that case). The live preview was React state
// (`setDragState`); the controller now RETURNS a `dragState` descriptor (W5) the adapter pushes
// into its own state. Commits via `setVectorGradient` on release, skipping a no-op drag.
import { applyGradientHandleDrag } from '@savig/engine';
import type { Gradient, GradientHandleId, LocalRect } from '@savig/engine';
import type { ControllerStore } from './store';
import type { GetPoint } from './coords';

export interface GradientDragState {
  property: 'fill' | 'stroke';
  gradient: Gradient;
}

export interface GradientMoveResult {
  consumed: boolean;
  /** Present only when the preview changed this move; absent = leave the adapter's state as-is. */
  dragState?: GradientDragState;
}

export function makeGradientDragController(store: ControllerStore) {
  let gd: {
    id: GradientHandleId;
    property: 'fill' | 'stroke';
    bbox: LocalRect;
    start: Gradient;
    current: Gradient;
  } | null = null;

  return {
    begin(id: GradientHandleId, property: 'fill' | 'stroke', bbox: LocalRect, gradient: Gradient): void {
      gd = { id, property, bbox, start: gradient, current: gradient };
    },

    move(getLocal: GetPoint): GradientMoveResult {
      if (!gd) return { consumed: false };
      const local = getLocal();
      if (!local) return { consumed: true }; // drag active — consume even if the CTM is unavailable
      const next = applyGradientHandleDrag(gd.start, gd.id, { x: local.x, y: local.y }, gd.bbox);
      gd.current = next;
      return { consumed: true, dragState: { property: gd.property, gradient: next } };
    },

    end(): { consumed: boolean } {
      if (!gd) return { consumed: false };
      const cur = gd;
      gd = null;
      // applyGradientHandleDrag returns a fresh object on every move, so current === start means no
      // drag happened -> skip the no-op commit.
      if (cur.current !== cur.start) {
        store.getState().setVectorGradient(cur.property, cur.current);
      }
      return { consumed: true };
    },
  };
}

export type GradientDragController = ReturnType<typeof makeGradientDragController>;
