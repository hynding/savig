import { useCallback, useEffect, useRef, useState } from 'react';
import type { PathData, PathNode, PathPoint } from '../../../engine';
import { useEditor } from '../../store/store';
import { selectEditablePath } from '../../store/selectors';
import { hitTestAnchor, hitTestHandle } from './pathHitTest';
import { moveAnchor, moveHandle } from './pathEdit';

interface Draft {
  nodes: PathNode[];
  cursor: PathPoint | null;
}

type Grab =
  | { kind: 'anchor'; index: number }
  | { kind: 'handle'; index: number; side: 'in' | 'out'; mirror: boolean };

const HANDLE_TOL = 6;
const MIRROR_EPS = 0.01;

// The selected path's editable data at the playhead (sampled morph shape when a
// shapeTrack exists, else the static base), via the shared resolver so a node-grab
// while morphing starts from exactly the shape the canvas shows.
function currentPath(): PathData | null {
  return selectEditablePath(useEditor.getState());
}

function isMirrored(node: PathNode): boolean {
  if (!node.in || !node.out) return false;
  return Math.abs(node.in.x + node.out.x) < MIRROR_EPS && Math.abs(node.in.y + node.out.y) < MIRROR_EPS;
}

// Pen authoring (multi-click draft) + node editing (drag with single commit on
// release). Pure path math lives in pathEdit/pathHitTest; this hook owns the
// ephemeral interaction state and delegates commits to the store.
export function usePathTools() {
  // draft/working are mirrored into refs so commits (addVectorPath/setPathData) run
  // OUTSIDE the state updater — side effects inside a setState updater are impure
  // and re-run under React StrictMode, spawning duplicate objects.
  const [draft, setDraftState] = useState<Draft | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const setDraft = useCallback((next: Draft | null | ((prev: Draft | null) => Draft | null)) => {
    draftRef.current = typeof next === 'function' ? next(draftRef.current) : next;
    setDraftState(draftRef.current);
  }, []);

  const [working, setWorkingState] = useState<PathData | null>(null);
  const workingRef = useRef<PathData | null>(null);
  const setWorking = useCallback(
    (next: PathData | null | ((prev: PathData | null) => PathData | null)) => {
      workingRef.current = typeof next === 'function' ? next(workingRef.current) : next;
      setWorkingState(workingRef.current);
    },
    [],
  );

  const [dragging, setDragging] = useState(false);
  const [grab, setGrab] = useState<Grab | null>(null);

  // The keyboard handler requests pen-cancel via a store counter (it cannot see
  // this hook's local draft); react to changes by discarding the draft.
  const cancelToken = useEditor((s) => s.cancelPenRequested);
  useEffect(() => {
    setDraft(null);
    setDragging(false);
    useEditor.getState().setPenDrafting(false);
  }, [cancelToken, setDraft]);

  const setDrafting = useEditor.getState().setPenDrafting;

  // --- pen ---
  const onPenPointerDown = useCallback(
    (local: PathPoint, withDrag: boolean) => {
      if (withDrag) setDragging(true);
      setDraft((d) => {
        const nodes = d ? [...d.nodes, { anchor: local }] : [{ anchor: local }];
        return { nodes, cursor: local };
      });
      setDrafting(true);
    },
    [setDrafting],
  );

  const onPenDrag = useCallback(
    (local: PathPoint) => {
      if (!dragging) return;
      setDraft((d) => {
        if (!d || d.nodes.length === 0) return d;
        const last = d.nodes.length - 1;
        const anchor = d.nodes[last].anchor;
        const out = { x: local.x - anchor.x, y: local.y - anchor.y };
        // `0 - v` (not `-v`) so a zero component stays +0, not -0.
        const nodes = d.nodes.map((n, i) =>
          i === last ? { ...n, out, in: { x: 0 - out.x, y: 0 - out.y } } : n,
        );
        return { ...d, nodes };
      });
    },
    [dragging],
  );

  const onPenPointerUp = useCallback(() => setDragging(false), []);

  const onPenPointerMove = useCallback((local: PathPoint) => {
    setDraft((d) => (d ? { ...d, cursor: local } : d));
  }, []);

  const finishPen = useCallback(
    (close: boolean) => {
      const d = draftRef.current;
      if (d && d.nodes.length >= 2) {
        const s = useEditor.getState();
        const path = { nodes: d.nodes, closed: close };
        if (s.activeTool === 'motion' && s.selectedObjectId) {
          // The guide is stored in stage coordinates as-is (no bbox normalization,
          // unlike addVectorPath) since MotionPath.path lives in stage space.
          s.addMotionPath(s.selectedObjectId, path);
        } else {
          s.addVectorPath(path);
        }
      }
      setDraft(null);
      setDragging(false);
      setDrafting(false);
    },
    [setDraft, setDrafting],
  );

  const cancelPen = useCallback(() => {
    setDraft(null);
    setDragging(false);
    setDrafting(false);
  }, [setDraft, setDrafting]);

  // --- node editing ---
  // Returns true if a node/handle was grabbed (so the caller can fall back to
  // other behaviors, e.g. inserting a node on a segment, when nothing was hit).
  const onNodePointerDown = useCallback((local: PathPoint, tol = HANDLE_TOL): boolean => {
    const path = currentPath();
    if (!path) return false;
    const h = hitTestHandle(path, local, tol);
    if (h) {
      setGrab({ kind: 'handle', index: h.index, side: h.side, mirror: isMirrored(path.nodes[h.index]) });
      setWorking(path);
      useEditor.getState().selectNode(h.index);
      return true;
    }
    const a = hitTestAnchor(path, local, tol);
    if (a != null) {
      setGrab({ kind: 'anchor', index: a });
      setWorking(path);
      useEditor.getState().selectNode(a);
      return true;
    }
    return false;
  }, []);

  const onNodeDrag = useCallback(
    (local: PathPoint) => {
      setWorking((w) => {
        if (!w || !grab) return w;
        if (grab.kind === 'anchor') return moveAnchor(w, grab.index, local);
        const anchor = w.nodes[grab.index].anchor;
        return moveHandle(w, grab.index, grab.side, { x: local.x - anchor.x, y: local.y - anchor.y }, grab.mirror);
      });
    },
    [grab],
  );

  const onNodePointerUp = useCallback(() => {
    const w = workingRef.current;
    if (w && grab) useEditor.getState().setPathData(w);
    setWorking(null);
    setGrab(null);
  }, [grab, setWorking]);

  return {
    draft,
    working,
    onPenPointerDown,
    onPenDrag,
    onPenPointerUp,
    onPenPointerMove,
    finishPen,
    cancelPen,
    onNodePointerDown,
    onNodeDrag,
    onNodePointerUp,
  };
}
