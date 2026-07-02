// Framework-neutral pan + wheel-zoom controller (slice 5, group A — the L2 controller-pattern
// exemplar). Extracted verbatim from `Stage/usePanZoom.ts`: the store is INJECTED (W2, never
// imported), the in-progress pan lives in a closure variable (replacing the React `useRef`), and
// the methods take PRIMITIVE inputs (`deltaY`, `button`, `clientX/Y`) rather than React events so
// the React adapter destructures the event. Pan/zoom carry no imperative DOM preview — they flow
// through the store, so there's no descriptor to return here (contrast the drag controllers, W5).
import type { ControllerStore } from './store';

interface PanState {
  x: number;
  y: number;
  panX: number;
  panY: number;
}

export function makePanZoomController(store: ControllerStore) {
  let pan: PanState | null = null;

  return {
    /** Wheel-zoom: `deltaY < 0` zooms in (×1.1), otherwise out. */
    onWheel(deltaY: number): void {
      const s = store.getState();
      const factor = deltaY < 0 ? 1.1 : 1 / 1.1;
      s.setZoom(s.zoom * factor);
    },

    /** Start a pan on a middle-button (`button === 1`) press. Returns true if a pan began. */
    beginPan(button: number, clientX: number, clientY: number): boolean {
      if (button !== 1) return false;
      const s = store.getState();
      pan = { x: clientX, y: clientY, panX: s.pan.x, panY: s.pan.y };
      return true;
    },

    /** Handle a pointermove while panning. Returns true if it consumed the event. */
    panMove(clientX: number, clientY: number): boolean {
      if (!pan) return false;
      store.getState().setPan({ x: pan.panX + (clientX - pan.x), y: pan.panY + (clientY - pan.y) });
      return true;
    },

    /** Clear any in-progress pan (pointerup). */
    endPan(): void {
      pan = null;
    },
  };
}

export type PanZoomController = ReturnType<typeof makePanZoomController>;
