import { useEffect, useRef } from 'react';
import { advance, createClock, pause } from '../../engine';
import type { ClockState } from '../../engine';
import { useEditor } from '../store/store';
import { selectEditDuration } from '../store/selectors';
import { applyFrame } from './applyFrame';
import { createAudioTransport, type AudioTransport } from './audioTransport';

type Raf = (cb: (t: number) => void) => number;
type Caf = (handle: number) => void;

// RAF transport, owning audio playback. While `playing` it paints each frame
// imperatively via applyFrame and mirrors the time into the store for the
// playhead UI. The clock is mastered by the AudioContext when audio is playing
// (spec §4) — the visual loop follows `transport.position()` so visuals stay in
// sync with audio — and falls back to the wall clock otherwise. The scheduler
// and audio transport are injectable for deterministic tests.
export function usePlayback(
  getNodes: () => Map<string, SVGGraphicsElement>,
  raf: Raf = requestAnimationFrame,
  caf: Caf = cancelAnimationFrame,
  makeTransport: () => AudioTransport = createAudioTransport,
): void {
  const playing = useEditor((s) => s.playing);
  const clockRef = useRef<ClockState>(createClock());
  const handleRef = useRef<number | null>(null);
  const transportRef = useRef<AudioTransport | null>(null);
  if (transportRef.current === null) transportRef.current = makeTransport();
  const transport = transportRef.current;

  useEffect(() => {
    if (!playing) {
      if (handleRef.current !== null) caf(handleRef.current);
      handleRef.current = null;
      transport.stop();
      // Re-anchor from the store's current playhead for the next play.
      clockRef.current = { ...createClock(), time: useEditor.getState().time };
      return;
    }

    // Start: a fresh playing clock at the current playhead, and start audio from
    // there (the Play user gesture; no-op when there are no clips).
    const start = useEditor.getState();
    clockRef.current = { time: start.time, playing: true, lastTimestamp: null };
    void transport.start(start.history.present, start.binaries, start.time);

    const tick = (tMs: number): void => {
      const s = useEditor.getState();
      const project = s.history.present;
      const duration = selectEditDuration(s);
      const loop = project.meta.loop;
      const audioPos = transport.position();

      let next: ClockState;
      if (audioPos !== null) {
        // Audio is master: derive the visual time from the audio clock.
        let time = audioPos;
        let stillPlaying = true;
        if (duration > 0 && time >= duration) {
          if (loop) {
            time %= duration;
            // Restart audio at the wrapped position to stay in sync.
            transport.stop();
            void transport.start(project, s.binaries, time);
          } else {
            time = duration;
            stillPlaying = false;
          }
        }
        next = { time, playing: stillPlaying, lastTimestamp: null };
      } else {
        next = advance(clockRef.current, tMs / 1000, duration, loop);
      }

      clockRef.current = next;
      applyFrame(getNodes(), project, next.time);
      useEditor.setState({ time: next.time });

      if (next.playing) {
        handleRef.current = raf(tick);
      } else {
        transport.stop();
        clockRef.current = pause(clockRef.current);
        useEditor.getState().setPlaying(false);
      }
    };

    handleRef.current = raf(tick);
    return () => {
      if (handleRef.current !== null) caf(handleRef.current);
      handleRef.current = null;
      transport.stop();
    };
  }, [playing, getNodes, raf, caf, transport]);
}
