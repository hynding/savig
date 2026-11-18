import { useRef, type RefObject } from 'react';
import { makeSkewDragController, type SkewDragController, type SkewSnapshot, type RotateHud } from '@savig/ui-core';
import type { Pt } from '@savig/interaction';
import { useEditor } from '../../store/store';
import { applyTransformPreview, type PreviewClosures } from './applyTransformPreview';

/** Stage-runtime ports the skew preview needs. */
export interface SkewDragCtx extends PreviewClosures {
  clientToLocal: (clientX: number, clientY: number) => Pt | null;
  setRotateHud: (hud: RotateHud | null) => void;
  rotateHandleGroupRef: RefObject<SVGGElement | null>;
}

/** Skew-handle dragging (spec 2026-11-18-skew-distort): thin React adapter over the neutral
 *  `makeSkewDragController`. Shares the rotate overlay group (the skew handles live in it) and the
 *  angle readout. move/end return true while a skew is in progress. */
export function useSkewDrag() {
  const ref = useRef<SkewDragController>();
  if (!ref.current) ref.current = makeSkewDragController(useEditor);
  const ctrl = ref.current;
  return {
    begin: (snapshot: SkewSnapshot) => ctrl.begin(snapshot),
    move: (e: PointerEvent, ctx: SkewDragCtx): boolean => {
      const r = ctrl.move(() => ctx.clientToLocal(e.clientX, e.clientY), e.shiftKey, e.altKey);
      if (r.preview) {
        applyTransformPreview(r.preview.nodeTransforms, r.preview.containerPreviews, ctx);
        ctx.rotateHandleGroupRef.current?.setAttribute('transform', r.preview.handleTransform);
        ctx.setRotateHud(r.preview.hud);
      }
      return r.consumed;
    },
    end: (ctx: Pick<SkewDragCtx, 'setRotateHud'>): boolean => {
      const r = ctrl.end();
      if (r.consumed) ctx.setRotateHud(null);
      return r.consumed;
    },
  };
}
