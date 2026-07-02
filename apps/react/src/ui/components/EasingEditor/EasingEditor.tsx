import { useRef } from 'react';
import type { Easing } from '@savig/engine';
import {
  curvePoints,
  curveSamples,
  clampX,
  clampY,
  easingRound2 as round2,
  setBezierP1,
  setBezierP2,
  toSx,
  toSy,
  DEFAULT_CUSTOM_EASING as DEFAULT_CUSTOM,
  EASING_PRESETS as PRESETS,
  EASING_W as W,
  EASING_H as H,
  EASING_PAD as PAD,
} from '@savig/ui-core';
import styles from './EasingEditor.module.css';

// Re-exported for EasingEditor.test.tsx (the curve math now lives in @savig/ui-core).
export { curveSamples };

function Handle({
  label,
  x,
  y,
  onMove,
  onNudge,
}: {
  label: string;
  x: number;
  y: number;
  onMove: (clientX: number, clientY: number) => void;
  onNudge: (dx: number, dy: number) => void;
}): JSX.Element {
  return (
    <circle
      className={styles.handle}
      role="slider"
      aria-label={label}
      aria-valuenow={Math.round(x * 100)}
      aria-valuetext={`x ${round2(x)}, y ${round2(y)}`}
      tabIndex={0}
      cx={toSx(x)}
      cy={toSy(y)}
      r={6}
      onPointerDown={(e) => (e.target as Element).setPointerCapture?.(e.pointerId)}
      onPointerMove={(e) => {
        if (e.buttons) onMove(e.clientX, e.clientY);
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 0.1 : 0.02;
        if (e.key === 'ArrowLeft') {
          onNudge(-step, 0);
          e.preventDefault();
        } else if (e.key === 'ArrowRight') {
          onNudge(step, 0);
          e.preventDefault();
        } else if (e.key === 'ArrowUp') {
          onNudge(0, step);
          e.preventDefault();
        } else if (e.key === 'ArrowDown') {
          onNudge(0, -step);
          e.preventDefault();
        }
      }}
    />
  );
}

export function EasingEditor({
  value,
  onChange,
  inert,
}: {
  value: Easing;
  onChange: (next: Easing) => void;
  inert?: boolean;
}): JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null);
  const custom = typeof value !== 'string';
  const bezier = custom ? value : null;

  // Map client px -> easing params via the rendered rect, so the widget stays
  // correct at any rendered size (the SVG carries a viewBox, so contents scale).
  const fromClient = (clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const uy = ((clientY - rect.top) / rect.height) * (H + 2 * PAD);
    return {
      x: clampX((clientX - rect.left) / rect.width),
      y: clampY(1 - (uy - PAD) / H),
    };
  };

  const setP1 = (x: number, y: number) => onChange(setBezierP1(bezier!, x, y));
  const setP2 = (x: number, y: number) => onChange(setBezierP2(bezier!, x, y));

  return (
    <div className={styles.editor}>
      <div className={styles.presets}>
        {PRESETS.map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={value === name}
            className={value === name ? styles.active : ''}
            onClick={() => onChange(name)}
          >
            {name}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={custom}
          className={custom ? styles.active : ''}
          onClick={() => {
            if (!custom) onChange(DEFAULT_CUSTOM);
          }}
        >
          custom
        </button>
      </div>

      <svg
        ref={svgRef}
        className={styles.canvas}
        width={W}
        height={H + 2 * PAD}
        viewBox={`0 0 ${W} ${H + 2 * PAD}`}
        role="img"
        aria-label="easing curve"
      >
        <polyline className={styles.guide} points={`${toSx(0)},${toSy(0)} ${toSx(1)},${toSy(1)}`} fill="none" />
        <polyline className={styles.curve} points={curvePoints(value)} fill="none" />
        {bezier && (
          <>
            <Handle
              label="ease control point 1"
              x={bezier.p1}
              y={bezier.p2}
              onMove={(cx, cy) => {
                const p = fromClient(cx, cy);
                setP1(p.x, p.y);
              }}
              onNudge={(dx, dy) => setP1(bezier.p1 + dx, bezier.p2 + dy)}
            />
            <Handle
              label="ease control point 2"
              x={bezier.p3}
              y={bezier.p4}
              onMove={(cx, cy) => {
                const p = fromClient(cx, cy);
                setP2(p.x, p.y);
              }}
              onNudge={(dx, dy) => setP2(bezier.p3 + dx, bezier.p4 + dy)}
            />
          </>
        )}
      </svg>

      <div className={styles.readback} data-testid="easing-readback">
        {custom
          ? `cubic-bezier(${round2(bezier!.p1)}, ${round2(bezier!.p2)}, ${round2(bezier!.p3)}, ${round2(bezier!.p4)})`
          : value}
      </div>
      {inert && <div className={styles.hint}>easing applies to the segment into the next keyframe</div>}
    </div>
  );
}
