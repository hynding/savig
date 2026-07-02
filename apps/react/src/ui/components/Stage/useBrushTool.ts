import { useRef, type RefObject } from 'react';
import { brushParams, pathToD, strokeToPath } from '@savig/engine';
import { useEditor } from '../../store/store';
import type { Point } from '@savig/interaction';

type ToLocal = (clientX: number, clientY: number) => Point | null;

/** Freehand brush: collect pointer samples into a live polyline preview, then commit the
 *  smoothed strokeToPath on pointerup. Extracted from Stage.tsx (no behavior change). Owns its
 *  own point buffer; draws into the brush-preview path element owned by the Stage (passed in).
 *  `move`/`end` return true while a stroke is in progress so the shared onMove/onUp short-circuit. */
export function useBrushTool(brushPreviewRef: RefObject<SVGPathElement | null>) {
  const brushRef = useRef<{ points: Point[] } | null>(null);

  const begin = (start: Point) => {
    brushRef.current = { points: [start] };
  };

  const move = (e: PointerEvent, toLocal: ToLocal): boolean => {
    const brush = brushRef.current;
    if (!brush) return false;
    const cur = toLocal(e.clientX, e.clientY);
    if (cur) {
      brush.points.push(cur);
      const el = brushPreviewRef.current;
      if (el) {
        // raw in-progress polyline (cheap); the committed path is the smoothed strokeToPath
        el.setAttribute('d', pathToD({ nodes: brush.points.map((p) => ({ anchor: p })), closed: false }));
        el.setAttribute('visibility', 'visible');
      }
    }
    return true;
  };

  const end = (): boolean => {
    const brush = brushRef.current;
    if (!brush) return false;
    brushRef.current = null;
    if (brushPreviewRef.current) brushPreviewRef.current.setAttribute('visibility', 'hidden');
    const s = useEditor.getState();
    const path = strokeToPath(brush.points, brushParams(s.brushSmoothing));
    if (path.nodes.length >= 2) {
      s.addVectorPath(path, { strokeWidth: s.brushSize, strokeLinecap: 'round', strokeLinejoin: 'round' });
    }
    return true;
  };

  return { begin, move, end };
}
