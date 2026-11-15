import { useRef, type RefObject } from 'react';
import type { Point } from '@savig/interaction';
import { useEditor } from '../../store/store';

type ToLocal = (clientX: number, clientY: number) => Point | null;

/** Eraser drag (spec 2026-11-15-paint-bucket-eraser): collects the pointer path, shows it as a
 *  round stroke of the eraser's size in the Stage-owned preview path, and on release cuts that
 *  sweep out of the shapes under it (`eraseAlong`, one undo step). `move`/`end` return true while
 *  a drag is in progress so the shared onMove/onUp short-circuit. */
export function useEraserTool(previewRef: RefObject<SVGPathElement | null>) {
  const pts = useRef<Point[] | null>(null);
  const paint = () => {
    const el = previewRef.current;
    const p = pts.current;
    if (!el || !p || p.length === 0) return;
    const d = p.length === 1 ? `M${p[0].x} ${p[0].y}l0.01 0` : `M${p.map((q) => `${q.x} ${q.y}`).join('L')}`;
    el.setAttribute('d', d);
    el.setAttribute('stroke-width', String(useEditor.getState().eraserSize));
    el.setAttribute('visibility', 'visible');
  };
  return {
    begin: (start: Point) => {
      pts.current = [start];
      paint();
    },
    move: (e: PointerEvent, toLocal: ToLocal): boolean => {
      if (!pts.current) return false;
      const p = toLocal(e.clientX, e.clientY);
      const last = pts.current[pts.current.length - 1];
      if (p && Math.hypot(p.x - last.x, p.y - last.y) >= 1) {
        pts.current.push(p);
        paint();
      }
      return true;
    },
    end: (): boolean => {
      const p = pts.current;
      if (!p) return false;
      pts.current = null;
      previewRef.current?.setAttribute('visibility', 'hidden');
      useEditor.getState().eraseAlong(p);
      return true;
    },
  };
}
