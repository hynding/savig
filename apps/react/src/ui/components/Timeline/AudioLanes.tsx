import { useEffect, useRef, useState } from 'react';
import { snapToFrame } from '@savig/engine';
import type { TimelineAudioClipVM, TimelineVM, timelineIntents } from '@savig/ui-core';
import { timeToX, xToTime, TRACK_LABEL_WIDTH } from './scale';
import { useEditor } from '../../store/store';
import { getPeaks } from '../../audio/decode';
import styles from './Timeline.module.css';

const WAVEFORM_BINS = 128;

// Mirrored silhouette of the clip's source slice (inPoint..outPoint as a fraction of the asset's
// full duration), stretched to fill the clip's on-screen width. Reads `binaries` off the store
// the same way the playback transport does; `getPeaks` is cached by assetId:bins (content-
// addressed assets → never stale) and decodes via OfflineAudioContext, which jsdom lacks — so a
// rejected/missing result must render nothing, never throw.
function ClipWaveform({ clip }: { clip: TimelineAudioClipVM }) {
  const bytes = useEditor((s) => s.binaries[clip.assetId]);
  const [data, setData] = useState<{ peaks: Float32Array; duration: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    if (!bytes) return;
    getPeaks(clip.assetId, bytes, WAVEFORM_BINS).then((result) => {
      if (!cancelled) setData(result);
    });
    return () => {
      cancelled = true;
    };
  }, [clip.assetId, bytes]);

  if (!data || data.duration <= 0) return null;
  const { peaks, duration } = data;
  // Window: source-fraction of the ASSET the clip plays = inPoint/duration .. outPoint/duration.
  const from = Math.max(0, Math.floor((clip.inPoint / duration) * WAVEFORM_BINS));
  const to = Math.min(WAVEFORM_BINS, Math.max(from + 1, Math.ceil((clip.outPoint / duration) * WAVEFORM_BINS)));
  const slice = peaks.slice(from, to);
  if (slice.length === 0) return null;

  // Stretch the windowed slice across the full 0..128 viewBox width; mirror top/bottom around y=1.
  const stepX = WAVEFORM_BINS / slice.length;
  const top = Array.from(slice, (v, i) => `L ${i * stepX} ${1 - v}`).join(' ');
  const bottom = Array.from(slice)
    .reverse()
    .map((v, i) => `L ${(slice.length - 1 - i) * stepX} ${1 + v}`)
    .join(' ');
  const d = `M 0 1 ${top} L ${WAVEFORM_BINS} 1 ${bottom} Z`;

  return (
    <svg
      className={styles.waveform}
      viewBox={`0 0 ${WAVEFORM_BINS} 2`}
      preserveAspectRatio="none"
      data-testid={`clip-waveform-${clip.id}`}
    >
      <path d={d} />
    </svg>
  );
}

// Must match `.audioLane`'s `height` in Timeline.module.css — used to convert a vertical drag
// distance into a number of lanes stepped (reassign-lane gesture).
const LANE_HEIGHT = 34;
// Must match `.clip`'s `height` in Timeline.module.css — used to size the fade-overlay SVG.
const CLIP_HEIGHT = 20;
// Pointer-down inside this many px of a clip's left/right edge starts a trim drag instead of a
// move drag (mirrors a resize-handle hit zone).
const EDGE_ZONE_PX = 6;

type DragMode = 'move' | 'trim-start' | 'trim-end' | 'fade-in' | 'fade-out';

interface Drag {
  clipId: string;
  mode: DragMode;
  el: HTMLElement;
  startX: number;
  startY: number;
  startTime: number;
  inPoint: number;
  outPoint: number;
  fadeIn: number;
  fadeOut: number;
  laneIndex: number;
}

interface AudioLanesProps {
  vm: Pick<TimelineVM, 'audioTracks' | 'fps'>;
  intents: ReturnType<typeof timelineIntents>;
}

