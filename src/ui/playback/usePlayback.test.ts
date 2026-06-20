import { renderHook, act } from '@testing-library/react';
import { vi } from 'vitest';
import { usePlayback } from './usePlayback';
import { useEditor } from '../store/store';
import { createProject, createSceneObject, createKeyframe } from '../../engine';
import type { AudioTransport } from './audioTransport';

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

it('advances the playhead and stops at duration', () => {
  const obj = createSceneObject('a', {
    id: 'o1',
    tracks: { x: [createKeyframe(0, 0), createKeyframe(1, 100)] },
  });
  useEditor.getState().setProject({ ...createProject(), objects: [obj] });

  const sched = fakeScheduler();
  const nodes = new Map<string, SVGGraphicsElement>();
  renderHook(() => usePlayback(() => nodes, sched.raf, sched.caf));

  act(() => {
    useEditor.getState().setPlaying(true);
  });
  act(() => {
    sched.flush(0); // anchor
  });
  act(() => {
    sched.flush(500); // +0.5s
  });
  expect(useEditor.getState().time).toBeCloseTo(0.5, 2);

  act(() => {
    sched.flush(1500); // past duration (1s), non-loop
  });
  expect(useEditor.getState().playing).toBe(false);
  expect(useEditor.getState().time).toBeCloseTo(1, 2);
});

// --- audio-as-master-clock (spec §4) ---

function fakeTransport(position: () => number | null): AudioTransport {
  return {
    start: vi.fn(async () => {}),
    stop: vi.fn(),
    position: vi.fn(position),
  };
}

// duration 2 via a keyframe at t=2.
function projectWithDuration2() {
  const obj = createSceneObject('a', {
    id: 'o1',
    tracks: { x: [createKeyframe(0, 0), createKeyframe(2, 100)] },
  });
  return { ...createProject(), objects: [obj] };
}

it('uses the audio clock as master when audio is playing', () => {
  useEditor.getState().setProject(projectWithDuration2());
  const sched = fakeScheduler();
  const transport = fakeTransport(() => 0.4); // audio reports playhead 0.4s
  renderHook(() => usePlayback(() => new Map(), sched.raf, sched.caf, () => transport));

  act(() => useEditor.getState().setPlaying(true));
  act(() => sched.flush(9999)); // wall-clock would jump way past 0.4
  expect(useEditor.getState().time).toBeCloseTo(0.4, 5); // followed audio, not wall clock
  expect(transport.start).toHaveBeenCalledOnce();
});

it('audio master: non-loop stops at duration', () => {
  useEditor.getState().setProject(projectWithDuration2());
  const sched = fakeScheduler();
  const transport = fakeTransport(() => 2.5); // audio past the 2s end
  renderHook(() => usePlayback(() => new Map(), sched.raf, sched.caf, () => transport));

  act(() => useEditor.getState().setPlaying(true));
  act(() => sched.flush(0));
  expect(useEditor.getState().playing).toBe(false);
  expect(useEditor.getState().time).toBeCloseTo(2, 5);
});

it('audio master: loop wraps and restarts audio at the wrapped position', () => {
  const p = projectWithDuration2();
  useEditor.getState().setProject({ ...p, meta: { ...p.meta, loop: true } });
  const sched = fakeScheduler();
  const transport = fakeTransport(() => 2.5); // past 2s end, should wrap to 0.5
  renderHook(() => usePlayback(() => new Map(), sched.raf, sched.caf, () => transport));

  act(() => useEditor.getState().setPlaying(true));
  act(() => sched.flush(0));
  expect(useEditor.getState().playing).toBe(true);
  expect(useEditor.getState().time).toBeCloseTo(0.5, 5);
  // start called once at play + once on the loop restart
  expect(transport.start).toHaveBeenCalledTimes(2);
  expect((transport.start as ReturnType<typeof vi.fn>).mock.calls[1][2]).toBeCloseTo(0.5, 5);
});
