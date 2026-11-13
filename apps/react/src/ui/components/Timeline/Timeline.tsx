import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { snapToFrame } from '@savig/engine';
import { store } from '@savig/editor-state';
import { timelineViewModel, timelineIntents } from '@savig/ui-core';
import { useEditorVM } from '../../store/store';
import { makeTimelineScale, rulerLabelStep, TimelineScaleContext, MIN_FRAME_LABEL_PX, PX_PER_SECOND, TRACK_LABEL_WIDTH } from './scale';
import { AudioLanes } from './AudioLanes';
import { FrameStrip } from './FrameStrip';
import styles from './Timeline.module.css';

// Ruler second labels: whole seconds as M:SS (0:00, 0:01, …).
const formatSecond = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function Timeline() {
  const vm = useEditorVM(timelineViewModel);
  const intents = useMemo(() => timelineIntents(store), []);
  // Frame-by-frame layers start collapsed; expanding one lists the drawing exposed at the
  // playhead as ordinary rows (spec §Timeline). View-only state, so it lives here.
  const [expandedFrameLayers, setExpandedFrameLayers] = useState<ReadonlySet<string>>(new Set());
  const toggleFrameLayer = (id: string) =>
    setExpandedFrameLayers((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // Horizontal zoom (store pref) → one shared time↔px mapping for every surface below.
  const scale = useMemo(() => makeTimelineScale(vm.timelineZoom), [vm.timelineZoom]);
  const { timeToX, xToTime, pxPerSecond } = scale;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Zoom keeps one instant fixed on screen: the pointer's time for Ctrl/⌘+wheel, otherwise the
  // playhead (when visible) or the left edge. Recorded before the zoom changes, applied after.
  const anchorRef = useRef<{ time: number; screenX: number } | null>(null);
  const anchorAt = (screenX: number) => {
    const el = scrollRef.current;
    if (!el) return;
    anchorRef.current = { time: Math.max(0, xToTime(el.scrollLeft + screenX - TRACK_LABEL_WIDTH)), screenX };
  };
  const anchorOnPlayhead = () => {
    const el = scrollRef.current;
    if (!el) return;
    const playheadX = TRACK_LABEL_WIDTH + timeToX(vm.time) - el.scrollLeft;
    const visible = playheadX >= TRACK_LABEL_WIDTH && playheadX <= el.clientWidth;
    anchorAt(visible ? playheadX : TRACK_LABEL_WIDTH);
  };
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const a = anchorRef.current;
    anchorRef.current = null;
    if (!el || !a) return;
    el.scrollLeft = Math.max(0, TRACK_LABEL_WIDTH + a.time * pxPerSecond - a.screenX);
  }, [pxPerSecond]);
  const zoomBy = (direction: 1 | -1) => {
    anchorOnPlayhead();
    if (direction > 0) intents.zoomTimelineIn();
    else intents.zoomTimelineOut();
  };
  const resetZoom = () => {
    anchorOnPlayhead();
    intents.setTimelineZoom(1);
  };
  const fitZoom = () => {
    const el = scrollRef.current;
    if (!el) return;
    const span = Math.max(vm.duration, 1 / vm.fps);
    anchorRef.current = { time: 0, screenX: TRACK_LABEL_WIDTH };
    intents.setTimelineZoom((el.clientWidth - TRACK_LABEL_WIDTH - 12) / (span * PX_PER_SECOND));
  };
  // Ctrl/⌘ + wheel zooms around the pointer. Native listener: React's wheel handler is passive,
  // so it can't stop the browser's own page zoom.
  const wheelState = useRef({ zoom: vm.timelineZoom, anchorAt, setZoom: intents.setTimelineZoom });
  wheelState.current = { zoom: vm.timelineZoom, anchorAt, setZoom: intents.setTimelineZoom };
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const w = wheelState.current;
      w.anchorAt(e.clientX - el.getBoundingClientRect().left);
      w.setZoom(w.zoom * Math.exp(-e.deltaY * 0.002));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  const labelStep = rulerLabelStep(pxPerSecond);
  const frameLabels = vm.fps > 0 && pxPerSecond / vm.fps >= MIN_FRAME_LABEL_PX;

  const visibleRows = vm.rows.filter((r) => r.exposed && r.frameOwnerIds.every((id) => expandedFrameLayers.has(id)));

  const scrub = (clientX: number, rulerLeft: number) => {
    intents.seek(snapToFrame(xToTime(Math.max(0, clientX - rulerLeft)), vm.fps));
  };

  // Drag a keyframe diamond horizontally to retime it. The diamond's onPointerDown
  // selects the keyframe (so retimeSelectedKeyframe acts on it) and starts the drag.
  const dragRef = useRef<{ startTime: number; startX: number; el: HTMLElement } | null>(null);
  const startKeyframeDrag = (e: React.PointerEvent, startTime: number) => {
    dragRef.current = { startTime, startX: e.clientX, el: e.currentTarget as HTMLElement };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  useEffect(() => {
    const timeFor = (clientX: number, d: { startTime: number; startX: number }) =>
      Math.max(0, snapToFrame(d.startTime + xToTime(clientX - d.startX), vm.fps));
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      d.el.style.left = `${timeToX(timeFor(e.clientX, d))}px`; // imperative frame-snapped preview
    };
    const onUp = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      const t = timeFor(e.clientX, d);
      if (Math.abs(t - d.startTime) > 1e-9) intents.retimeSelectedKeyframe(t); // skip a pure click (no move)
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [vm.fps, intents, timeToX, xToTime]);

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <button
          className={`${styles.toggle} ${vm.autoKey ? styles.on : ''}`}
          aria-pressed={vm.autoKey}
          onClick={intents.toggleAutoKey}
        >
          Auto-key
        </button>
        <button
          className={`${styles.toggle} ${vm.onionSkin ? styles.on : ''}`}
          aria-pressed={vm.onionSkin}
          onClick={intents.toggleOnionSkin}
        >
          Onion
        </button>
        <button
          className={`${styles.toggle} ${vm.snapEnabled ? styles.on : ''}`}
          aria-pressed={vm.snapEnabled}
          onClick={intents.toggleSnap}
        >
          Snap
        </button>
        <button
          className={`${styles.toggle} ${vm.gridEnabled ? styles.on : ''}`}
          aria-pressed={vm.gridEnabled}
          onClick={intents.toggleGrid}
        >
          Grid
        </button>
        <button
          className={`${styles.toggle} ${vm.frameEnabled ? styles.on : ''}`}
          aria-pressed={vm.frameEnabled}
          onClick={intents.toggleFrame}
        >
          Frame
        </button>
        {vm.gridEnabled && (
          <input
            type="number"
            min={1}
            className={styles.gridSize}
            aria-label="Grid size"
            value={vm.gridSize}
            onChange={(e) => intents.setGridSize(Number(e.target.value))}
          />
        )}
        <div className={styles.zoomControls} role="group" aria-label="Timeline zoom">
          <button className={styles.toggle} aria-label="Zoom timeline out" title="Zoom timeline out (Ctrl/⌘ + wheel)" onClick={() => zoomBy(-1)}>
            −
          </button>
          <button className={styles.zoomReadout} aria-label="Reset timeline zoom" title="Reset timeline zoom to 100%" data-testid="timeline-zoom" onClick={resetZoom}>
            {Math.round(vm.timelineZoom * 100)}%
          </button>
          <button className={styles.toggle} aria-label="Zoom timeline in" title="Zoom timeline in (Ctrl/⌘ + wheel)" onClick={() => zoomBy(1)}>
            +
          </button>
          <button className={styles.toggle} title="Fit the whole timeline in view" onClick={fitZoom}>
            Fit
          </button>
        </div>
      </div>
      <TimelineScaleContext.Provider value={scale}>
      <div className={styles.scroll} ref={scrollRef} data-testid="timeline-scroll">
        <div
          className={styles.ruler}
          data-testid="timeline-ruler"
          style={{
            backgroundImage: scale.frameTickBackground(vm.fps),
            minWidth: timeToX(vm.duration),
            // Time 0 lives at the lane origin, past each row's label column — shift the
            // ruler so its ticks/labels sit over lane content. Scrub stays correct: it
            // measures clientX against the ruler's own (shifted) left edge.
            marginLeft: TRACK_LABEL_WIDTH,
          }}
          onPointerDown={(e) => scrub(e.clientX, e.currentTarget.getBoundingClientRect().left)}
        >
          {Array.from({ length: Math.floor(vm.duration / labelStep) + 1 }, (_, i) => i * labelStep).map((s) => (
            <span
              key={s}
              className={styles.secondLabel}
              data-testid={`ruler-second-${s}`}
              style={{ left: `${timeToX(s)}px` }}
            >
              {formatSecond(s)}
            </span>
          ))}
          {frameLabels &&
            // Zoomed in to cell-by-cell work: number every frame that isn't a whole second (1-based,
            // matching the frame strip's "Frame N" tooltips).
            Array.from({ length: Math.floor(vm.duration * vm.fps + 1e-6) }, (_, n) => n)
              .filter((n) => n % vm.fps !== 0)
              .map((n) => (
                <span key={`f${n}`} className={styles.frameNumber} data-testid={`ruler-frame-${n + 1}`} style={{ left: `${timeToX(n / vm.fps)}px` }}>
                  {n + 1}
                </span>
              ))}
        </div>
        <div className={styles.rows}>
          {visibleRows.map((row) => (
            <div key={row.id} className={`${styles.row} ${row.ownLocked ? styles.locked : ''}`} data-testid={`track-row-${row.id}`}>
              <div
                className={`${styles.label} ${row.selected ? styles.labelSelected : ''}`}
                data-testid={`track-label-${row.id}`}
                style={row.frameOwnerIds.length ? { paddingLeft: `calc(var(--space-2) + ${row.frameOwnerIds.length * 10}px)` } : undefined}
                onClick={() => {
                  if (!row.locked) intents.selectObject(row.id);
                }}
              >
                {row.frameLayer && (
                  <button
                    className={styles.frameToggle}
                    data-testid={`frame-toggle-${row.id}`}
                    aria-expanded={expandedFrameLayers.has(row.id)}
                    aria-label={expandedFrameLayers.has(row.id) ? 'Collapse frame layer' : 'Expand frame layer'}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFrameLayer(row.id);
                    }}
                  >
                    {expandedFrameLayers.has(row.id) ? '▾' : '▸'}
                  </button>
                )}
                {row.name}
              </div>
              {row.frameLayer ? (
                <FrameStrip layerId={row.id} strip={row.frameLayer} fps={vm.fps} locked={row.locked} intents={intents} />
              ) : (
              <div className={styles.lane}>
                {row.scalarTracks.flatMap((track) =>
                  track.keyframes.map((kf) => (
                    <div
                      key={`${track.property}-${kf.time}`}
                      className={`${styles.diamond} ${kf.selected ? styles.diamondSelected : ''}`}
                      data-testid={`keyframe-${row.id}-${track.property}-${kf.time}`}
                      style={{ left: `${timeToX(kf.time)}px` }}
                      onPointerDown={(e) => {
                        if (row.locked) return;
                        e.stopPropagation();
                        intents.selectKeyframe({ objectId: row.id, property: track.property, time: kf.time });
                        startKeyframeDrag(e, kf.time);
                      }}
                    />
                  )),
                )}
                {row.shapeKeyframes.map((kf) => (
                  <div
                    key={`shape-${kf.time}`}
                    className={`${styles.diamond} ${styles.shapeDiamond} ${kf.selected ? styles.diamondSelected : ''}`}
                    data-testid={`shape-keyframe-${row.id}-${kf.time}`}
                    style={{ left: `${timeToX(kf.time)}px` }}
                    onPointerDown={(e) => {
                      if (row.locked) return;
                      e.stopPropagation();
                      intents.selectShapeKeyframe({ objectId: row.id, time: kf.time });
                      startKeyframeDrag(e, kf.time);
                    }}
                  />
                ))}
                {row.colorTracks.flatMap((track) =>
                  track.keyframes.map((kf) => (
                    <div
                      key={`color-${track.property}-${kf.time}`}
                      className={`${styles.diamond} ${styles.colorDiamond} ${kf.selected ? styles.diamondSelected : ''}`}
                      data-testid={`color-keyframe-${row.id}-${track.property}-${kf.time}`}
                      style={{ left: `${timeToX(kf.time)}px` }}
                      onPointerDown={(e) => {
                        if (row.locked) return;
                        e.stopPropagation();
                        intents.selectColorKeyframe({ objectId: row.id, property: track.property, time: kf.time });
                        startKeyframeDrag(e, kf.time);
                      }}
                    />
                  )),
                )}
                {row.gradientTracks.flatMap((track) =>
                  track.keyframes.map((kf) => (
                    <div
                      key={`gradient-${track.property}-${kf.time}`}
                      className={`${styles.diamond} ${styles.gradientDiamond} ${kf.selected ? styles.diamondSelected : ''}`}
                      data-testid={`gradient-keyframe-${row.id}-${track.property}-${kf.time}`}
                      style={{ left: `${timeToX(kf.time)}px` }}
                      onPointerDown={(e) => {
                        if (row.locked) return;
                        e.stopPropagation();
                        intents.selectGradientKeyframe({ objectId: row.id, property: track.property, time: kf.time });
                        startKeyframeDrag(e, kf.time);
                      }}
                    />
                  )),
                )}
                {row.dashKeyframes.map((kf) => (
                  <div
                    key={`dash-${kf.time}`}
                    className={`${styles.diamond} ${styles.dashDiamond} ${kf.selected ? styles.diamondSelected : ''}`}
                    data-testid={`dash-keyframe-${row.id}-${kf.time}`}
                    style={{ left: `${timeToX(kf.time)}px` }}
                    onPointerDown={(e) => {
                      if (row.locked) return;
                      e.stopPropagation();
                      intents.selectDashKeyframe({ objectId: row.id, time: kf.time });
                      startKeyframeDrag(e, kf.time);
                    }}
                  />
                ))}
                {row.trimTracks.map((t) =>
                  t.keyframes.map((kf) => (
                    <div
                      key={`trim-${t.prop}-${kf.time}`}
                      className={`${styles.diamond} ${styles.dashDiamond} ${kf.selected ? styles.diamondSelected : ''}`}
                      data-testid={`trim-keyframe-${t.prop}-${row.id}-${kf.time}`}
                      style={{ left: `${timeToX(kf.time)}px` }}
                      onPointerDown={(e) => {
                        if (row.locked) return;
                        e.stopPropagation();
                        intents.selectTrimKeyframe({ objectId: row.id, prop: t.prop, time: kf.time });
                        startKeyframeDrag(e, kf.time);
                      }}
                    />
                  )),
                )}
                {row.filterTracks.map((t) =>
                  t.keyframes.map((kf) => (
                    <div
                      key={`filter-${t.key}-${kf.time}`}
                      className={`${styles.diamond} ${styles.filterDiamond} ${kf.selected ? styles.diamondSelected : ''}`}
                      data-testid={`filter-keyframe-${t.key}-${row.id}-${kf.time}`}
                      title={t.label}
                      style={{ left: `${timeToX(kf.time)}px` }}
                      onPointerDown={(e) => {
                        if (row.locked) return;
                        e.stopPropagation();
                        intents.selectFilterKeyframe({ objectId: row.id, key: t.key, time: kf.time });
                        startKeyframeDrag(e, kf.time);
                      }}
                    />
                  )),
                )}
                {row.progressKeyframes.map((kf) => (
                  <div
                    key={`progress-${kf.time}`}
                    className={`${styles.diamond} ${styles.progressDiamond} ${kf.selected ? styles.diamondSelected : ''}`}
                    data-testid={`progress-keyframe-${row.id}-${kf.time}`}
                    style={{ left: `${timeToX(kf.time)}px` }}
                    onPointerDown={(e) => {
                      if (row.locked) return;
                      e.stopPropagation();
                      intents.selectProgressKeyframe({ objectId: row.id, time: kf.time });
                      startKeyframeDrag(e, kf.time);
                    }}
                  />
                ))}
                {row.remapKeyframes.map((kf) => (
                  <div
                    key={`remap-${kf.time}`}
                    className={`${styles.diamond} ${styles.remapDiamond} ${kf.selected ? styles.diamondSelected : ''}`}
                    data-testid={`remap-keyframe-${row.id}-${kf.time}`}
                    style={{ left: `${timeToX(kf.time)}px` }}
                    onPointerDown={(e) => {
                      if (row.locked) return;
                      e.stopPropagation();
                      intents.selectRemapKeyframe({ objectId: row.id, time: kf.time });
                      startKeyframeDrag(e, kf.time);
                    }}
                  />
                ))}
              </div>
              )}
            </div>
          ))}
        </div>
        <AudioLanes vm={vm} intents={intents} />
        <div
          className={styles.playhead}
          data-testid="playhead"
          style={{ left: `${TRACK_LABEL_WIDTH + timeToX(vm.time)}px` }}
        />
      </div>
      </TimelineScaleContext.Provider>
    </div>
  );
}
