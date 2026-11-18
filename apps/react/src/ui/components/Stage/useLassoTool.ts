import { useRef, type RefObject } from 'react';
import type { Point } from '@savig/interaction';
import { useEditor } from '../../store/store';

type ToLocal = (clientX: number, clientY: number) => Point | null;

/** Close a polygon lasso by clicking within this many screen pixels of its first corner. */
const CLOSE_PX = 8;

/** Lasso (spec 2026-11-18-lasso). Freehand: drag a loop; letting go closes it. Polygon: click
 *  corners; click the first corner again (or double-click) to close, Esc to cancel. The loop shows
 *  in the Stage-owned preview path; closing hands it to `lassoSelect` (cut the looped part of the
 *  one selected drawing, else select what it touches; Shift adds). `move`/`end` return true while
 *  a loop is in progress so the shared onMove/onUp short-circuit. */
export function useLassoTool(previewRef: RefObject<SVGPathElement | null>) {
  const loop = useRef<{ pts: Point[]; cursor: Point | null; additive: boolean; polygon: boolean } | null>(null);
  const keyHandler = useRef<((e: KeyboardEvent) => void) | null>(null);

  const paint = () => {
    const el = previewRef.current;
    const l = loop.current;
    if (!el) return;
    if (!l || l.pts.length === 0) {
      el.setAttribute('visibility', 'hidden');
      return;
    }
    const pts = l.cursor ? [...l.pts, l.cursor] : l.pts;
    el.setAttribute('d', `M${pts.map((q) => `${q.x} ${q.y}`).join('L')}Z`);
    el.setAttribute('visibility', 'visible');
  };
  const stopKeys = () => {
    if (keyHandler.current) window.removeEventListener('keydown', keyHandler.current, true);
    keyHandler.current = null;
  };
  const cancel = () => {
    loop.current = null;
    stopKeys();
    paint();
  };
  const finish = () => {
    const l = loop.current;
    cancel();
    if (l && l.pts.length >= 3) useEditor.getState().lassoSelect(l.pts, l.additive);
  };

  return {
    /** A press on the Stage (background or a drawing) with the lasso tool. */
    press: (p: Point, additive: boolean) => {
      const s = useEditor.getState();
      if (s.lassoMode === 'freehand') {
        loop.current = { pts: [p], cursor: null, additive, polygon: false };
        paint();
        return;
      }
      const l = loop.current;
      if (!l) {
        loop.current = { pts: [p], cursor: null, additive, polygon: true };
        const onKey = (e: KeyboardEvent) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            cancel();
          } else if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            finish();
          }
        };
        keyHandler.current = onKey;
        window.addEventListener('keydown', onKey, true);
      } else if (l.pts.length >= 3 && Math.hypot(p.x - l.pts[0].x, p.y - l.pts[0].y) * s.zoom <= CLOSE_PX) {
        finish();
        return;
      } else {
        l.pts.push(p);
      }
      paint();
    },
    move: (e: PointerEvent, toLocal: ToLocal): boolean => {
      const l = loop.current;
      if (!l) return false;
      const p = toLocal(e.clientX, e.clientY);
      if (!p) return true;
      if (l.polygon) {
        l.cursor = p;
        paint();
        return true;
      }
      const last = l.pts[l.pts.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) >= 1) {
        l.pts.push(p);
        paint();
      }
      return true;
    },
    end: (): boolean => {
      const l = loop.current;
      if (!l) return false;
      if (!l.polygon) finish();
      return true;
    },
    /** Double-click closes a polygon lasso (its two presses added the same corner twice; the
     *  duplicate is dropped). */
    doubleClick: () => {
      const l = loop.current;
      if (!l?.polygon) return;
      // Only a real double-click (both presses on one spot) closes: two quick clicks on
      // different spots are two corners.
      const a = l.pts[l.pts.length - 1];
      const b = l.pts[l.pts.length - 2];
      if (!a || !b || Math.hypot(a.x - b.x, a.y - b.y) * useEditor.getState().zoom > 4) return;
      l.pts.pop();
      finish();
    },
    active: () => loop.current !== null,
  };
}
