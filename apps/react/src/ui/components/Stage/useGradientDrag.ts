import { useRef, useState, type RefObject } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { makeGradientDragController, type GradientDragController, type GradientDragState } from '@savig/ui-core';
import type { Gradient, GradientHandleId, LocalRect } from '@savig/engine';
import { useEditor } from '../../store/store';

type GradientSel = { property: 'fill' | 'stroke'; bbox: LocalRect; gradient: Gradient };

/** On-canvas gradient-handle dragging. Thin React adapter over the neutral
 *  `makeGradientDragController` (slice 5): it does the pointer→gradient-space mapping via the
 *  handle group's CTM (the DOM part), pushes the `dragState` descriptor the controller returns
 *  into React state (read by Stage's JSX to preview the dragging gradient), and handles pointer
 *  capture. `move`/`end` return true while a drag is active so the shared onMove/onUp
 *  short-circuit; the controller commits via setVectorGradient on release. */
export function useGradientDrag(groupRef: RefObject<SVGGElement | null>) {
  const ref = useRef<GradientDragController>();
  if (!ref.current) ref.current = makeGradientDragController(useEditor);
  const ctrl = ref.current;
  const [dragState, setDragState] = useState<GradientDragState | null>(null);

  const onHandlePointerDown = (id: GradientHandleId, e: ReactPointerEvent, sel: GradientSel) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    ctrl.begin(id, sel.property, sel.bbox, sel.gradient);
    setDragState({ property: sel.property, gradient: sel.gradient });
  };

  const move = (e: PointerEvent): boolean => {
    const r = ctrl.move(() => {
      const group = groupRef.current;
      const ctm = group?.getScreenCTM();
      const svg = group?.ownerSVGElement;
      if (!group || !ctm || !svg) return null;
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const local = pt.matrixTransform(ctm.inverse());
      return { x: local.x, y: local.y };
    });
    if (r.dragState !== undefined) setDragState(r.dragState);
    return r.consumed;
  };

  const end = (): boolean => {
    const r = ctrl.end();
    if (r.consumed) setDragState(null);
    return r.consumed;
  };

  return { dragState, onHandlePointerDown, move, end };
}
