import { useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';
import { useEditor } from '../../store/store';

/** Pan (middle-button drag) + wheel-zoom for the Stage. Extracted from Stage.tsx (no behavior
 *  change). Owns its own panRef and exposes a delegation API so the Stage keeps its single
 *  window pointermove/up listeners — `beginPan` from onBackgroundPointerDown, `panMove`/`endPan`
 *  called from the shared onMove/onUp. Pan is mutually exclusive with the other drags (it only
 *  starts on a middle-button press over the background), so the call position in onMove is
 *  immaterial. */
export function usePanZoom() {
  const panRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const onWheel = (e: ReactWheelEvent) => {
    const s = useEditor.getState();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    s.setZoom(s.zoom * factor);
  };

  /** Start a pan on a middle-button press. Returns true if a pan began (caller should return). */
  const beginPan = (e: ReactPointerEvent): boolean => {
    if (e.button !== 1) return false;
    const s = useEditor.getState();
    panRef.current = { x: e.clientX, y: e.clientY, panX: s.pan.x, panY: s.pan.y };
    return true;
  };

  /** Handle a window pointermove while panning. Returns true if it consumed the event. */
  const panMove = (e: PointerEvent): boolean => {
    const p = panRef.current;
    if (!p) return false;
    useEditor.getState().setPan({ x: p.panX + (e.clientX - p.x), y: p.panY + (e.clientY - p.y) });
    return true;
  };

  /** Clear any in-progress pan (pointerup). */
  const endPan = () => {
    panRef.current = null;
  };

  return { onWheel, beginPan, panMove, endPan };
}
