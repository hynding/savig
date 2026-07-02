import { useRef } from 'react';
import { makeObjectDragController, type DragState, type ObjectDragController } from '@savig/ui-core';
import type { SpacingGuide } from '@savig/interaction';
import { useEditor } from '../../store/store';
import { applyTransformPreview, type PreviewClosures } from './applyTransformPreview';

export type { DragState };

/** Stage-runtime setters + preview closures the move descriptor is applied through. */
export interface ObjectDragCtx extends PreviewClosures {
  setSnapGuides: (g: { x: number | null; y: number | null }) => void;
  setSpacingGuides: (g: SpacingGuide[]) => void;
  setDragOffset: (d: { dx: number; dy: number } | null) => void;
}

/** Object move-dragging — single object + multi-selection. Thin React adapter over the neutral
 *  `makeObjectDragController` (slice 5): it applies the preview descriptor the controller returns
 *  (node transforms + container previews via `applyTransformPreview`, plus the snap/spacing/offset
 *  setters). Stage's onObjectPointerDown snapshots the DragState and calls begin; move/end are
 *  delegated from the shared onMove/onUp and return true while a move-drag is in progress. */
export function useObjectDrag() {
  const ref = useRef<ObjectDragController>();
  if (!ref.current) ref.current = makeObjectDragController(useEditor);
  const ctrl = ref.current;

  return {
    begin: (state: DragState) => ctrl.begin(state),
    move: (e: PointerEvent, ctx: ObjectDragCtx): boolean => {
      const r = ctrl.move(e.clientX, e.clientY, e.metaKey || e.ctrlKey);
      if (r.preview) {
        applyTransformPreview(r.preview.nodeTransforms, r.preview.containerPreviews, ctx);
        ctx.setSnapGuides(r.preview.snapGuides);
        ctx.setSpacingGuides(r.preview.spacingGuides);
        ctx.setDragOffset(r.preview.dragOffset);
      }
      return r.consumed;
    },
    end: (ctx: Pick<ObjectDragCtx, 'setSnapGuides' | 'setSpacingGuides' | 'setDragOffset'>): boolean => {
      const r = ctrl.end();
      if (r.consumed) {
        ctx.setSnapGuides({ x: null, y: null });
        ctx.setSpacingGuides([]);
        ctx.setDragOffset(null);
      }
      return r.consumed;
    },
  };
}
