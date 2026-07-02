import { useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';
import { makePanZoomController, type PanZoomController } from '@savig/ui-core';
import { useEditor } from '../../store/store';

/** Pan (middle-button drag) + wheel-zoom for the Stage. Thin React adapter over the neutral
 *  `makePanZoomController` (slice 5): it owns the controller across renders via a lazy ref and
 *  destructures React events into the primitive args the controller takes. The Stage keeps its
 *  single window pointermove/up listeners — `beginPan` from onBackgroundPointerDown, `panMove`/
 *  `endPan` from the shared onMove/onUp. */
export function usePanZoom() {
  const ref = useRef<PanZoomController>();
  if (!ref.current) ref.current = makePanZoomController(useEditor);
  const ctrl = ref.current;

  return {
    onWheel: (e: ReactWheelEvent) => ctrl.onWheel(e.deltaY),
    beginPan: (e: ReactPointerEvent): boolean => ctrl.beginPan(e.button, e.clientX, e.clientY),
    panMove: (e: PointerEvent): boolean => ctrl.panMove(e.clientX, e.clientY),
    endPan: () => ctrl.endPan(),
  };
}
