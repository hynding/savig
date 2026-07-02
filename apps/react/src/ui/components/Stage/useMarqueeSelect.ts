import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { makeMarqueeController, type MarqueeController } from '@savig/ui-core';
import type { AABB } from '@savig/interaction';
import { useEditor } from '../../store/store';

type ToLocal = (clientX: number, clientY: number) => { x: number; y: number } | null;

/** Rubber-band (marquee) selection on the select tool. Thin React adapter over the neutral
 *  `makeMarqueeController` (slice 5): it owns the controller via a lazy ref, does the
 *  client→stage-local coordinate conversion (the DOM/CTM part stays here), and pushes the rect
 *  the controller returns into `marquee` React state so the overlay renders. The Stage keeps its
 *  single window listeners and delegates — `beginSelect` from onBackgroundPointerDown, `move`/
 *  `end` from the shared onMove/onUp (both return true when they consumed the event). */
export function useMarqueeSelect() {
  const ref = useRef<MarqueeController>();
  if (!ref.current) ref.current = makeMarqueeController(useEditor);
  const ctrl = ref.current;
  const [marquee, setMarquee] = useState<AABB | null>(null);

  return {
    marquee,
    beginSelect: (e: ReactPointerEvent, toLocal: ToLocal) =>
      ctrl.beginSelect(e.button, () => toLocal(e.clientX, e.clientY), e.shiftKey),
    move: (e: PointerEvent, toLocal: ToLocal): boolean => {
      const r = ctrl.move(() => toLocal(e.clientX, e.clientY));
      if (r.consumed) setMarquee(r.marquee);
      return r.consumed;
    },
    end: (): boolean => {
      const r = ctrl.end();
      if (r.consumed) setMarquee(r.marquee);
      return r.consumed;
    },
  };
}
