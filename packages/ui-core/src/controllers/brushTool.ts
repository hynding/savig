// Framework-neutral freehand-brush controller (slice 5, group B). Extracted from
// `Stage/useBrushTool.ts`. The store is INJECTED (W2); the point buffer lives in a closure.
// Instead of writing the live polyline into the Stage's brush-preview path via `setAttribute`
// (W5), `move` RETURNS the preview `d` string (or `null` = no update this move); `end` commits the
// smoothed stroke through the store and tells the adapter to hide the overlay. Coordinate
// conversion is the shared lazy thunk (called only after the active guard).
import {
  brushParams,
  buildBrushWidthFn,
  outlineStroke,
  pathToD,
  pressureLookup,
  strokeToPath,
} from '@savig/engine';
import type { Point } from '@savig/interaction';
import type { ControllerStore } from './store';
import type { GetPoint } from './coords';

export interface BrushMoveResult {
  consumed: boolean;
  /** The raw in-progress polyline to paint, or `null` to leave the overlay untouched this move. */
  d: string | null;
}

// Committed fill color for the taper/pressure outline branch — the same value
// `addVectorPath`'s default style (`PATH_DEFAULT_STYLE.stroke`, editor-state's store-internals)
// paints a plain brush stroke with, so a tapered stroke reads as the same "ink" color.
const BRUSH_INK_COLOR = '#000000';

const DEFAULT_PRESSURE = 0.5;

export function makeBrushToolController(store: ControllerStore) {
  let points: Point[] | null = null;
  let pressures: number[] | null = null;

  return {
    begin(start: Point, pressure: number = DEFAULT_PRESSURE): void {
      points = [start];
      pressures = [pressure];
    },

    move(getPoint: GetPoint, pressure: number = DEFAULT_PRESSURE): BrushMoveResult {
      if (!points) return { consumed: false, d: null };
      const cur = getPoint();
      if (!cur) return { consumed: true, d: null }; // active stroke, no valid point — leave overlay as-is
      points.push(cur);
      pressures?.push(pressure); // index-aligned with `points` (raw, pre-simplify samples)
      // raw in-progress polyline (cheap); the committed path is the smoothed strokeToPath.
      return { consumed: true, d: pathToD({ nodes: points.map((p) => ({ anchor: p })), closed: false }) };
    },

    end(): { consumed: boolean } {
      if (!points) return { consumed: false };
      const pts = points;
      const press = pressures ?? [];
      points = null;
      pressures = null;
      const s = store.getState();
      const path = strokeToPath(pts, brushParams(s.brushSmoothing));
      if (path.nodes.length >= 2) {
        const { brushTaperIn: taperIn, brushTaperOut: taperOut, brushUsePressure: usePressure } = s;
        if (taperIn === 0 && taperOut === 0 && !usePressure) {
          // Profile inactive (every field at its default): byte-identical to the pre-task-3
          // commit path — a plain constant-width stroke via addVectorPath.
          s.addVectorPath(path, { strokeWidth: s.brushSize, strokeLinecap: 'round', strokeLinejoin: 'round' });
        } else {
          // Profile active: bake the variable-width stroke into a filled outline (rings) and
          // commit those directly — no stroke-width concept survives on the committed asset.
          const widthFn = buildBrushWidthFn({
            size: s.brushSize,
            taperIn,
            taperOut,
            pressureAtT: usePressure ? pressureLookup(pts, press) : undefined,
          });
          const rings = outlineStroke(path, widthFn, 'round', 'round');
          s.addVectorOutline(rings, { fill: BRUSH_INK_COLOR, stroke: 'none', strokeWidth: 0 });
        }
      }
      return { consumed: true };
    },
  };
}

export type BrushToolController = ReturnType<typeof makeBrushToolController>;
