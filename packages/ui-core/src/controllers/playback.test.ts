// Pure unit tests for `makePlaybackController` — no React (the point: the rAF loop runs framework-
// neutrally). Uses the real vanilla `@savig/editor-state` store + fake scheduler/transport/paint
// ports, mirroring usePlayback.test.ts but driving the controller directly.
import { store } from '@savig/editor-state';
import { createKeyframe, createProject, createSceneObject } from '@savig/engine';
import { makePlaybackController, type PlaybackDeps, type PlaybackTransport } from './playback';

function fakeScheduler() {
  let cbs: Array<(t: number) => void> = [];
  return {
    raf: (cb: (t: number) => void) => {
      cbs.push(cb);
      return cbs.length;
    },
    caf: () => {
      cbs = [];
    },
    flush: (timeMs: number) => {
      const c = cbs;
      cbs = [];
      c.forEach((cb) => cb(timeMs));
    },
  };
}

const wallClockTransport = (): PlaybackTransport => ({ start: () => {}, stop: () => {}, position: () => null });

const deps = (over: Partial<PlaybackDeps>): PlaybackDeps => ({
  getNodes: () => new Map(),
  applyFrame: () => {},
  transport: wallClockTransport(),
  raf: () => 0,
  caf: () => {},
  ...over,
});

// duration 1 via a keyframe at t=1.
function seedDuration1() {
  const obj = createSceneObject('a', { id: 'o1', tracks: { x: [createKeyframe(0, 0), createKeyframe(1, 100)] } });
  store.getState().setProject({ ...createProject(), objects: [obj] });
}

beforeEach(() => store.getState().newProject());

describe('makePlaybackController', () => {
  it('advances the playhead on each tick and stops at duration (wall clock)', () => {
    seedDuration1();
    const sched = fakeScheduler();
    const c = makePlaybackController(store);
    c.play(deps({ raf: sched.raf, caf: sched.caf }));

    sched.flush(0); // anchor
    sched.flush(500); // +0.5s
    expect(store.getState().time).toBeCloseTo(0.5, 2);

    sched.flush(1500); // past the 1s duration, non-loop
    expect(store.getState().playing).toBe(false);
    expect(store.getState().time).toBeCloseTo(1, 2);
  });

  it('follows the audio clock as master when the transport reports a position', () => {
    seedDuration1();
    const sched = fakeScheduler();
    let started = 0;
    const transport: PlaybackTransport = { start: () => { started += 1; }, stop: () => {}, position: () => 0.4 };
    const c = makePlaybackController(store);
    store.getState().setPlaying(true);
    c.play(deps({ raf: sched.raf, caf: sched.caf, transport }));
    sched.flush(9999); // wall clock would jump way past 0.4
    expect(store.getState().time).toBeCloseTo(0.4, 5); // followed audio, not wall clock
    expect(started).toBe(1);
  });

  it('restarts from the beginning when play is pressed at the last frame', () => {
    seedDuration1();
    const sched = fakeScheduler();
    let startedAt = -1;
    const transport = { start: (_p: unknown, _b: unknown, t: number) => { startedAt = t; }, stop: () => {}, position: () => null };
    store.getState().seek(1); // playhead parked at the end (e.g. a finished non-loop play, or a keyframe just created at the playhead)
    const c = makePlaybackController(store);
    c.play(deps({ raf: sched.raf, caf: sched.caf, transport: transport as PlaybackTransport }));

    expect(store.getState().time).toBe(0); // rewound so the run is visible
    expect(startedAt).toBe(0); // audio starts from the top too
    sched.flush(0); // anchor
    sched.flush(400);
    expect(store.getState().time).toBeCloseTo(0.4, 2); // actually advancing, not instantly stopping
  });

  it('paints each frame through the injected applyFrame port', () => {
    seedDuration1();
    const sched = fakeScheduler();
    const painted: number[] = [];
    const c = makePlaybackController(store);
    c.play(deps({ raf: sched.raf, caf: sched.caf, applyFrame: (_n, _p, t) => painted.push(t) }));
    sched.flush(0);
    sched.flush(250);
    expect(painted.length).toBe(2);
    expect(painted[1]).toBeCloseTo(0.25, 2);
  });
});
