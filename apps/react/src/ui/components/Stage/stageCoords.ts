import type { Point } from './drawGeometry';

/** Coordinate-space conversions between client/screen pixels and the Stage's content or
 *  selected-object-local spaces, via live SVG CTMs. Extracted from Stage.tsx (no behavior
 *  change): a factory over the two group refs so the component keeps calling the same names.
 *  Pure aside from reading `ref.current` + the elements' CTMs at call time. */
export interface StageCoordinates {
  /** Client (screen) coords → content space, via the content group's CTM. */
  clientToLocal(clientX: number, clientY: number): Point | null;
  /** Client coords → the selected path object's LOCAL space through the node-overlay group's
   *  CTM (which carries the object transform), so node editing is rotation/scale-aware — the
   *  same technique as the resize handles. */
  clientToObjectLocal(clientX: number, clientY: number): Point | null;
  /** Stage/content coords → the selected path's object-local space (content→screen via the
   *  content CTM, then screen→local via the node-overlay CTM inverse — the reverse of how a
   *  node's local position is read). Lands a stage-snapped node back in local. One transform
   *  per hop (jsdom can't chain matrixTransform). */
  stageToObjectLocal(sx: number, sy: number): Point | null;
}

type GroupRef = { current: SVGGElement | null };

export function makeStageCoordinates(contentRef: GroupRef, overlayGroupRef: GroupRef): StageCoordinates {
  return {
    clientToLocal(clientX, clientY) {
      const g = contentRef.current;
      const ctm = g?.getScreenCTM();
      const svg = g?.ownerSVGElement;
      if (!g || !ctm || !svg) return null;
      const pt = svg.createSVGPoint();
      pt.x = clientX;
      pt.y = clientY;
      const local = pt.matrixTransform(ctm.inverse());
      return { x: local.x, y: local.y };
    },
    clientToObjectLocal(clientX, clientY) {
      const g = overlayGroupRef.current;
      const ctm = g?.getScreenCTM();
      const svg = g?.ownerSVGElement;
      if (!g || !ctm || !svg) return null;
      const pt = svg.createSVGPoint();
      pt.x = clientX;
      pt.y = clientY;
      const local = pt.matrixTransform(ctm.inverse());
      return { x: local.x, y: local.y };
    },
    stageToObjectLocal(sx, sy) {
      const og = overlayGroupRef.current;
      const cg = contentRef.current;
      const octm = og?.getScreenCTM();
      const cctm = cg?.getScreenCTM();
      const svg = cg?.ownerSVGElement;
      if (!og || !cg || !octm || !cctm || !svg) return null;
      const p = svg.createSVGPoint();
      p.x = sx;
      p.y = sy;
      const screen = p.matrixTransform(cctm);
      const p2 = svg.createSVGPoint();
      p2.x = screen.x;
      p2.y = screen.y;
      const localPt = p2.matrixTransform(octm.inverse());
      return { x: localPt.x, y: localPt.y };
    },
  };
}
