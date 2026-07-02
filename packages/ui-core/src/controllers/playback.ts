// Framework-neutral playback controller (slice 5, group D). Extracted from
// `playback/usePlayback.ts`. The store is INJECTED (W2). The rAF loop is self-driven (not React-
// render-driven), so — unlike the drag controllers — it can't "return a descriptor to apply
// later"; the 60fps paint must happen inside the tick. It does so through an INJECTED `applyFrame`
// paint port operating on injected `getNodes`, so the controller stays free of DOM/runtime
// imports and the loop is identical under any framework. The scheduler (raf/caf) and audio
// transport are injected too (deterministic tests). The clock advance itself is pure
// (`@savig/engine`). The React `useEffect` lifecycle (start on play / stop on pause) stays in the
// adapter, which passes the current ports into `play()`/`stopAndReanchor()` each run.
import { advance, createClock, pause } from '@savig/engine';
import type { ClockState, Project } from '@savig/engine';
import { selectEditDuration } from '@savig/editor-state';
import type { EditorState } from '@savig/editor-state';

export interface PlaybackTransport {
  start: (project: Project, binaries: Record<string, Uint8Array>, time: number) => void | Promise<void>;
  stop: () => void;
  position: () => number | null;
}

export interface PlaybackStore {
  getState: () => EditorState;
  setState: (partial: Partial<EditorState>) => void;
}

export interface PlaybackDeps {
  getNodes: () => Map<string, SVGGraphicsElement>;
  applyFrame: (nodes: Map<string, SVGGraphicsElement>, project: Project, time: number) => void;
  transport: PlaybackTransport;
  raf: (cb: (t: number) => void) => number;
  caf: (handle: number) => void;
}

export function makePlaybackController(store: PlaybackStore) {
  let clock: ClockState = createClock();
  let handle: number | null = null;
  let d: PlaybackDeps | null = null; // the ports from the latest play/stopAndReanchor call

  const tick = (tMs: number): void => {
    if (!d) return;
    const s = store.getState();
    const project = s.history.present;
    const duration = selectEditDuration(s);
    const loop = project.meta.loop;
    const audioPos = d.transport.position();

    let next: ClockState;
    if (audioPos !== null) {
      // Audio is master: derive the visual time from the audio clock.
      let time = audioPos;
      let stillPlaying = true;
      if (duration > 0 && time >= duration) {
        if (loop) {
          time %= duration;
          // Restart audio at the wrapped position to stay in sync.
          d.transport.stop();
          void d.transport.start(project, s.binaries, time);
        } else {
          time = duration;
          stillPlaying = false;
        }
      }
      next = { time, playing: stillPlaying, lastTimestamp: null };
    } else {
      next = advance(clock, tMs / 1000, duration, loop);
    }

    clock = next;
    d.applyFrame(d.getNodes(), project, next.time);
    store.setState({ time: next.time });

    if (next.playing) {
      handle = d.raf(tick);
    } else {
      d.transport.stop();
      clock = pause(clock);
      store.getState().setPlaying(false);
    }
  };

  return {
    /** Start playing from the current playhead with the given ports. */
    play(deps: PlaybackDeps): void {
      d = deps;
      const start = store.getState();
      clock = { time: start.time, playing: true, lastTimestamp: null };
      void deps.transport.start(start.history.present, start.binaries, start.time);
      handle = deps.raf(tick);
    },

    /** Effect cleanup: cancel the loop + stop audio (keeps the clock for a potential resume). */
    stop(): void {
      if (handle !== null && d) d.caf(handle);
      handle = null;
      d?.transport.stop();
    },

    /** Not-playing branch: cancel + stop, then re-anchor the clock from the store playhead so the
     *  next play starts there. */
    stopAndReanchor(deps: PlaybackDeps): void {
      d = deps;
      if (handle !== null) deps.caf(handle);
      handle = null;
      deps.transport.stop();
      clock = { ...createClock(), time: store.getState().time };
    },
  };
}

export type PlaybackController = ReturnType<typeof makePlaybackController>;
