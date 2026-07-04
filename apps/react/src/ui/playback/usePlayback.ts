import { useEffect, useRef } from 'react';
import { makePlaybackController, type PlaybackController } from '@savig/ui-core';
import { useEditor } from '../store/store';
import { applyFrame } from './applyFrame';
import { createAudioTransport, type AudioTransport } from './audioTransport';

type Raf = (cb: (t: number) => void) => number;
type Caf = (handle: number) => void;

// RAF transport, owning audio playback. While `playing` it paints each frame imperatively via
// applyFrame and mirrors the time into the store for the playhead UI. Thin React adapter over the
// neutral `makePlaybackController` (slice 5): the controller owns the clock + tick loop; this
// adapter subscribes to `playing`, owns the audio transport (created once), and drives the
// controller's start/stop from a useEffect. The scheduler and audio transport are injectable for
// deterministic tests.
export function usePlayback(
  getNodes: () => Map<string, SVGGraphicsElement>,
  // Wrap (don't pass bare) the native schedulers: the controller calls these as `deps.raf(...)`,
  // so a bare `requestAnimationFrame` reference would run with `this === deps` and the browser
  // throws `TypeError: Illegal invocation` (native rAF requires `this === window`).
  raf: Raf = (cb) => requestAnimationFrame(cb),
  caf: Caf = (handle) => cancelAnimationFrame(handle),
  makeTransport: () => AudioTransport = createAudioTransport,
): void {
  const playing = useEditor((s) => s.playing);
  const transportRef = useRef<AudioTransport | null>(null);
  if (transportRef.current === null) transportRef.current = makeTransport();
  const transport = transportRef.current;

  const ctrlRef = useRef<PlaybackController>();
  if (!ctrlRef.current) ctrlRef.current = makePlaybackController(useEditor);
  const ctrl = ctrlRef.current;

  useEffect(() => {
    const deps = { getNodes, applyFrame, transport, raf, caf };
    if (!playing) {
      ctrl.stopAndReanchor(deps);
      return;
    }
    ctrl.play(deps);
    return () => ctrl.stop();
  }, [playing, getNodes, raf, caf, transport, ctrl]);
}
