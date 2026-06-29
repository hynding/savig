import { useRef, useState, type RefObject } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { applyGradientHandleDrag } from '../../../engine';
import type { Gradient, GradientHandleId, LocalRect } from '../../../engine';
import { useEditor } from '../../store/store';

type GradientSel = { property: 'fill' | 'stroke'; bbox: LocalRect; gradient: Gradient };

/** On-canvas gradient-handle dragging. Extracted from Stage.tsx (no behavior change). Owns the
 *  drag ref + the live `dragState` (read by Stage's JSX to preview the dragging gradient). Uses
 *  the gradient-handle group's CTM (owned by Stage, passed in) to map the pointer into the
 *  object's gradient space. `move`/`end` return true while a drag is active so the shared
 *  onMove/onUp short-circuit; commits via setVectorGradient on release (skips a no-op drag). */
export function useGradientDrag(groupRef: RefObject<SVGGElement | null>) {
  const dragRef = useRef<{
    id: GradientHandleId;
    property: 'fill' | 'stroke';
    bbox: LocalRect;
    start: Gradient;
    current: Gradient;
  } | null>(null);
  const [dragState, setDragState] = useState<{ property: 'fill' | 'stroke'; gradient: Gradient } | null>(null);

  const onHandlePointerDown = (id: GradientHandleId, e: ReactPointerEvent, sel: GradientSel) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { id, property: sel.property, bbox: sel.bbox, start: sel.gradient, current: sel.gradient };
    setDragState({ property: sel.property, gradient: sel.gradient });
  };

  const move = (e: PointerEvent): boolean => {
    const gd = dragRef.current;
    if (!gd) return false;
    const group = groupRef.current;
    const ctm = group?.getScreenCTM();
    const svg = group?.ownerSVGElement;
    if (!group || !ctm || !svg) return true; // drag is active — consume even if the CTM is unavailable
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const local = pt.matrixTransform(ctm.inverse());
    const next = applyGradientHandleDrag(gd.start, gd.id, { x: local.x, y: local.y }, gd.bbox);
    gd.current = next;
    setDragState({ property: gd.property, gradient: next });
    return true;
  };

  const end = (): boolean => {
    const gd = dragRef.current;
    if (!gd) return false;
    dragRef.current = null;
    const finalGradient = gd.current;
    setDragState(null);
    // applyGradientHandleDrag returns a fresh object on every move, so
    // current === start means no drag happened -> skip the no-op commit.
    if (finalGradient !== gd.start) {
      useEditor.getState().setVectorGradient(gd.property, finalGradient);
    }
    return true;
  };

  return { dragState, onHandlePointerDown, move, end };
}
