import { useRef, type RefObject } from 'react';
import { pathToD } from '@savig/engine';
import { useEditor } from '../../store/store';
import { rectFromDrag, primitivePathFromDrag, primitiveSpecFromDrag, type Point } from '@savig/interaction';

const MIN_DRAW_SIZE = 3;

type ToLocal = (clientX: number, clientY: number) => Point | null;

/** Drag-to-create for the rect/ellipse/polygon/star/line tools. Extracted from Stage.tsx (no
 *  behavior change). Owns its own drag ref; draws the live preview into the rect/path overlay
 *  elements owned by the Stage (passed in), and commits the shape on pointerup. `move`/`end`
 *  return true when a draw is in progress so the shared onMove/onUp short-circuit, mirroring the
 *  prior inline `return`s. */
export function useDrawTool(
  previewRef: RefObject<SVGRectElement | null>,
  primitivePreviewRef: RefObject<SVGPathElement | null>,
) {
  const drawRef = useRef<{ start: Point; end: Point | null } | null>(null);

  const begin = (start: Point) => {
    drawRef.current = { start, end: null };
  };

  const move = (e: PointerEvent, toLocal: ToLocal): boolean => {
    const draw = drawRef.current;
    if (!draw) return false;
    const cur = toLocal(e.clientX, e.clientY);
    if (cur) {
      draw.end = cur;
      const tool = useEditor.getState().activeTool;
      if (tool === 'rect' || tool === 'ellipse') {
        const rect = previewRef.current;
        if (rect) {
          rect.setAttribute('x', String(Math.min(draw.start.x, cur.x)));
          rect.setAttribute('y', String(Math.min(draw.start.y, cur.y)));
          rect.setAttribute('width', String(Math.abs(cur.x - draw.start.x)));
          rect.setAttribute('height', String(Math.abs(cur.y - draw.start.y)));
          rect.setAttribute('visibility', 'visible');
        }
      } else {
        const st = useEditor.getState();
        const path = primitivePathFromDrag(
          tool as 'polygon' | 'star' | 'line',
          draw.start,
          cur,
          { polygonSides: st.polygonSides, starPoints: st.starPoints, starInnerRatio: st.starInnerRatio, cornerRadius: st.primitiveCornerRadius },
          MIN_DRAW_SIZE,
        );
        const el = primitivePreviewRef.current;
        if (el) {
          if (path) {
            el.setAttribute('d', pathToD(path));
            el.setAttribute('visibility', 'visible');
          } else {
            el.setAttribute('visibility', 'hidden');
          }
        }
      }
    }
    return true;
  };

  const end = (): boolean => {
    const draw = drawRef.current;
    if (!draw) return false;
    drawRef.current = null;
    if (previewRef.current) previewRef.current.setAttribute('visibility', 'hidden');
    if (primitivePreviewRef.current) primitivePreviewRef.current.setAttribute('visibility', 'hidden');
    const s = useEditor.getState();
    if (draw.end && (s.activeTool === 'rect' || s.activeTool === 'ellipse')) {
      const bounds = rectFromDrag(draw.start, draw.end, MIN_DRAW_SIZE);
      if (bounds) s.addVectorShape(s.activeTool, bounds);
    } else if (draw.end && (s.activeTool === 'polygon' || s.activeTool === 'star')) {
      // Polygon/star stamp a PARAMETRIC primitive (re-editable in the Inspector).
      const spec = primitiveSpecFromDrag(
        s.activeTool,
        draw.start,
        draw.end,
        { polygonSides: s.polygonSides, starPoints: s.starPoints, starInnerRatio: s.starInnerRatio, cornerRadius: s.primitiveCornerRadius },
        MIN_DRAW_SIZE,
      );
      if (spec) s.addPrimitive(spec);
    } else if (draw.end && s.activeTool === 'line') {
      const path = primitivePathFromDrag(
        'line',
        draw.start,
        draw.end,
        { polygonSides: s.polygonSides, starPoints: s.starPoints, starInnerRatio: s.starInnerRatio, cornerRadius: s.primitiveCornerRadius },
        MIN_DRAW_SIZE,
      );
      if (path) s.addVectorPath(path);
    }
    return true;
  };

  return { begin, move, end };
}
