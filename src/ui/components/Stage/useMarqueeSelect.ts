import { useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { isRenderHidden, isLockedInTree } from '../../../engine';
import { useEditor } from '../../store/store';
import { selectEditProject } from '../../store/selectors';
import { aabbIntersect, objectAABB, type AABB } from './snapping';

type ToLocal = (clientX: number, clientY: number) => { x: number; y: number } | null;

/** Rubber-band (marquee) selection on the select tool. Extracted from Stage.tsx (no behavior
 *  change). Owns marqueeRef + the rendered `marquee` rect; the Stage keeps its single window
 *  listeners and delegates — `beginSelect` from onBackgroundPointerDown, `move`/`end` from the
 *  shared onMove/onUp (both return true when they consumed the event, so the caller returns). */
export function useMarqueeSelect() {
  const marqueeRef = useRef<{ start: { x: number; y: number }; additive: boolean; moved: boolean; rect: AABB | null } | null>(null);
  const [marquee, setMarquee] = useState<AABB | null>(null);

  /** Background press with the select tool: a plain click (no drag) deselects on release; a
   *  drag rubber-bands. Mirrors the prior inline select-tool branch (left button only). */
  const beginSelect = (e: ReactPointerEvent, toLocal: ToLocal) => {
    if (e.button !== 0) return;
    const start = toLocal(e.clientX, e.clientY);
    if (!start) {
      useEditor.getState().selectObject(null);
      return;
    }
    marqueeRef.current = { start, additive: e.shiftKey, moved: false, rect: null };
  };

  const move = (e: PointerEvent, toLocal: ToLocal): boolean => {
    const mq = marqueeRef.current;
    if (!mq) return false;
    const cur = toLocal(e.clientX, e.clientY);
    if (!cur) return true; // a marquee is active; just no valid point this move (consume the event)
    mq.moved = true;
    const rect: AABB = {
      minX: Math.min(mq.start.x, cur.x),
      minY: Math.min(mq.start.y, cur.y),
      maxX: Math.max(mq.start.x, cur.x),
      maxY: Math.max(mq.start.y, cur.y),
    };
    mq.rect = rect; // keep on the ref so end() reads it fresh (the listener closure is stale)
    setMarquee(rect);
    return true;
  };

  const end = (): boolean => {
    const mq = marqueeRef.current;
    if (!mq) return false;
    marqueeRef.current = null;
    const rect = mq.rect;
    setMarquee(null);
    if (mq.moved && rect) {
      const proj = selectEditProject(useEditor.getState());
      const t = useEditor.getState().time;
      // Resolve assets from the fresh project (this window-listener closure captured a
      // stale `assetsById` from mount, when the project may have had no objects).
      // isRenderHidden so a child of a HIDDEN group isn't marquee-hit (else it would
      // resolve to and select the invisible group — slice 45c).
      const mqById = new Map(proj.objects.map((o) => [o.id, o] as const));
      const hits = proj.objects
        .filter((o) => !isRenderHidden(o, mqById) && !isLockedInTree(o, mqById))
        .filter((o) => {
          const a = objectAABB(o, proj.assets.find((as) => as.id === o.assetId), t);
          return a ? aabbIntersect(rect, a) : false;
        })
        .map((o) => o.id);
      if (mq.additive) {
        const cur = useEditor.getState().selectedObjectIds;
        useEditor.getState().selectObjectsExpandingGroups([...cur, ...hits]); // slice 42: marquee hit -> whole group
      } else {
        useEditor.getState().selectObjectsExpandingGroups(hits);
      }
    } else if (!mq.additive) {
      useEditor.getState().selectObject(null); // a plain background click deselects
    }
    return true;
  };

  return { marquee, beginSelect, move, end };
}
