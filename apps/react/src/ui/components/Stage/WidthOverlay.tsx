import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  flattenPath,
  pathToD,
  pointAtLength,
  removeWidthStation,
  setWidthStation,
  widthAtPoint,
  widthScaleAt,
  widthStrokeD,
  type PathData,
  type PathPoint,
  type VectorStyle,
  type WidthStop,
} from '@savig/engine';

/** Width tool (spec 2026-11-18-variable-width, slice 2). Drawn in the selected drawing's own
 *  coordinates (the group carries its transform). Press anywhere along the stroke and drag
 *  sideways: the stroke's edge follows the pointer at that spot (a station is added, or the
 *  nearest one within reach moves). Station dots drag the same way; Alt-click one to remove it.
 *  Letting go commits the profile in one undo step. */
export function WidthOverlay({
  transform,
  path,
  style,
  zoom,
  handleSize,
  onCommit,
}: {
  transform: string;
  path: PathData;
  style: VectorStyle;
  zoom: number;
  handleSize: number;
  onCommit: (profile: WidthStop[]) => void;
}) {
  const groupRef = useRef<SVGGElement | null>(null);
  const flat = useMemo(() => flattenPath(path), [path]);
  const profile = style.widthProfile ?? [];
  const [drag, setDrag] = useState<{ t: number; profile: WidthStop[]; moved: boolean } | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const shown = drag?.profile ?? profile;

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
  const at = (t: number) => pointAtLength(flat, t * flat.total);

  const begin = (e: ReactPointerEvent, fixedT?: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const q = toLocal(e);
    if (!q) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const t = fixedT ?? widthAtPoint(flat, style.strokeWidth, q).t;
    // Pressing doesn't change the width yet: the station starts at the width already drawn there.
    setDrag({ t, profile: setWidthStation(profile, t, widthScaleAt(profile, t)), moved: false });
  };
  const move = (e: ReactPointerEvent) => {
    if (!drag) {
      const q = toLocal(e);
      if (q) setHover(widthAtPoint(flat, style.strokeWidth, q).t);
      return;
    }
    const q = toLocal(e);
    if (!q) return;
    const c = at(drag.t);
    const w = Math.round(((2 * Math.hypot(q.x - c.x, q.y - c.y)) / Math.max(style.strokeWidth, 1e-6)) * 100) / 100;
    setDrag({ t: drag.t, profile: setWidthStation(profile, drag.t, w), moved: true });
  };
  const end = (e: ReactPointerEvent) => {
    if (!drag) return;
    e.stopPropagation();
    const { profile: next, moved } = drag;
    setDrag(null);
    if (moved) onCommit(next);
  };

  const preview = drag ? widthStrokeD(path, { ...style, widthProfile: drag.profile }) : '';
  const stroke = 1 / zoom;
  const reach = Math.max(style.strokeWidth * Math.max(1, ...shown.map((s) => s.w)), 16 / zoom);
  const hoverPt = hover !== null && !drag ? at(hover) : null;

  return (
    <g ref={groupRef} transform={transform} data-testid="width-tool">
      {preview && (
        <path d={preview} fill="var(--color-accent)" fillOpacity={0.35} stroke="var(--color-accent)" strokeWidth={stroke} pointerEvents="none" data-testid="width-preview" vectorEffect="non-scaling-stroke" />
      )}
      <path
        d={pathToD(path)}
        fill="none"
        stroke="transparent"
        strokeWidth={reach}
        strokeLinecap="round"
        pointerEvents="stroke"
        style={{ cursor: 'ew-resize' }}
        data-testid="width-hit"
        onPointerDown={(e) => begin(e)}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={() => setHover(null)}
      />
      {hoverPt && <circle cx={hoverPt.x} cy={hoverPt.y} r={handleSize / 3} fill="none" stroke="var(--color-accent)" strokeWidth={stroke} pointerEvents="none" data-testid="width-hover" />}
      {shown.map((s, i) => {
        const p = at(s.t);
        return (
          <circle
            key={i}
            data-testid={`width-station-${i}`}
            cx={p.x}
            cy={p.y}
            r={handleSize / 2}
            fill="var(--color-accent)"
            stroke="var(--color-panel)"
            strokeWidth={stroke}
            style={{ cursor: 'ew-resize' }}
            onPointerDown={(e) => {
              if (e.button === 0 && e.altKey) {
                e.stopPropagation();
                onCommit(removeWidthStation(profile, i));
                return;
              }
              begin(e, s.t);
            }}
            onPointerMove={move}
            onPointerUp={end}
          />
        );
      })}
    </g>
  );
}
