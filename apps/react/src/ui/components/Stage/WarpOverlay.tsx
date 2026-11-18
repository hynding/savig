import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { boxCorners, boxMesh, pathToDRings, warpMap, warpPath, warpPieces, type Box, type PathData, type PathPoint, type Warp } from '@savig/engine';

/** Free Transform Distort / Envelope handles (spec 2026-11-18-skew-distort, slice 3). Drawn in the
 *  selected drawing's own coordinates (the group carries its transform): four corner pins
 *  (distort) or a 3×3 mesh (envelope) on the drawing's box. Dragging a handle previews the warped
 *  outline; letting go bakes it (one undo step) and the handles reset onto the new box. */
export function WarpOverlay({
  mode,
  transform,
  box,
  path,
  rings,
  zoom,
  handleSize,
  onCommit,
}: {
  mode: 'distort' | 'envelope';
  transform: string;
  box: Box;
  path: PathData;
  rings: PathData[];
  zoom: number;
  handleSize: number;
  onCommit: (warp: Warp) => void;
}) {
  const groupRef = useRef<SVGGElement | null>(null);
  const [drag, setDrag] = useState<{ index: number; points: PathPoint[] } | null>(null);
  const rest = mode === 'distort' ? boxCorners(box) : boxMesh(box);
  const points = drag?.points ?? rest;
  const warpOf = (pts: PathPoint[]): Warp =>
    mode === 'distort' ? { kind: 'distort', corners: [pts[0], pts[1], pts[2], pts[3]] } : { kind: 'envelope', mesh: pts };

  const toLocal = (e: ReactPointerEvent): PathPoint | null => {
    const g = groupRef.current;
    const ctm = g?.getScreenCTM();
    const svg = g?.ownerSVGElement;
    if (!g || !ctm || !svg) return null;
    const p = svg.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const q = p.matrixTransform(ctm.inverse());
    return { x: q.x, y: q.y };
  };

  const preview = (() => {
    if (!drag) return null;
    const warp = warpOf(drag.points);
    const map = warpMap(box, warp);
    const pieces = warpPieces(warp);
    const scale = Math.max(box.width, box.height, 1);
    return pathToDRings(warpPath(path, map, pieces, scale), rings.map((r) => warpPath(r, map, pieces, scale)));
  })();

  const lines: [number, number][] =
    mode === 'distort'
      ? [[0, 1], [1, 2], [2, 3], [3, 0]]
      : [[0, 1], [1, 2], [3, 4], [4, 5], [6, 7], [7, 8], [0, 3], [3, 6], [1, 4], [4, 7], [2, 5], [5, 8]];
  const stroke = 1 / zoom;

  return (
    <g ref={groupRef} transform={transform} data-testid={`warp-${mode}`}>
      {preview && <path d={preview} fill="none" stroke="var(--color-accent)" strokeWidth={stroke} strokeDasharray={`${4 / zoom} ${3 / zoom}`} pointerEvents="none" data-testid="warp-preview" vectorEffect="non-scaling-stroke" />}
      {lines.map(([a, b]) => (
        <line key={`${a}-${b}`} x1={points[a].x} y1={points[a].y} x2={points[b].x} y2={points[b].y} stroke="var(--color-accent)" strokeWidth={stroke} strokeOpacity={0.6} pointerEvents="none" vectorEffect="non-scaling-stroke" />
      ))}
      {points.map((p, i) => (
        <circle
          key={i}
          data-testid={`warp-handle-${i}`}
          cx={p.x}
          cy={p.y}
          r={handleSize / 2}
          fill="var(--color-accent)"
          stroke="var(--color-panel)"
          strokeWidth={stroke}
          style={{ cursor: 'move' }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            (e.target as Element).setPointerCapture?.(e.pointerId);
            setDrag({ index: i, points: rest.map((q) => ({ ...q })) });
          }}
          onPointerMove={(e) => {
            if (!drag || drag.index !== i) return;
            const q = toLocal(e);
            if (!q) return;
            setDrag({ index: i, points: drag.points.map((r, k) => (k === i ? q : r)) });
          }}
          onPointerUp={(e) => {
            if (!drag || drag.index !== i) return;
            e.stopPropagation();
            const moved = drag.points.some((r, k) => Math.hypot(r.x - rest[k].x, r.y - rest[k].y) > 1e-6);
            setDrag(null);
            if (moved) onCommit(warpOf(drag.points));
          }}
        />
      ))}
    </g>
  );
}
