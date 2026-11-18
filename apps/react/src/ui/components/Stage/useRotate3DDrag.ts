import { useRef, type RefObject } from 'react';
import { makeRotate3DDragController, type Rotate3DDragController, type Rotate3DSnapshot, type RotateHud } from '@savig/ui-core';
import type { Pt } from '@savig/interaction';
import { useEditor } from '../../store/store';
import { applyTransformPreview, type PreviewClosures } from './applyTransformPreview';

export interface Rotate3DDragCtx extends PreviewClosures {
  overlayRef: RefObject<SVGGElement | null>;
  clientToLocal: (clientX: number, clientY: number) => Pt | null;
  setRotateHud: (hud: RotateHud | null) => void;
}

/** 3D Rotation tool drag (spec 2026-11-18-3d-rotation): thin React adapter over the neutral
 *  `makeRotate3DDragController`. The tool's axis overlay follows the turned object; move/end
 *  return true while a turn is in progress. */
export function useRotate3DDrag() {
  const ref = useRef<Rotate3DDragController>();
  if (!ref.current) ref.current = makeRotate3DDragController(useEditor);
  const ctrl = ref.current;
  return {
    begin: (snapshot: Rotate3DSnapshot) => ctrl.begin(snapshot),
    move: (e: PointerEvent, ctx: Rotate3DDragCtx): boolean => {
      const r = ctrl.move(e.clientX, e.clientY, e.shiftKey);
      if (r.preview) {
        applyTransformPreview(r.preview.nodeTransforms, r.preview.containerPreviews, ctx);
        ctx.overlayRef.current?.setAttribute('transform', r.preview.overlayTransform);
        const p = ctx.clientToLocal(e.clientX, e.clientY);
        ctx.setRotateHud(p ? { x: p.x, y: p.y, label: r.preview.label, snapped: e.shiftKey } : null);
      }
      return r.consumed;
    },
    end: (ctx: Pick<Rotate3DDragCtx, 'setRotateHud'>): boolean => {
      const r = ctrl.end();
      if (r.consumed) ctx.setRotateHud(null);
      return r.consumed;
    },
  };
}
