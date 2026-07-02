// Framework-neutral drag-to-create controller for the rect/ellipse/polygon/star/line tools
// (slice 5, group B). Extracted from `Stage/useDrawTool.ts`. The store is INJECTED (W2); the
// in-progress drag lives in a closure. Instead of writing the live preview into the Stage's rect/
// path overlay elements via `setAttribute` (W5), `move` RETURNS a preview descriptor the adapter
// applies to the right overlay; `end` commits the shape through the store and tells the adapter to
// hide the overlays. Coordinate conversion is the shared lazy thunk (called only after the active
// guard, matching the original's `if (!draw) return` before `toLocal`).
import { pathToD } from '@savig/engine';
import { primitivePathFromDrag, primitiveSpecFromDrag, rectFromDrag, type Point } from '@savig/interaction';
import type { ControllerStore } from './store';
import type { GetPoint } from './coords';

const MIN_DRAW_SIZE = 3;

/** What the adapter should paint this move (or `null` = leave the overlays untouched):
 *  - `rect`: show the rect overlay at these bounds (the rect/ellipse tools).
 *  - `primitive`: set the primitive path overlay's `d` (or hide it when `d` is `null`). */
export type DrawPreview =
  | { target: 'rect'; x: number; y: number; width: number; height: number }
  | { target: 'primitive'; d: string | null };

export interface DrawMoveResult {
  consumed: boolean;
  preview: DrawPreview | null;
}

export function makeDrawToolController(store: ControllerStore) {
  let draw: { start: Point; end: Point | null } | null = null;

  return {
    begin(start: Point): void {
      draw = { start, end: null };
    },

    move(getPoint: GetPoint): DrawMoveResult {
      if (!draw) return { consumed: false, preview: null };
      const cur = getPoint();
      if (!cur) return { consumed: true, preview: null }; // active draw, no valid point — leave overlays as-is
      draw.end = cur;
      const st = store.getState();
      const tool = st.activeTool;
      if (tool === 'rect' || tool === 'ellipse') {
        return {
          consumed: true,
          preview: {
            target: 'rect',
            x: Math.min(draw.start.x, cur.x),
            y: Math.min(draw.start.y, cur.y),
            width: Math.abs(cur.x - draw.start.x),
            height: Math.abs(cur.y - draw.start.y),
          },
        };
      }
      const path = primitivePathFromDrag(
        tool as 'polygon' | 'star' | 'line',
        draw.start,
        cur,
        { polygonSides: st.polygonSides, starPoints: st.starPoints, starInnerRatio: st.starInnerRatio, cornerRadius: st.primitiveCornerRadius },
        MIN_DRAW_SIZE,
      );
      return { consumed: true, preview: { target: 'primitive', d: path ? pathToD(path) : null } };
    },

    end(): { consumed: boolean } {
      if (!draw) return { consumed: false };
      const d = draw;
      draw = null;
      const s = store.getState();
      if (d.end && (s.activeTool === 'rect' || s.activeTool === 'ellipse')) {
        const bounds = rectFromDrag(d.start, d.end, MIN_DRAW_SIZE);
        if (bounds) s.addVectorShape(s.activeTool, bounds);
      } else if (d.end && (s.activeTool === 'polygon' || s.activeTool === 'star')) {
        // Polygon/star stamp a PARAMETRIC primitive (re-editable in the Inspector).
        const spec = primitiveSpecFromDrag(
          s.activeTool,
          d.start,
          d.end,
          { polygonSides: s.polygonSides, starPoints: s.starPoints, starInnerRatio: s.starInnerRatio, cornerRadius: s.primitiveCornerRadius },
          MIN_DRAW_SIZE,
        );
        if (spec) s.addPrimitive(spec);
      } else if (d.end && s.activeTool === 'line') {
        const path = primitivePathFromDrag(
          'line',
          d.start,
          d.end,
          { polygonSides: s.polygonSides, starPoints: s.starPoints, starInnerRatio: s.starInnerRatio, cornerRadius: s.primitiveCornerRadius },
          MIN_DRAW_SIZE,
        );
        if (path) s.addVectorPath(path);
      }
      return { consumed: true };
    },
  };
}

export type DrawToolController = ReturnType<typeof makeDrawToolController>;
