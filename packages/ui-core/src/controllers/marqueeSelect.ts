// Framework-neutral rubber-band (marquee) selection controller (slice 5, group A). Extracted
// from `Stage/useMarqueeSelect.ts`. The store is INJECTED (W2); the in-progress marquee lives in
// a closure (replacing the React `useRef`). Coordinate conversion is injected as a LAZY thunk
// (`getPoint: () => Point | null`, `null` = outside the drawable area) rather than a precomputed
// point: the original calls `toLocal` only after its guards (skipping the DOM/CTM work — and any
// error it might throw — when there is no active marquee), and the controller preserves that
// exact control flow. Instead of calling React's `setMarquee`, `move`/`end` RETURN the rect to
// render (W5): the adapter pushes `result.marquee` into its own state when `result.consumed`, and
// returns `result.consumed` to drive Stage's ordered boolean-short-circuit dispatch.
import { isRenderHidden, isLockedInTree } from '@savig/engine';
import { aabbIntersect, objectAABB, type AABB } from '@savig/interaction';
import { selectEditProject } from '@savig/editor-state';
import type { ControllerStore } from './store';

export interface Point {
  x: number;
  y: number;
}

/** Lazily convert the current pointer to a stage-local point (`null` = outside the drawable
 *  area). The adapter binds this over the live pointer event + its CTM converter; the controller
 *  invokes it only when it actually needs the point, so no coordinate work happens on moves that
 *  aren't marquee moves. */
export type GetPoint = () => Point | null;

/** What `move`/`end` hand back to the adapter: whether the event was consumed (drives the Stage
 *  dispatch short-circuit) and the marquee rect to render (`null` = no marquee shown). */
export interface MarqueeResult {
  consumed: boolean;
  marquee: AABB | null;
}

interface MarqueeState {
  start: Point;
  additive: boolean;
  moved: boolean;
  rect: AABB | null;
}

export function makeMarqueeController(store: ControllerStore) {
  let mq: MarqueeState | null = null;

  return {
    /** Background press with the select tool. Left button only. A press with no valid start point
     *  (outside the drawable area) deselects immediately; otherwise it arms a marquee. */
    beginSelect(button: number, getStart: GetPoint, shiftKey: boolean): void {
      if (button !== 0) return;
      const start = getStart();
      if (!start) {
        store.getState().selectObject(null);
        return;
      }
      mq = { start, additive: shiftKey, moved: false, rect: null };
    },

    move(getPoint: GetPoint): MarqueeResult {
      if (!mq) return { consumed: false, marquee: null };
      const cur = getPoint();
      if (!cur) return { consumed: true, marquee: mq.rect }; // active marquee, no valid point this move
      mq.moved = true;
      const rect: AABB = {
        minX: Math.min(mq.start.x, cur.x),
        minY: Math.min(mq.start.y, cur.y),
        maxX: Math.max(mq.start.x, cur.x),
        maxY: Math.max(mq.start.y, cur.y),
      };
      mq.rect = rect;
      return { consumed: true, marquee: rect };
    },

    end(): MarqueeResult {
      if (!mq) return { consumed: false, marquee: null };
      const cur = mq;
      mq = null;
      const rect = cur.rect;
      if (cur.moved && rect) {
        // Resolve assets from the FRESH project (a window-listener closure would have captured a
        // stale map from mount, when the project may have had no objects). isRenderHidden so a
        // child of a HIDDEN group isn't marquee-hit (else it would resolve to and select the
        // invisible group — slice 45c); isLockedInTree so locked subtrees aren't grabbed.
        const proj = selectEditProject(store.getState());
        const t = store.getState().time;
        const mqById = new Map(proj.objects.map((o) => [o.id, o] as const));
        const hits = proj.objects
          .filter((o) => !isRenderHidden(o, mqById) && !isLockedInTree(o, mqById))
          .filter((o) => {
            const a = objectAABB(o, proj.assets.find((as) => as.id === o.assetId), t);
            return a ? aabbIntersect(rect, a) : false;
          })
          .map((o) => o.id);
        if (cur.additive) {
          const sel = store.getState().selectedObjectIds;
          store.getState().selectObjectsExpandingGroups([...sel, ...hits]); // slice 42: hit -> whole group
        } else {
          store.getState().selectObjectsExpandingGroups(hits);
        }
      } else if (!cur.additive) {
        store.getState().selectObject(null); // a plain background click deselects
      }
      return { consumed: true, marquee: null };
    },
  };
}

export type MarqueeController = ReturnType<typeof makeMarqueeController>;
