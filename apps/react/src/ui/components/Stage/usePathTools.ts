import { useEffect, useRef, useState } from 'react';
import type { PathPoint } from '@savig/engine';
import {
  makePathToolsController,
  type Draft,
  type Grab,
  type PathToolsController,
  type Working,
} from '@savig/ui-core';
import { useEditor } from '../../store/store';

/** Pen authoring (multi-click draft) + node editing (drag with a single commit on release). Thin
 *  React adapter over the neutral `makePathToolsController` (slice 5): the controller owns the
 *  ephemeral draft/working/grab state; this adapter mirrors it into React state after each mutation
 *  so the pen/node overlays re-render. The keyboard handler requests pen-cancel via a store counter
 *  (it can't see the controller's draft) — the adapter subscribes and calls `cancelPen`. */
export function usePathTools() {
  const ref = useRef<PathToolsController>();
  if (!ref.current) ref.current = makePathToolsController(useEditor);
  const ctrl = ref.current;

  const [draft, setDraft] = useState<Draft | null>(ctrl.getDraft());
  const [working, setWorking] = useState<Working | null>(ctrl.getWorking());
  const [grab, setGrab] = useState<Grab | null>(ctrl.getGrab());

  const syncDraft = () => setDraft(ctrl.getDraft());
  const syncNode = () => {
    setWorking(ctrl.getWorking());
    setGrab(ctrl.getGrab());
  };

  // React to keyboard-requested pen-cancel (a store counter) by discarding the draft.
  const cancelToken = useEditor((s) => s.cancelPenRequested);
  useEffect(() => {
    ctrl.cancelPen();
    syncDraft();
  }, [cancelToken]);

  return {
    draft,
    working,
    grab, // the active grab (anchor vs handle) — callers snap only anchor drags
    onPenPointerDown: (local: PathPoint, withDrag: boolean) => {
      ctrl.onPenPointerDown(local, withDrag);
      syncDraft();
    },
    onPenDrag: (local: PathPoint) => {
      ctrl.onPenDrag(local);
      syncDraft();
    },
    onPenPointerUp: () => ctrl.onPenPointerUp(),
    onPenPointerMove: (local: PathPoint) => {
      ctrl.onPenPointerMove(local);
      syncDraft();
    },
    finishPen: (close: boolean) => {
      ctrl.finishPen(close);
      syncDraft();
    },
    cancelPen: () => {
      ctrl.cancelPen();
      syncDraft();
    },
    onNodePointerDown: (local: PathPoint, tol?: number): boolean => {
      const grabbed = ctrl.onNodePointerDown(local, tol);
      syncNode();
      return grabbed;
    },
    onNodeDrag: (local: PathPoint) => {
      ctrl.onNodeDrag(local);
      setWorking(ctrl.getWorking());
    },
    onNodePointerUp: () => {
      ctrl.onNodePointerUp();
      syncNode();
    },
  };
}
