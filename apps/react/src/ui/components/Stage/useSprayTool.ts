import { useRef, type RefObject } from 'react';
import { makeSprayToolController, type SprayToolController } from '@savig/ui-core';
import type { SprayParticle } from '@savig/engine';
import type { Point } from '@savig/interaction';
import { useEditor } from '../../store/store';

type ToLocal = (clientX: number, clientY: number) => Point | null;
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Spray brush (roadmap 12). Thin React adapter over `makeSprayToolController`: it draws the
 *  stroke's particles as dots in the Stage-owned preview group (imperatively, like the brush
 *  preview, so a stroke never re-renders the Stage); the commit lives in the controller. */
export function useSprayTool(previewRef: RefObject<SVGGElement | null>) {
  const ref = useRef<SprayToolController>();
  if (!ref.current) ref.current = makeSprayToolController(useEditor);
  const ctrl = ref.current;

  const paint = (particles: SprayParticle[]) => {
    const g = previewRef.current;
    if (!g) return;
    const { dotSize, symbolId } = useEditor.getState().spray;
    const base = symbolId ? 6 : dotSize / 2;
    while (g.firstChild) g.removeChild(g.firstChild);
    for (const p of particles) {
      const c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('cx', String(p.x));
      c.setAttribute('cy', String(p.y));
      c.setAttribute('r', String(Math.max(1, base * p.scale)));
      g.appendChild(c);
    }
    g.setAttribute('visibility', 'visible');
  };

  return {
    begin: (start: Point) => paint(ctrl.begin(start)),
    move: (e: PointerEvent, toLocal: ToLocal): boolean => {
      const r = ctrl.move(() => toLocal(e.clientX, e.clientY));
      if (r.particles) paint(r.particles);
      return r.consumed;
    },
    end: (): boolean => {
      const r = ctrl.end();
      const g = previewRef.current;
      if (r.consumed && g) {
        while (g.firstChild) g.removeChild(g.firstChild);
        g.setAttribute('visibility', 'hidden');
      }
      return r.consumed;
    },
  };
}
