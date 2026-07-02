import { useRef, type RefObject } from 'react';
import { makeBrushToolController, type BrushToolController } from '@savig/ui-core';
import type { Point } from '@savig/interaction';
import { useEditor } from '../../store/store';

type ToLocal = (clientX: number, clientY: number) => Point | null;

/** Freehand brush. Thin React adapter over the neutral `makeBrushToolController` (slice 5): it
 *  paints the raw in-progress polyline (`d` the controller returns) into the Stage-owned brush
 *  preview path; the smoothed stroke commit lives in the controller. `move`/`end` return true
 *  while a stroke is in progress so the shared onMove/onUp short-circuit. */
export function useBrushTool(brushPreviewRef: RefObject<SVGPathElement | null>) {
  const ref = useRef<BrushToolController>();
  if (!ref.current) ref.current = makeBrushToolController(useEditor);
  const ctrl = ref.current;

  return {
    begin: (start: Point) => ctrl.begin(start),
    move: (e: PointerEvent, toLocal: ToLocal): boolean => {
      const r = ctrl.move(() => toLocal(e.clientX, e.clientY));
      if (r.d !== null) {
        const el = brushPreviewRef.current;
        if (el) {
          el.setAttribute('d', r.d);
          el.setAttribute('visibility', 'visible');
        }
      }
      return r.consumed;
    },
    end: (): boolean => {
      const r = ctrl.end();
      if (r.consumed && brushPreviewRef.current) brushPreviewRef.current.setAttribute('visibility', 'hidden');
      return r.consumed;
    },
  };
}
