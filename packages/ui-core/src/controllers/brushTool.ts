// Framework-neutral freehand-brush controller (slice 5, group B). Extracted from
// `Stage/useBrushTool.ts`. The store is INJECTED (W2); the point buffer lives in a closure.
// Instead of writing the live polyline into the Stage's brush-preview path via `setAttribute`
// (W5), `move` RETURNS the preview `d` string (or `null` = no update this move); `end` commits the
// smoothed stroke through the store and tells the adapter to hide the overlay. Coordinate
// conversion is the shared lazy thunk (called only after the active guard).
import { brushParams, pathToD, strokeToPath } from '@savig/engine';
import type { Point } from '@savig/interaction';
import type { ControllerStore } from './store';
import type { GetPoint } from './coords';

export interface BrushMoveResult {
  consumed: boolean;
  /** The raw in-progress polyline to paint, or `null` to leave the overlay untouched this move. */
  d: string | null;
}

export function makeBrushToolController(store: ControllerStore) {
  let points: Point[] | null = null;

  return {
    begin(start: Point): void {
      points = [start];
    },

    move(getPoint: GetPoint): BrushMoveResult {
      if (!points) return { consumed: false, d: null };
      const cur = getPoint();
      if (!cur) return { consumed: true, d: null }; // active stroke, no valid point — leave overlay as-is
      points.push(cur);
      // raw in-progress polyline (cheap); the committed path is the smoothed strokeToPath.
      return { consumed: true, d: pathToD({ nodes: points.map((p) => ({ anchor: p })), closed: false }) };
    },

    end(): { consumed: boolean } {
      if (!points) return { consumed: false };
      const pts = points;
      points = null;
      const s = store.getState();
      const path = strokeToPath(pts, brushParams(s.brushSmoothing));
      if (path.nodes.length >= 2) {
        s.addVectorPath(path, { strokeWidth: s.brushSize, strokeLinecap: 'round', strokeLinejoin: 'round' });
      }
      return { consumed: true };
    },
  };
}

export type BrushToolController = ReturnType<typeof makeBrushToolController>;
