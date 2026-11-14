// Shape hint markers (spec 2026-11-14-shape-hints §Editor). Editor-only chrome in the Stage's
// content space (never exported). On a tween's START key the hints show as lettered markers on
// the start drawing (a); on the following key's first frame they show on the end drawing (b).
// Drag a marker to move it (it snaps to the outline on release and the tween re-bakes, one undo
// step); right-click deletes it. A hint the morph can't use (it would cross the others) is drawn
// red, like Flash.
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { frameKeySpans, groupToWorld, matApply, matInv, shapeHintStatus, shapeTweenOutlines, snapToFrame, snapToOutline } from '@savig/engine';
import type { PathData, PathPoint, SceneObject, ShapeHint } from '@savig/engine';
import type { Point } from '@savig/interaction';
import { useEditor } from '../../store/store';

interface Props {
  objects: SceneObject[];
  layer: SceneObject | null;
  time: number;
  fps: number;
  zoom: number;
  clientToLocal: (clientX: number, clientY: number) => Point | null;
  disabled: boolean;
}

type Side = 'a' | 'b';
interface MarkerSet {
  keyId: string;
  side: Side;
  hints: ShapeHint[];
  kept: boolean[];
  outlines: PathData[];
}

const letter = (i: number) => String.fromCharCode(97 + i);

function nearestOnOutlines(outlines: PathData[], p: PathPoint): PathPoint {
  let best = p;
  let bestD = Infinity;
  for (const o of outlines) {
    const q = snapToOutline(o, p);
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < bestD) [best, bestD] = [q, d];
  }
  return best;
}

export function ShapeHintOverlay({ objects, layer, time, fps, zoom, clientToLocal, disabled }: Props) {
  const t = snapToFrame(time, fps);
  const [drag, setDrag] = useState<{ keyId: string; side: Side; index: number; at: PathPoint } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;

  const sets = useMemo<MarkerSet[]>(() => {
    if (!layer?.frames) return [];
    const spans = frameKeySpans(layer.frames);
    const i = spans.findIndex((sp) => Math.abs(sp.start - t) < 1e-6);
    if (i < 0) return [];
    const out: MarkerSet[] = [];
    const add = (keyId: string, side: Side) => {
      const hints = layer.frames!.keys.find((k) => k.id === keyId)?.tween?.hints;
      if (!hints?.length) return;
      const pairs = shapeTweenOutlines(objects, layer.id, keyId);
      out.push({ keyId, side, hints, kept: shapeHintStatus(objects, layer.id, keyId, hints), outlines: pairs.map((p) => (side === 'a' ? p.from : p.to)) });
    };
    add(spans[i].id, 'a');
    if (i > 0) add(spans[i - 1].id, 'b');
    return out;
  }, [layer, objects, t]);

  const toWorld = useMemo(() => (layer ? groupToWorld(objects, layer.id, t) : null), [layer, objects, t]);
  const toLayer = useMemo(() => (toWorld ? matInv(toWorld) : null), [toWorld]);

  useEffect(() => {
    if (!layer || !toLayer) return;
    const local = (e: PointerEvent) => {
      const p = clientToLocal(e.clientX, e.clientY);
      return p ? matApply(toLayer, p) : null;
    };
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const p = local(e);
      if (p) setDrag({ ...d, at: p });
    };
    const onUp = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      setDrag(null);
      const set = sets.find((x) => x.keyId === d.keyId && x.side === d.side);
      const p = local(e) ?? d.at;
      if (!set) return;
      const snapped = nearestOnOutlines(set.outlines, p);
      const next = set.hints.map((h, j) => (j === d.index ? { ...h, [d.side]: snapped } : h));
      useEditor.getState().setShapeHints(d.keyId, next);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [clientToLocal, layer, sets, toLayer]);

  if (!layer || !toWorld || sets.length === 0) return null;

  const onDown = (set: MarkerSet, index: number, e: ReactPointerEvent) => {
    if (disabled || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    setDrag({ keyId: set.keyId, side: set.side, index, at: set.hints[index][set.side] });
  };
  const onDelete = (set: MarkerSet, index: number, e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;
    useEditor.getState().setShapeHints(set.keyId, set.hints.filter((_, j) => j !== index));
  };

  const r = 7 / zoom;
  return (
    <g data-testid="shape-hint-overlay">
      {sets.map((set) =>
        set.hints.map((h, i) => {
          const live = drag && drag.keyId === set.keyId && drag.side === set.side && drag.index === i ? drag.at : h[set.side];
          const p = matApply(toWorld, live);
          const ok = set.kept[i];
          const fill = !ok ? '#e05050' : set.side === 'a' ? '#f2c230' : '#3cb371';
          return (
            <g
              key={`${set.keyId}-${set.side}-${i}`}
              data-testid={`shape-hint-${set.side}-${i}`}
              data-valid={ok ? 'true' : 'false'}
              data-x={p.x}
              data-y={p.y}
              style={{ cursor: disabled ? 'default' : 'move' }}
              onPointerDown={(e) => onDown(set, i, e)}
              onContextMenu={(e) => onDelete(set, i, e)}
            >
              <title>{`Shape hint ${letter(i)}${ok ? '' : ' (not used: it would cross the other hints)'}`}</title>
              <circle cx={p.x} cy={p.y} r={r} fill={fill} stroke="#222" strokeWidth={1 / zoom} />
              <text x={p.x} y={p.y} dy={3.5 / zoom} textAnchor="middle" fontSize={10 / zoom} fontFamily="sans-serif" fontWeight={700} fill="#111" pointerEvents="none">
                {letter(i)}
              </text>
            </g>
          );
        }),
      )}
    </g>
  );
}
