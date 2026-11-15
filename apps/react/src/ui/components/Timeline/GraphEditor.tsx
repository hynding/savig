// Motion editor graph (spec 2026-11-15-motion-editor): value over time for one property of the
// selected object, on the Timeline's own time axis. The model is ui-core's graphViewModel; this
// component maps (time, value) to pixels, draws, and owns the drag gestures: a key moves in time
// (frame-snapped) and value, a handle reshapes its segment's easing. A drag previews through
// graphViewModel's `preview` track and commits once, on release.
import { useEffect, useMemo, useRef, useState } from 'react';
import { snapToFrame } from '@savig/engine';
import type { AnimatableProperty, CubicBezierEasing, Easing, Keyframe } from '@savig/engine';
import { selectActiveObjects } from '@savig/editor-state';
import {
  graphViewModel,
  handleToEasing,
  paddedRange,
  roundForSpan,
  trackWithEasing,
  trackWithKeyMoved,
  valueTicks,
  type GraphCurveVM,
  type GraphPoint,
  type GraphPreview,
  type timelineIntents,
} from '@savig/ui-core';
import { useEditor } from '../../store/store';
import { TRACK_LABEL_WIDTH, useTimelineScale } from './scale';
import styles from './Timeline.module.css';

/** Default plot height; the Timeline passes the room it has. */
export const GRAPH_HEIGHT = 160;
export const GRAPH_MIN_HEIGHT = 60;
export const GRAPH_PAD = 14;
const PAD = GRAPH_PAD;
/** Pointer travel (px) before a press on a key becomes a drag rather than a click. */
const DRAG_SLOP = 2;

type Intents = ReturnType<typeof timelineIntents>;

interface DragBase {
  objectId: string;
  property: AnimatableProperty;
  track0: Keyframe[];
  x0: number;
  y0: number;
  /** The value axis is frozen for the whole drag, so the pointer↔value mapping stays put. */
  range: { min: number; max: number };
  moved: boolean;
}
type Drag =
  | (DragBase & { kind: 'key'; time0: number; value0: number; time: number; value: number })
  | (DragBase & { kind: 'handle'; index: number; which: 'out' | 'in'; start: GraphPoint; from: GraphPoint; to: GraphPoint; bezier: CubicBezierEasing; easing: Easing });

const SEGMENT_PRESETS: { easing: Easing; label: string }[] = [
  { easing: 'linear', label: 'Linear' },
  { easing: 'easeIn', label: 'Ease in' },
  { easing: 'easeOut', label: 'Ease out' },
  { easing: 'easeInOut', label: 'Ease in-out' },
];

/** Arrow-key value step: a round 1/100 of the visible span (×10 with Shift). */
const nudgeStep = (span: number) => (span > 0 ? 10 ** Math.floor(Math.log10(span / 100)) : 1);

const fmtValue = (v: number) => (Math.abs(v) >= 100 ? String(Math.round(v)) : String(Number(v.toFixed(2))));

function previewOf(d: Drag | null): GraphPreview | null {
  if (!d || !d.moved) return null;
  if (d.kind === 'key') return { property: d.property, track: trackWithKeyMoved(d.track0, d.time0, d.time, d.value) };
  return { property: d.property, track: trackWithEasing(d.track0, d.index, d.easing) };
}

