// Motion editor graph (spec 2026-11-15-motion-editor): value over time for one property of the
// selected object, on the Timeline's own time axis. The model is ui-core's graphViewModel; this
// component only maps (time, value) to pixels and draws.
import { useMemo, useState } from 'react';
import type { AnimatableProperty } from '@savig/engine';
import { graphViewModel, paddedRange, valueTicks, type GraphCurveVM, type GraphPoint, type timelineIntents } from '@savig/ui-core';
import { useEditor } from '../../store/store';
import { TRACK_LABEL_WIDTH, useTimelineScale } from './scale';
import styles from './Timeline.module.css';

/** Default plot height; the Timeline passes the room it has. */
export const GRAPH_HEIGHT = 160;
export const GRAPH_MIN_HEIGHT = 60;
const PAD = 14;

type Intents = ReturnType<typeof timelineIntents>;

const fmtValue = (v: number) => (Math.abs(v) >= 100 ? String(Math.round(v)) : String(Number(v.toFixed(2))));

export function GraphEditor({ intents, height = GRAPH_HEIGHT }: { intents: Intents; height?: number }) {
  const H = Math.max(GRAPH_MIN_HEIGHT, height);
  const [focusProp, setFocusProp] = useState<AnimatableProperty | null>(null);
  const state = useEditor((s) => s);
  const vm = useMemo(() => graphViewModel(state, focusProp), [state, focusProp]);
  const { timeToX } = useTimelineScale();
  const width = timeToX(Math.max(vm.duration, ...vm.curves.flatMap((c) => c.keys.map((k) => k.time)))) + 2 * PAD;
  const { min, max } = vm.range;
  const yOf = useMemo(() => (v: number) => PAD + ((max - v) / (max - min)) * (H - 2 * PAD), [min, max, H]);
  const xOf = (t: number) => timeToX(t);
  const pt = (p: GraphPoint, y = yOf) => `${xOf(p.time)},${y(p.value)}`;

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
  const ticks = valueTicks(min, max);
  const otherCurve = (c: GraphCurveVM) => {
    const r = paddedRange(c.min, c.max);
    const y = (v: number) => PAD + ((r.max - v) / (r.max - r.min)) * (H - 2 * PAD);
    return <polyline key={c.property} className={styles.graphCurveFaint} points={c.samples.map((p) => pt(p, y)).join(' ')} data-testid={`graph-curve-${c.property}`} />;
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
      </div>
      <div className={styles.graphBody} style={{ height: H }}>
        <div className={styles.graphAxis} style={{ width: TRACK_LABEL_WIDTH }}>
          {ticks.map((v) => (
            <span key={v} className={styles.graphTick} style={{ top: yOf(v) }}>
              {fmtValue(v)}
            </span>
          ))}
        </div>
        <svg className={styles.graphSvg} width="100%" style={{ minWidth: width }} height={H} data-testid="graph-svg" data-min={min} data-max={max}>
          {ticks.map((v) => (
            <line key={v} className={styles.graphGrid} x1={0} x2="100%" y1={yOf(v)} y2={yOf(v)} />
          ))}
          {vm.curves.filter((c) => c !== focus).map(otherCurve)}
          <polyline className={styles.graphCurve} points={focus.samples.map((p) => pt(p)).join(' ')} data-testid={`graph-curve-${focus.property}`} />
          {focus.segments.map((sg) => (
            <g key={sg.index} data-testid={`graph-segment-${sg.index}`}>
              <line className={styles.graphHandleLine} x1={xOf(sg.from.time)} y1={yOf(sg.from.value)} x2={xOf(sg.handleOut.time)} y2={yOf(sg.handleOut.value)} />
              <line className={styles.graphHandleLine} x1={xOf(sg.to.time)} y1={yOf(sg.to.value)} x2={xOf(sg.handleIn.time)} y2={yOf(sg.handleIn.value)} />
              <circle className={styles.graphHandle} r={4} cx={xOf(sg.handleOut.time)} cy={yOf(sg.handleOut.value)} data-testid={`graph-handle-out-${sg.index}`} />
              <circle className={styles.graphHandle} r={4} cx={xOf(sg.handleIn.time)} cy={yOf(sg.handleIn.value)} data-testid={`graph-handle-in-${sg.index}`} />
            </g>
          ))}
          {focus.keys.map((k) => (
            <rect
              key={k.time}
              className={`${styles.graphKey} ${k.selected ? styles.graphKeySelected : ''}`}
              x={xOf(k.time) - 5}
              y={yOf(k.value) - 5}
              width={10}
              height={10}
              transform={`rotate(45 ${xOf(k.time)} ${yOf(k.value)})`}
              data-testid={`graph-key-${focus.property}-${k.time}`}
              aria-label={`${focus.label} keyframe at ${k.time}s, value ${fmtValue(k.value)}`}
              onPointerDown={(e) => {
                if (vm.locked) return;
                e.stopPropagation();
                intents.selectKeyframe({ objectId: vm.objectId!, property: focus.property, time: k.time });
              }}
            />
          ))}
        </svg>
      </div>
    </div>
  );
}
