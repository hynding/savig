// Framework-neutral pen-authoring + node-editing controller (slice 5, group C2). Extracted from
// `Stage/usePathTools.ts`. The store is INJECTED (W2); the ephemeral interaction state (draft /
// working / dragging / grab) lives in closures. This dissolves the original's ref-mirroring: it
// kept `draftRef`/`workingRef` beside the React state ONLY so commits (addVectorPath/setPathData)
// could run OUTSIDE a setState updater (side effects inside an updater re-run under StrictMode and
// spawn duplicate objects). Here the state is plain closure vars, so commits are already outside
// any updater — no mirroring needed. Each mutator returns nothing; the app adapter reads the
// getters and mirrors `draft`/`working`/`grab` into React state to render the overlays. The
// pen-cancel signal (a store counter the keyboard handler bumps) stays a subscription in the
// adapter, which calls `cancelPen()`.
import type { PathData, PathNode, PathPoint } from '@savig/engine';
import { moveAnchor, moveHandle, pickRingTarget } from '@savig/interaction';
import { selectEditableRings } from '@savig/editor-state';
import type { ControllerStore } from './store';

// Drag preview, tagged with the ring it edits (0 = primary, k = compoundRings[k-1]).
export interface Working {
  ring: number;
  path: PathData;
}

export interface Draft {
  nodes: PathNode[];
  cursor: PathPoint | null;
}

export type Grab =
  | { kind: 'anchor'; ring: number; index: number }
  | { kind: 'handle'; ring: number; index: number; side: 'in' | 'out'; mirror: boolean };

const HANDLE_TOL = 6;
const MIRROR_EPS = 0.01;

function isMirrored(node: PathNode): boolean {
  if (!node.in || !node.out) return false;
  return Math.abs(node.in.x + node.out.x) < MIRROR_EPS && Math.abs(node.in.y + node.out.y) < MIRROR_EPS;
}

export function makePathToolsController(store: ControllerStore) {
  let draft: Draft | null = null;
  let working: Working | null = null;
  let dragging = false;
  let grab: Grab | null = null;

  // The selected path's editable rings at the playhead (ring 0 = primary morph-sampled shape,
  // rings >=1 = static compoundRings), via the shared resolver so a node-grab while morphing
  // starts from exactly the shape the canvas shows.
  const currentRings = (): PathData[] => selectEditableRings(store.getState());
  const setDrafting = (b: boolean) => store.getState().setPenDrafting(b);

  return {
    getDraft: (): Draft | null => draft,
    getWorking: (): Working | null => working,
    getGrab: (): Grab | null => grab,

    // --- pen ---
    onPenPointerDown(local: PathPoint, withDrag: boolean): void {
      if (withDrag) dragging = true;
      draft = draft ? { nodes: [...draft.nodes, { anchor: local }], cursor: local } : { nodes: [{ anchor: local }], cursor: local };
      setDrafting(true);
    },

    onPenDrag(local: PathPoint): void {
      if (!dragging) return;
      if (!draft || draft.nodes.length === 0) return;
      const last = draft.nodes.length - 1;
      const anchor = draft.nodes[last].anchor;
      const out = { x: local.x - anchor.x, y: local.y - anchor.y };
      // `0 - v` (not `-v`) so a zero component stays +0, not -0.
      const nodes = draft.nodes.map((n, i) => (i === last ? { ...n, out, in: { x: 0 - out.x, y: 0 - out.y } } : n));
      draft = { ...draft, nodes };
    },

    onPenPointerUp(): void {
      dragging = false;
    },

    onPenPointerMove(local: PathPoint): void {
      if (draft) draft = { ...draft, cursor: local };
    },

    finishPen(close: boolean): void {
      const d = draft;
      if (d && d.nodes.length >= 2) {
        const s = store.getState();
        const path = { nodes: d.nodes, closed: close };
        if (s.activeTool === 'motion' && s.selectedObjectId) {
          // The guide is stored in stage coordinates as-is (no bbox normalization, unlike
          // addVectorPath) since MotionPath.path lives in stage space.
          s.addMotionPath(s.selectedObjectId, path);
        } else {
          s.addVectorPath(path);
        }
      }
      draft = null;
      dragging = false;
      setDrafting(false);
    },

    cancelPen(): void {
      draft = null;
      dragging = false;
      setDrafting(false);
    },

    // --- node editing ---
    // Returns true if a node/handle was grabbed (so the caller can fall back to other behaviors,
    // e.g. inserting a node on a segment, when nothing was hit).
    onNodePointerDown(local: PathPoint, tol = HANDLE_TOL): boolean {
      const rings = currentRings();
      const target = pickRingTarget(rings, local, tol);
      if (!target) return false;
      const path = rings[target.ring];
      if (target.kind === 'handle') {
        grab = { kind: 'handle', ring: target.ring, index: target.index, side: target.side, mirror: isMirrored(path.nodes[target.index]) };
      } else {
        grab = { kind: 'anchor', ring: target.ring, index: target.index };
      }
      working = { ring: target.ring, path };
      store.getState().selectNode(target.index, target.ring);
      return true;
    },

    onNodeDrag(local: PathPoint): void {
      if (!working || !grab) return;
      if (grab.kind === 'anchor') {
        working = { ring: working.ring, path: moveAnchor(working.path, grab.index, local) };
      } else {
        const anchor = working.path.nodes[grab.index].anchor;
        working = { ring: working.ring, path: moveHandle(working.path, grab.index, grab.side, { x: local.x - anchor.x, y: local.y - anchor.y }, grab.mirror) };
      }
    },

    onNodePointerUp(): void {
      if (working && grab) store.getState().setRingPathData(working.ring, working.path);
      working = null;
      grab = null;
    },
  };
}

export type PathToolsController = ReturnType<typeof makePathToolsController>;