export function GraphEditor({ intents, height = GRAPH_HEIGHT }: { intents: Intents; height?: number }) {
  const H = Math.max(GRAPH_MIN_HEIGHT, height);
  const [focusProp, setFocusProp] = useState<AnimatableProperty | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const state = useEditor((s) => s);
  const preview = useMemo(() => previewOf(drag), [drag]);
  const vm = useMemo(() => graphViewModel(state, drag?.property ?? focusProp, preview), [state, focusProp, drag?.property, preview]);
  const { timeToX, xToTime } = useTimelineScale();
  const width = timeToX(Math.max(vm.duration, ...vm.curves.flatMap((c) => c.keys.map((k) => k.time)))) + 2 * PAD;
  const { min, max } = drag?.range ?? vm.range;
  const plot = H - 2 * PAD;
  const yOf = (v: number) => PAD + ((max - v) / (max - min)) * plot;
  const xOf = (t: number) => timeToX(t);
  const pt = (p: GraphPoint, y = yOf) => `${xOf(p.time)},${y(p.value)}`;

  // Window listeners while a drag is live (pointer capture keeps them firing off the svg).
  const fps = vm.fps;
  useEffect(() => {
    if (!drag) return;
    const update = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return null;
      let dx = e.clientX - d.x0;
      let dy = e.clientY - d.y0;
      const moved = d.moved || Math.hypot(dx, dy) > DRAG_SLOP;
      if (e.shiftKey) {
        // Shift: keep to the dominant axis.
        if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      const dt = xToTime(dx);
      const span = d.range.max - d.range.min;
      const dv = (-dy * span) / plot;
      if (d.kind === 'key') {
        let value = roundForSpan(d.value0 + dv, span);
        if (d.property === 'opacity') value = Math.min(1, Math.max(0, value));
        return { ...d, moved, time: Math.max(0, snapToFrame(d.time0 + dt, fps)), value };
      }
      return { ...d, moved, easing: handleToEasing(d.from, d.to, d.bezier, d.which, { time: d.start.time + dt, value: d.start.value + dv }) };
    };
    const onMove = (e: PointerEvent) => {
      const next = update(e);
      if (next) setDrag(next);
    };
    const onUp = (e: PointerEvent) => {
      const d = update(e);
      setDrag(null);
      if (!d || !d.moved) return;
      if (d.kind === 'key') intents.moveScalarKeyframe({ objectId: d.objectId, property: d.property, time: d.time0 }, d.time, d.value);
      else intents.setScalarSegmentEasing({ objectId: d.objectId, property: d.property, time: d.from.time }, d.easing);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrag(null); // cancel: nothing was committed
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    };
    // Re-arm only when a drag starts or ends; the handlers read the live drag through dragRef.
  }, [drag === null, fps, plot, xToTime, intents]);

  if (!vm.objectId) {
    return (
      <div className={styles.graphEmpty} data-testid="graph-editor">
        Select an animated object to see its motion curves.
      </div>
    );
  }
  if (!vm.focus) {
    return (
      <div className={styles.graphEmpty} data-testid="graph-editor">
        This object has no animated properties yet. Set a keyframe to see its curve.
      </div>
    );
  }
  const focus = vm.focus;
  const objectId = vm.objectId;
  const ticks = valueTicks(min, max);
  const otherCurve = (c: GraphCurveVM) => {
    const r = paddedRange(c.min, c.max);
    const y = (v: number) => PAD + ((r.max - v) / (r.max - r.min)) * plot;
    return <polyline key={c.property} className={styles.graphCurveFaint} points={c.samples.map((p) => pt(p, y)).join(' ')} data-testid={`graph-curve-${c.property}`} />;
  };
  const storedTrack = (): Keyframe[] => selectActiveObjects(useEditor.getState()).find((o) => o.id === objectId)?.tracks[focus.property] ?? [];
  const begin = (e: React.PointerEvent): DragBase | null => {
    if (vm.locked || e.button !== 0) return null;
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    return { objectId, property: focus.property, track0: storedTrack(), x0: e.clientX, y0: e.clientY, range: vm.range, moved: false };
  };
  const draggedKey = drag?.kind === 'key' && drag.moved ? { time: drag.time, value: drag.value } : null;
  const selectedIndex = focus.keys.findIndex((k) => k.selected);
  const selectedKey = selectedIndex >= 0 ? focus.keys[selectedIndex] : null;
  // The segment the selected key starts (presets act on it).
  const selectedSegment = focus.segments.find((sg) => sg.index === selectedIndex) ?? null;
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!selectedKey || vm.locked || drag) return;
    const span = vm.range.max - vm.range.min;
    const step = nudgeStep(span) * (e.shiftKey ? 10 : 1);
    let time = selectedKey.time;
    let value = selectedKey.value;
    if (e.key === 'ArrowLeft') time = Math.max(0, time - 1 / fps);
    else if (e.key === 'ArrowRight') time += 1 / fps;
    else if (e.key === 'ArrowUp') value = roundForSpan(value + step, span);
    else if (e.key === 'ArrowDown') value = roundForSpan(value - step, span);
    else return;
    // The graph owns the arrows while focused (the Stage would otherwise nudge the object).
    e.preventDefault();
    e.stopPropagation();
    if (focus.property === 'opacity') value = Math.min(1, Math.max(0, value));
    intents.moveScalarKeyframe({ objectId, property: focus.property, time: selectedKey.time }, time, value);
  };
  const onDoubleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (vm.locked || (e.target as Element).hasAttribute('data-graph-hit')) return;
    const left = e.currentTarget.getBoundingClientRect().left;
    intents.insertScalarKeyframe({ objectId, property: focus.property, time: Math.max(0, xToTime(e.clientX - left)) });
  };

  return (
    <div className={`${styles.graph} ${vm.locked ? styles.locked : ''}`} data-testid="graph-editor">
      <div className={styles.graphChips} role="group" aria-label="Curve">
        {vm.curves.map((c) => (
          <button
            key={c.property}
            className={`${styles.graphChip} ${c.property === focus.property ? styles.on : ''}`}
            aria-pressed={c.property === focus.property}
            data-testid={`graph-chip-${c.property}`}
            onClick={() => setFocusProp(c.property)}
          >
            {c.label}
          </button>
        ))}
        {selectedSegment && !vm.locked && (
          <span className={styles.graphPresets} role="group" aria-label="Segment easing">
            {SEGMENT_PRESETS.map((p) => (
              <button
                key={p.label}
                className={styles.graphChip}
                data-testid={`graph-preset-${p.easing}`}
                title={`${p.label} from ${selectedSegment.from.time}s to ${selectedSegment.to.time}s`}
                onClick={() => intents.setScalarSegmentEasing({ objectId, property: focus.property, time: selectedSegment.from.time }, p.easing)}
              >
                {p.label}
              </button>
            ))}
          </span>
        )}
        {draggedKey && (
          <span className={styles.graphReadout} data-testid="graph-readout">
            {fmtValue(draggedKey.value)} @ {Number(draggedKey.time.toFixed(3))}s
          </span>
        )}
      </div>
      <div className={styles.graphBody} style={{ height: H }}>
        <div className={styles.graphAxis} style={{ width: TRACK_LABEL_WIDTH }}>
          {ticks.map((v) => (
            <span key={v} className={styles.graphTick} style={{ top: yOf(v) }}>
              {fmtValue(v)}
            </span>
          ))}
        </div>
        <svg
          className={styles.graphSvg}
          width="100%"
          style={{ minWidth: width }}
          height={H}
          data-testid="graph-svg"
          data-min={min}
          data-max={max}
          tabIndex={0}
          aria-label={`${focus.label} curve. Double-click to add a key; arrows nudge the selected key.`}
          onKeyDown={onKeyDown}
          onDoubleClick={onDoubleClick}
        >
          {ticks.map((v) => (
            <line key={v} className={styles.graphGrid} x1={0} x2="100%" y1={yOf(v)} y2={yOf(v)} />
          ))}
          {vm.curves.filter((c) => c !== focus).map(otherCurve)}
          <polyline className={styles.graphCurve} points={focus.samples.map((p) => pt(p)).join(' ')} data-testid={`graph-curve-${focus.property}`} />
          {focus.segments.map((sg) => (
            <g key={sg.index} data-testid={`graph-segment-${sg.index}`}>
              <line className={styles.graphHandleLine} x1={xOf(sg.from.time)} y1={yOf(sg.from.value)} x2={xOf(sg.handleOut.time)} y2={yOf(sg.handleOut.value)} />
              <line className={styles.graphHandleLine} x1={xOf(sg.to.time)} y1={yOf(sg.to.value)} x2={xOf(sg.handleIn.time)} y2={yOf(sg.handleIn.value)} />
              {(['out', 'in'] as const).map((which) => {
                const h = which === 'out' ? sg.handleOut : sg.handleIn;
                return (
                  <circle
                    key={which}
                    className={styles.graphHandle}
                    r={4}
                    cx={xOf(h.time)}
                    cy={yOf(h.value)}
                    data-testid={`graph-handle-${which}-${sg.index}`}
                    data-graph-hit=""
                    aria-label={`${focus.label} ease ${which === 'out' ? 'out of' : 'into'} keyframe ${which === 'out' ? sg.from.time : sg.to.time}s`}
                    onPointerDown={(e) => {
                      const b = begin(e);
                      if (!b) return;
                      setDrag({ ...b, kind: 'handle', index: sg.index, which, start: h, from: sg.from, to: sg.to, bezier: sg.bezier, easing: sg.bezier });
                    }}
                  />
                );
              })}
            </g>
          ))}
          {focus.keys.map((k) => {
            const active = k.selected || (draggedKey !== null && draggedKey.time === k.time && draggedKey.value === k.value);
            return (
              <rect
                key={k.time}
                className={`${styles.graphKey} ${active ? styles.graphKeySelected : ''}`}
                x={xOf(k.time) - 5}
                y={yOf(k.value) - 5}
                width={10}
                height={10}
                transform={`rotate(45 ${xOf(k.time)} ${yOf(k.value)})`}
                data-testid={`graph-key-${focus.property}-${k.time}`}
                data-graph-hit=""
                aria-label={`${focus.label} keyframe at ${k.time}s, value ${fmtValue(k.value)}`}
                onPointerDown={(e) => {
                  const b = begin(e);
                  if (!b) return;
                  intents.selectKeyframe({ objectId, property: focus.property, time: k.time });
                  setDrag({ ...b, kind: 'key', time0: k.time, value0: k.value, time: k.time, value: k.value });
                }}
              />
            );
          })}
        </svg>
      </div>
    </div>
  );
}
