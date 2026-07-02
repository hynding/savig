// Pure unit tests for `transportControlsViewModel` (+ its `formatTime` helper) — no React.
// Drives the real vanilla `@savig/editor-state` store through its actions (same store the app
// uses) and asserts on the resulting descriptor, mirroring how `TransportControls.tsx`
// consumes it at runtime.
import { store } from '@savig/editor-state';
import { createSceneObject } from '@savig/engine';
import { formatTime, transportControlsViewModel } from './transportControls';

beforeEach(() => {
  store.getState().newProject();
});

describe('formatTime', () => {
  it('formats seconds as MM:SS.t', () => {
    expect(formatTime(0)).toBe('00:00.0');
    expect(formatTime(5.25)).toBe('00:05.2');
    expect(formatTime(65.9)).toBe('01:05.9');
  });

  it('clamps a negative value to 00:00.0', () => {
    expect(formatTime(-3)).toBe('00:00.0');
  });
});

describe('transportControlsViewModel — playing/loop flags', () => {
  it('reflects playing=true', () => {
    store.getState().setPlaying(true);
    expect(transportControlsViewModel(store.getState()).playing).toBe(true);
  });

  it('reflects loop=true', () => {
    const p = store.getState().history.present;
    store.getState().commit({ ...p, meta: { ...p.meta, loop: true } });
    expect(transportControlsViewModel(store.getState()).loop).toBe(true);
  });
});

describe('transportControlsViewModel — formatted current-time + duration', () => {
  it('formats a non-zero current time and reports raw seconds', () => {
    store.setState({ time: 5.2 });
    const vm = transportControlsViewModel(store.getState());
    expect(vm.time).toBe(5.2);
    expect(vm.currentTimeLabel).toBe('00:05.2');
  });

  it('formats the edit duration for a project with animated content', () => {
    const s = store.getState();
    // Drive a real animated object into the project so selectEditDuration reports a non-zero
    // duration (computeProjectDuration spans the latest keyframe across all objects' tracks).
    const obj = createSceneObject('missing-asset', {
      tracks: { x: [{ time: 0, value: 0, easing: 'linear' }, { time: 3, value: 100, easing: 'linear' }] },
    });
    const p = s.history.present;
    s.commit({ ...p, objects: [...p.objects, obj] });

    const vm = transportControlsViewModel(store.getState());
    expect(vm.duration).toBeGreaterThan(0);
    expect(vm.durationLabel).toBe(formatTime(vm.duration));
  });
});
