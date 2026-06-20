import { renderHook, act } from '@testing-library/react';
import { usePlayback } from './usePlayback';
import { useEditor } from '../store/store';
import { createProject, createSceneObject, createKeyframe } from '../../engine';

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
