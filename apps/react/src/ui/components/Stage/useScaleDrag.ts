import { useRef, type RefObject } from 'react';
import {
  makeScaleDragController,
  type ResizeCoords,
  type ScaleDragController,
  type ScaleGroupSnapshot,
  type ScaleSnapshot,
  type ResizeSnapshot,
} from '@savig/ui-core';
import type { HandleId, AABB } from '@savig/interaction';
import { useEditor } from '../../store/store';
import { applyTransformPreview, type PreviewClosures } from './applyTransformPreview';

/** Stage-runtime ports the scale/resize previews need (unchanged shape from Stage's scaleCtx). */
export interface ScaleDragCtx extends PreviewClosures {
  zoom: number;
  clientToLocal: (clientX: number, clientY: number) => { x: number; y: number } | null;
  setSnapGuides: (g: { x: number | null; y: number | null }) => void;
  contentRef: RefObject<SVGGElement | null>;
  handleGroupRef: RefObject<SVGGElement | null>;
  scaleGroupRef: RefObject<SVGGElement | null>;
}

/** Build the stage↔object-local round-trip the resize snap needs from the handle-group + content
 *  SVG CTMs (the DOM/CTM part that stays in the adapter). Returns null when the handle group's CTM
 *  is unavailable (drag still consumes but does nothing), mirroring the original's early return.
 *  One `matrixTransform` per hop — jsdom's result isn't chainable. */
function buildResizeCoords(e: PointerEvent, ctx: ScaleDragCtx): ResizeCoords | null {
  const group = ctx.handleGroupRef.current;
  const ctm = group?.getScreenCTM();
  const svg = group?.ownerSVGElement;
  if (!group || !ctm || !svg) return null;
  const ptn = svg.createSVGPoint();
  ptn.x = e.clientX;
  ptn.y = e.clientY;
  const local = ptn.matrixTransform(ctm.inverse());
  const cg = ctx.contentRef.current;
  const cctm = cg?.getScreenCTM();
  const ctmInv = ctm.inverse();
  const cctmInv = cctm?.inverse();
  const xform = (m: DOMMatrix, x: number, y: number) => {
    const p = svg.createSVGPoint();
    p.x = x;
    p.y = y;
    const q = p.matrixTransform(m);
    return { x: q.x, y: q.y };
  };
  // Only invoked by the controller when hasContentCtm is true, so cctm/cctmInv are non-null there.
  const toStage = (x: number, y: number) => {
    const s2 = xform(ctm, x, y);
    return xform(cctmInv as DOMMatrix, s2.x, s2.y);
  };
  const toLocal = (x: number, y: number) => {
    const s2 = xform(cctm as DOMMatrix, x, y);
    return xform(ctmInv, s2.x, s2.y);
  };
  return { localX: local.x, localY: local.y, toStage, toLocal, hasContentCtm: !!cctm };
}

/** Scale-handle dragging — single object, multi-selection group scale, and rect/ellipse resize.
 *  Thin React adapter over the neutral `makeScaleDragController` (slice 5): it binds `clientToLocal`
 *  lazily, builds the resize CTM round-trip, and applies the preview descriptor (node/container
 *  transforms via applyTransformPreview, the single-scale overlay transform, the resize geometry
 *  attrs, and snap guides). move/end return true while a scale/resize is in progress. */
export function useScaleDrag() {
  const ref = useRef<ScaleDragController>();
  if (!ref.current) ref.current = makeScaleDragController(useEditor);
  const ctrl = ref.current;

  return {
    beginGroup: (snapshot: ScaleGroupSnapshot) => ctrl.beginGroup(snapshot),
    beginScale: (s: { snapshot: ScaleSnapshot; targets: AABB[] }) => ctrl.beginScale(s),
    beginResize: (s: { handle: HandleId; snapshot: ResizeSnapshot; targets: AABB[] }) => ctrl.beginResize(s),
    move: (e: PointerEvent, ctx: ScaleDragCtx): boolean => {
      const r = ctrl.move({
        clientToLocal: () => ctx.clientToLocal(e.clientX, e.clientY),
        resizeCoords: () => buildResizeCoords(e, ctx),
        zoom: ctx.zoom,
        bypass: e.metaKey || e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
      });
      if (r.preview) {
        applyTransformPreview(r.preview.nodeTransforms, r.preview.containerPreviews, ctx);
        if (r.preview.scaleGroupTransform !== undefined) {
          ctx.scaleGroupRef.current?.setAttribute('transform', r.preview.scaleGroupTransform);
        }
        if (r.preview.geometry) {
          const shape = ctx.nodes.get(r.preview.geometry.objId)?.firstElementChild;
          if (shape) {
            for (const [a, v] of Object.entries(r.preview.geometry.attrs)) shape.setAttribute(a, v);
          }
        }
        ctx.setSnapGuides(r.preview.snapGuides);
      }
      return r.consumed;
    },
    end: (ctx: Pick<ScaleDragCtx, 'setSnapGuides'>): boolean => {
      const r = ctrl.end();
      if (r.consumed) ctx.setSnapGuides({ x: null, y: null });
      return r.consumed;
    },
  };
}
