import { useRef, type RefObject } from 'react';
import {
  makeRotateDragController,
  type RotateDragController,
  type RotateHud,
  type SingleSnapshot,
  type GroupSnapshot,
} from '@savig/ui-core';
import type { Pt } from '@savig/interaction';
import { useEditor } from '../../store/store';
import { applyTransformPreview, type PreviewClosures } from './applyTransformPreview';

/** Stage-runtime ports the rotate previews need (unchanged shape from Stage's rotateCtx). */
export interface RotateDragCtx extends PreviewClosures {
  clientToLocal: (clientX: number, clientY: number) => Pt | null;
  setRotateHud: (hud: RotateHud | null) => void;
  rotateHandleGroupRef: RefObject<SVGGElement | null>;
}

/** Rotate-handle dragging — single object + multi-selection group rotate. Thin React adapter over
 *  the neutral `makeRotateDragController` (slice 5): it binds `clientToLocal` lazily over the
 *  event, applies the preview descriptor (node/container previews, the single rotate-handle
 *  overlay transform, and the angle HUD), and clears the HUD on release. move/end return true
 *  while a rotate is in progress. */
export function useRotateDrag() {
  const ref = useRef<RotateDragController>();
  if (!ref.current) ref.current = makeRotateDragController(useEditor);
  const ctrl = ref.current;

  return {
    beginSingle: (snapshot: SingleSnapshot) => ctrl.beginSingle(snapshot),
    beginGroup: (snapshot: GroupSnapshot) => ctrl.beginGroup(snapshot),
    move: (e: PointerEvent, ctx: RotateDragCtx): boolean => {
      const r = ctrl.move(e.clientX, e.clientY, () => ctx.clientToLocal(e.clientX, e.clientY), e.metaKey || e.ctrlKey);
      if (r.preview) {
        applyTransformPreview(r.preview.nodeTransforms, r.preview.containerPreviews, ctx);
        if (r.preview.handleTransform !== undefined) {
          ctx.rotateHandleGroupRef.current?.setAttribute('transform', r.preview.handleTransform);
        }
        if (r.preview.hud !== undefined) ctx.setRotateHud(r.preview.hud);
      }
      return r.consumed;
    },
    end: (ctx: Pick<RotateDragCtx, 'setRotateHud'>): boolean => {
      const r = ctrl.end();
      if (r.consumed) ctx.setRotateHud(null);
      return r.consumed;
    },
  };
}
