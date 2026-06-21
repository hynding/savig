import { useRef } from 'react';
import { applyEasing } from '../../../engine';
import type { Easing, EasingName, CubicBezierEasing } from '../../../engine';
import styles from './EasingEditor.module.css';

const W = 120;
const H = 120;
const PAD = 30;
const PRESETS: EasingName[] = ['linear', 'easeIn', 'easeOut', 'easeInOut'];
const DEFAULT_CUSTOM: CubicBezierEasing = { type: 'cubicBezier', p1: 0.42, p2: 0, p3: 0.58, p4: 1 };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round2 = (n: number) => Math.round(n * 100) / 100;
const clampX = (n: number) => clamp(n, 0, 1);
const clampY = (n: number) => clamp(n, -0.5, 1.5);

const toSx = (t: number) => t * W;
const toSy = (y: number) => PAD + (1 - y) * H;

export function curveSamples(value: Easing, n = 24): Array<{ t: number; y: number }> {
  const out: Array<{ t: number; y: number }> = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push({ t, y: applyEasing(value, t) });
  }
  return out;
}

function curvePoints(value: Easing): string {
  return curveSamples(value)
    .map(({ t, y }) => `${toSx(t)},${toSy(y)}`)
    .join(' ');
}

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

  const setP1 = (x: number, y: number) =>
    onChange({ type: 'cubicBezier', p1: clampX(x), p2: clampY(y), p3: bezier!.p3, p4: bezier!.p4 });
  const setP2 = (x: number, y: number) =>
    onChange({ type: 'cubicBezier', p1: bezier!.p1, p2: bezier!.p2, p3: clampX(x), p4: clampY(y) });

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