// Per-lane row: header (name, M, S, gain, pan) + clip lane. Drag semantics:
// clip-body horizontal drag = retime (setAudioClipTiming.startTime, frame-snapped like keyframes);
// clip-body VERTICAL drag ≥ half a lane height = reassign lane on release (setAudioClipTrack);
// 6px edge zones = trim (inPoint on left edge, outPoint on right; the body keeps startTime).
// The drag pattern copies Timeline's keyframe drag: pointerdown captures, window move previews
// imperatively via style.left/width, pointerup commits ONE store action (single undo entry).
export function AudioLanes({ vm, intents }: AudioLanesProps) {
  const [editingTrackId, setEditingTrackId] = useState<string | null>(null);
  const dragRef = useRef<Drag | null>(null);

  const startDrag = (e: React.PointerEvent, clip: TimelineAudioClipVM, laneIndex: number) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const mode: DragMode =
      offsetX <= EDGE_ZONE_PX ? 'trim-start' : offsetX >= rect.width - EDGE_ZONE_PX ? 'trim-end' : 'move';
    dragRef.current = {
      clipId: clip.id,
      mode,
      el: e.currentTarget as HTMLElement,
      startX: e.clientX,
      startY: e.clientY,
      startTime: clip.startTime,
      inPoint: clip.inPoint,
      outPoint: clip.outPoint,
      fadeIn: clip.fadeIn,
      fadeOut: clip.fadeOut,
      laneIndex,
    };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    e.stopPropagation();
  };

  // Fade-handle drag (task 5): a dedicated start distinct from `startDrag` because it fires on
  // the small corner-triangle handles, not the clip body — pointerdown MUST stopPropagation so
  // it never also starts a clip move/trim drag (the handles are nested inside the clip div).
  const startFadeDrag = (e: React.PointerEvent, clip: TimelineAudioClipVM, mode: 'fade-in' | 'fade-out', laneIndex: number) => {
    dragRef.current = {
      clipId: clip.id,
      mode,
      el: e.currentTarget as HTMLElement,
      startX: e.clientX,
      startY: e.clientY,
      startTime: clip.startTime,
      inPoint: clip.inPoint,
      outPoint: clip.outPoint,
      fadeIn: clip.fadeIn,
      fadeOut: clip.fadeOut,
      laneIndex,
    };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    e.stopPropagation();
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const deltaX = e.clientX - d.startX;
      if (d.mode === 'trim-start') {
        const newIn = d.inPoint + xToTime(deltaX);
        d.el.style.width = `${Math.max(2, timeToX(d.outPoint - newIn))}px`;
      } else if (d.mode === 'trim-end') {
        const newOut = d.outPoint + xToTime(deltaX);
        d.el.style.width = `${Math.max(2, timeToX(newOut - d.inPoint))}px`;
      } else if (d.mode === 'move') {
        const newStart = Math.max(0, snapToFrame(d.startTime + xToTime(deltaX), vm.fps));
        d.el.style.left = `${timeToX(newStart)}px`;
        const deltaY = e.clientY - d.startY;
        d.el.style.transform = `translateY(${deltaY}px)`;
      }
      // fade-in/fade-out: no imperative preview during the drag — the fade overlay re-derives
      // from the store's committed value on pointerup (kept simple; "optional" per spec).
    };
    const onUp = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      d.el.style.transform = '';
      const deltaX = e.clientX - d.startX;
      if (d.mode === 'trim-start') {
        const newIn = d.inPoint + xToTime(deltaX);
        if (Math.abs(newIn - d.inPoint) > 1e-9) intents.setAudioClipTiming(d.clipId, { inPoint: newIn });
      } else if (d.mode === 'trim-end') {
        const newOut = d.outPoint + xToTime(deltaX);
        if (Math.abs(newOut - d.outPoint) > 1e-9) intents.setAudioClipTiming(d.clipId, { outPoint: newOut });
      } else if (d.mode === 'fade-in') {
        const newFadeIn = Math.max(0, d.fadeIn + xToTime(deltaX));
        if (Math.abs(newFadeIn - d.fadeIn) > 1e-9) intents.setAudioClipFades(d.clipId, { fadeIn: newFadeIn });
      } else if (d.mode === 'fade-out') {
        const newFadeOut = Math.max(0, d.fadeOut - xToTime(deltaX));
        if (Math.abs(newFadeOut - d.fadeOut) > 1e-9) intents.setAudioClipFades(d.clipId, { fadeOut: newFadeOut });
      } else {
        const deltaY = e.clientY - d.startY;
        if (Math.abs(deltaY) >= LANE_HEIGHT / 2) {
          const step = Math.sign(deltaY) * Math.max(1, Math.round(Math.abs(deltaY) / LANE_HEIGHT));
          const newIndex = Math.max(0, Math.min(vm.audioTracks.length - 1, d.laneIndex + step));
          const newTrackId = vm.audioTracks[newIndex]?.id ?? null;
          if (vm.audioTracks[d.laneIndex]?.id !== newTrackId) intents.setAudioClipTrack(d.clipId, newTrackId);
        } else {
          const newStart = Math.max(0, snapToFrame(d.startTime + xToTime(deltaX), vm.fps));
          if (Math.abs(newStart - d.startTime) > 1e-9) intents.setAudioClipTiming(d.clipId, { startTime: newStart });
        }
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [vm.fps, vm.audioTracks, intents]);

  return (
    <div className={styles.audioLanes}>
      <div className={styles.audioLanesHeader}>
        <span className={styles.audioLanesTitle}>♪ Audio</span>
        <button className={styles.toggle} data-testid="add-audio-track" onClick={() => intents.addAudioTrack()}>
          + Track
        </button>
      </div>
      {vm.audioTracks.map((lane, laneIndex) => (
        <div
          key={lane.id ?? 'default'}
          className={`${styles.audioLane} ${lane.selected ? styles.laneSelected : ''}`}
          data-testid={`audio-lane-${lane.id ?? 'default'}`}
          aria-selected={lane.selected}
        >
          <div className={styles.laneHeader} style={{ width: TRACK_LABEL_WIDTH }}>
            <div
              className={styles.laneName}
              // Click selects the lane; clicking the ALREADY-selected lane again toggles it off
              // (deselect) — the only way to leave the Inspector's Track panel today. The default
              // lane (id null) is never selectable. Scoped to just this name/spacer region (NOT
              // the whole laneHeader) so it never fires from the Mute/Solo buttons or the
              // gain/pan sliders nested alongside it (review finding: those would otherwise
              // bubble a click here and flicker the selection on every M/S/gain/pan interaction).
              onClick={() => { if (lane.id !== null) intents.selectAudioTrack(lane.selected ? null : lane.id); }}
            >
              {lane.id === null ? (
                <span className={styles.label}>{lane.name}</span>
              ) : editingTrackId === lane.id ? (
                <input
                  className={styles.renameInput}
                  data-testid={`audio-track-rename-${lane.id}`}
                  defaultValue={lane.name}
                  autoFocus
                  onBlur={(e) => { intents.renameAudioTrack(lane.id!, e.currentTarget.value); setEditingTrackId(null); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                    if (e.key === 'Escape') setEditingTrackId(null);
                  }}
                />
              ) : (
                <span className={styles.label} onDoubleClick={() => setEditingTrackId(lane.id)}>
                  {lane.name}
                </span>
              )}
            </div>
            {lane.id !== null && (
              <div className={styles.laneControls}>
                <button
                  className={styles.toggle}
                  aria-pressed={lane.muted}
                  data-testid={`audio-track-mute-${lane.id}`}
                  onClick={() => intents.setAudioTrackProps(lane.id!, { muted: !lane.muted })}
                >
                  M
                </button>
                <button
                  className={styles.toggle}
                  aria-pressed={lane.solo}
                  data-testid={`audio-track-solo-${lane.id}`}
                  onClick={() => intents.setAudioTrackProps(lane.id!, { solo: !lane.solo })}
                >
                  S
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={lane.gain}
                  aria-label={`${lane.name} gain`}
                  data-testid={`audio-track-gain-${lane.id}`}
                  onChange={(e) => intents.setAudioTrackProps(lane.id!, { gain: Number(e.target.value) })}
                />
                <input
                  type="range"
                  min={-1}
                  max={1}
                  step={0.01}
                  value={lane.pan}
                  aria-label={`${lane.name} pan`}
                  data-testid={`audio-track-pan-${lane.id}`}
                  onChange={(e) => intents.setAudioTrackProps(lane.id!, { pan: Number(e.target.value) })}
                />
              </div>
            )}
          </div>
          <div className={styles.lane}>
            {lane.clips.map((clip) => {
              const widthPx = Math.max(2, timeToX(clip.duration));
              const fadeInPx = Math.min(widthPx, timeToX(clip.fadeIn));
              const fadeOutPx = Math.min(widthPx, timeToX(clip.fadeOut));
              return (
                <div
                  key={clip.id}
                  className={styles.clip}
                  data-testid={`audio-clip-${clip.id}`}
                  style={{
                    left: `${timeToX(clip.startTime)}px`,
                    width: `${widthPx}px`,
                  }}
                  onPointerDown={(e) => startDrag(e, clip, laneIndex)}
                >
                  <ClipWaveform clip={clip} />
                  {(clip.fadeIn > 0 || clip.fadeOut > 0) && (
                    <svg
                      className={styles.fadeOverlay}
                      data-testid={`fade-overlay-${clip.id}`}
                      viewBox={`0 0 ${widthPx} ${CLIP_HEIGHT}`}
                      preserveAspectRatio="none"
                    >
                      {clip.fadeIn > 0 && (
                        <polyline points={`0,${CLIP_HEIGHT} ${fadeInPx},0`} />
                      )}
                      {clip.fadeOut > 0 && (
                        <polyline points={`${widthPx - fadeOutPx},0 ${widthPx},${CLIP_HEIGHT}`} />
                      )}
                    </svg>
                  )}
                  <div
                    className={`${styles.fadeHandle} ${styles.fadeHandleIn}`}
                    data-testid={`fade-in-handle-${clip.id}`}
                    onPointerDown={(e) => startFadeDrag(e, clip, 'fade-in', laneIndex)}
                  />
                  <div
                    className={`${styles.fadeHandle} ${styles.fadeHandleOut}`}
                    data-testid={`fade-out-handle-${clip.id}`}
                    onPointerDown={(e) => startFadeDrag(e, clip, 'fade-out', laneIndex)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
