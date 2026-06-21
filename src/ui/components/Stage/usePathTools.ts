import { useCallback, useEffect, useState } from 'react';
import type { PathData, PathNode, PathPoint } from '../../../engine';
import { useEditor } from '../../store/store';
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

// The selected path's data, read live from the store.
function currentPath(): PathData | null {
  const s = useEditor.getState();
  const obj = s.history.present.objects.find((o) => o.id === s.selectedObjectId);
  const asset = obj && s.history.present.assets.find((a) => a.id === obj.assetId);
  return asset && asset.kind === 'vector' && asset.shapeType === 'path' ? asset.path ?? null : null;
}

function isMirrored(node: PathNode): boolean {
  if (!node.in || !node.out) return false;
  return Math.abs(node.in.x + node.out.x) < MIRROR_EPS && Math.abs(node.in.y + node.out.y) < MIRROR_EPS;
}

// Pen authoring (multi-click draft) + node editing (drag with single commit on
// release). Pure path math lives in pathEdit/pathHitTest; this hook owns the
// ephemeral interaction state and delegates commits to the store.
export function usePathTools() {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dragging, setDragging] = useState(false);
  const [grab, setGrab] = useState<Grab | null>(null);
  const [working, setWorking] = useState<PathData | null>(null);

  // The keyboard handler requests pen-cancel via a store counter (it cannot see
  // this hook's local draft); react to changes by discarding the draft.
  const cancelToken = useEditor((s) => s.cancelPenRequested);
  useEffect(() => {
    setDraft(null);
    setDragging(false);
  }, [cancelToken]);

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
      setDraft((d) => {
        if (d && d.nodes.length >= 2) {
          useEditor.getState().addVectorPath({ nodes: d.nodes, closed: close });
        }
        return null;
      });
      setDragging(false);
      setDrafting(false);
    },
    [setDrafting],
  );

  const cancelPen = useCallback(() => {
    setDraft(null);
    setDragging(false);
    setDrafting(false);
  }, [setDrafting]);

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
    setWorking((w) => {
      if (w && grab) useEditor.getState().setPathData(w);
      return null;
    });
    setGrab(null);
  }, [grab]);

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
