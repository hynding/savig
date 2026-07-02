import { useRef, type RefObject } from 'react';
import { makeDrawToolController, type DrawPreview, type DrawToolController } from '@savig/ui-core';
import type { Point } from '@savig/interaction';
import { useEditor } from '../../store/store';

type ToLocal = (clientX: number, clientY: number) => Point | null;

/** Apply the controller's preview descriptor to the Stage's overlay elements (the DOM part the
 *  neutral controller can't do). */
function applyPreview(
  preview: DrawPreview,
  previewRef: RefObject<SVGRectElement | null>,
  primitivePreviewRef: RefObject<SVGPathElement | null>,
) {
  if (preview.target === 'rect') {
    const rect = previewRef.current;
    if (rect) {
      rect.setAttribute('x', String(preview.x));
      rect.setAttribute('y', String(preview.y));
      rect.setAttribute('width', String(preview.width));
      rect.setAttribute('height', String(preview.height));
      rect.setAttribute('visibility', 'visible');
    }
  } else {
    const el = primitivePreviewRef.current;
    if (el) {
      if (preview.d !== null) {
        el.setAttribute('d', preview.d);
        el.setAttribute('visibility', 'visible');
      } else {
        el.setAttribute('visibility', 'hidden');
      }
    }
  }
}

/** Drag-to-create for the rect/ellipse/polygon/star/line tools. Thin React adapter over the
 *  neutral `makeDrawToolController` (slice 5): it owns the two Stage-owned overlay elements and
 *  paints the preview descriptor the controller returns; `move`/`end` return true while a draw is
 *  in progress so the shared onMove/onUp short-circuit. */
export function useDrawTool(
  previewRef: RefObject<SVGRectElement | null>,
  primitivePreviewRef: RefObject<SVGPathElement | null>,
) {
  const ref = useRef<DrawToolController>();
  if (!ref.current) ref.current = makeDrawToolController(useEditor);
  const ctrl = ref.current;

  return {
    begin: (start: Point) => ctrl.begin(start),
    move: (e: PointerEvent, toLocal: ToLocal): boolean => {
      const r = ctrl.move(() => toLocal(e.clientX, e.clientY));
      if (r.preview) applyPreview(r.preview, previewRef, primitivePreviewRef);
      return r.consumed;
    },
    end: (): boolean => {
      const r = ctrl.end();
      if (r.consumed) {
        if (previewRef.current) previewRef.current.setAttribute('visibility', 'hidden');
        if (primitivePreviewRef.current) primitivePreviewRef.current.setAttribute('visibility', 'hidden');
      }
      return r.consumed;
    },
  };
}
