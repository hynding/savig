import { useEffect, useRef } from 'react';
import { advance, computeProjectDuration, createClock, pause } from '../../engine';
import type { ClockState } from '../../engine';
import { useEditor } from '../store/store';
import { applyFrame } from './applyFrame';

type Raf = (cb: (t: number) => void) => number;
type Caf = (handle: number) => void;

// RAF transport. While `playing`, advances a local authoritative ClockState,
// paints each frame imperatively via applyFrame, and mirrors the time into the
// store for the playhead UI. The scheduler is injectable for deterministic tests.
export function usePlayback(
  getNodes: () => Map<string, SVGGraphicsElement>,
  raf: Raf = requestAnimationFrame,
  caf: Caf = cancelAnimationFrame,
): void {
  const playing = useEditor((s) => s.playing);
  const clockRef = useRef<ClockState>(createClock());
  const handleRef = useRef<number | null>(null);

  useEffect(() => {
    if (!playing) {
      if (handleRef.current !== null) caf(handleRef.current);
      handleRef.current = null;
      // Re-anchor from the store's current playhead for the next play.
      clockRef.current = { ...createClock(), time: useEditor.getState().time };
      return;
    }

    // Start: a fresh playing clock at the current playhead. lastTimestamp stays
    // null so the first tick anchors to the real RAF timestamp (advance treats
    // null as the anchor frame and advances 0 that tick).
    clockRef.current = { time: useEditor.getState().time, playing: true, lastTimestamp: null };

    const tick = (tMs: number): void => {
      const project = useEditor.getState().history.present;
      const duration = computeProjectDuration(project);
      clockRef.current = advance(clockRef.current, tMs / 1000, duration, project.meta.loop);
      applyFrame(getNodes(), project, clockRef.current.time);
      useEditor.setState({ time: clockRef.current.time });
      if (clockRef.current.playing) {
        handleRef.current = raf(tick);
      } else {
        clockRef.current = pause(clockRef.current);
        useEditor.getState().setPlaying(false);
      }
    };

    handleRef.current = raf(tick);
    return () => {
      if (handleRef.current !== null) caf(handleRef.current);
      handleRef.current = null;
    };
  }, [playing, getNodes, raf, caf]);
}
