import { useEffect, useMemo, useRef } from 'react';
import { snapToFrame } from '@savig/engine';
import { store } from '@savig/editor-state';
import { timelineViewModel, timelineIntents } from '@savig/ui-core';
import { useEditorVM } from '../../store/store';
import { timeToX, xToTime } from './scale';
import styles from './Timeline.module.css';

export function Timeline() {
  const vm = useEditorVM(timelineViewModel);
  const intents = useMemo(() => timelineIntents(store), []);

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
  }, [vm.fps, intents]);

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
      </div>
      <div className={styles.scroll}>
        <div
          className={styles.ruler}
          data-testid="timeline-ruler"
          onPointerDown={(e) => scrub(e.clientX, e.currentTarget.getBoundingClientRect().left)}
        />
        <div className={styles.rows}>
          {vm.rows.map((row) => (
            <div key={row.id} className={`${styles.row} ${row.ownLocked ? styles.locked : ''}`} data-testid={`track-row-${row.id}`}>
              <div
                className={`${styles.label} ${row.selected ? styles.labelSelected : ''}`}
                data-testid={`track-label-${row.id}`}
                onClick={() => {
                  if (!row.locked) intents.selectObject(row.id);
                }}
              >
                {row.name}
              </div>
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
            </div>
          ))}
        </div>
        <div className={styles.audioRow}>
          <div className={styles.label}>♪ Audio</div>
          <div className={styles.lane}>
            {vm.audioClips.map((clip) => (
              <div
                key={clip.id}
                className={styles.clip}
                data-testid={`audio-clip-${clip.id}`}
                style={{
                  left: `${timeToX(clip.startTime)}px`,
                  width: `${Math.max(2, timeToX(clip.duration))}px`,
                }}
              />
            ))}
          </div>
        </div>
        <div className={styles.playhead} data-testid="playhead" style={{ left: `${timeToX(vm.time)}px` }} />
      </div>
    </div>
  );
}
