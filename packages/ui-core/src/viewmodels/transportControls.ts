// Framework-neutral view-model + intents for TransportControls (slice 4, task 4). Mirrors
// packages/ui-core/src/viewmodels/{inspector,timeline,layersPanel,sceneStrip}.ts:
// `transportControlsViewModel` is a PURE function `EditorState -> TransportControlsVM` covering
// every store-derived value `TransportControls.tsx` used to compute inline — the playing/loop
// flags and the formatted current-time/duration labels — so it would read identically if the
// bar were rewritten in Svelte or Vue. `transportControlsIntents` are thin wrappers around
// store actions — no logic beyond dispatch.
//
// `formatTime` was app-local (`TransportControls/formatTime.ts`) but is a trivial pure
// number->string formatter with no dependencies, so per the SceneStrip-precedent fallback it
// has been moved into this VM file rather than left in the component (it's exactly the kind of
// "formatted value" the extraction test calls out) — see `apps/react/.../TransportControls.tsx`,
// which now renders `vm.currentTimeLabel`/`vm.durationLabel` directly.
import { selectEditDuration } from '@savig/editor-state';
import type { EditorState } from '@savig/editor-state';

export function formatTime(seconds: number): string {
  const safe = Math.max(0, seconds);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const tenths = Math.floor((safe * 10) % 10);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(mins)}:${pad(secs)}.${tenths}`;
}

export interface TransportControlsVM {
  playing: boolean;
  loop: boolean;
  time: number;
  duration: number;
  currentTimeLabel: string;
  durationLabel: string;
}

export function transportControlsViewModel(s: EditorState): TransportControlsVM {
  const time = s.time;
  const duration = selectEditDuration(s);
  return {
    playing: s.playing,
    loop: s.history.present.meta.loop,
    time,
    duration,
    currentTimeLabel: formatTime(time),
    durationLabel: formatTime(duration),
  };
}

/** The minimal shape `transportControlsIntents` needs from the vanilla `@savig/editor-state`
 *  store — avoids importing zustand's `StoreApi` type just for this signature. `store` (the
 *  real vanilla StoreApi) satisfies this structurally. */
export interface TransportControlsStore {
  getState: () => EditorState;
}

export function transportControlsIntents(store: TransportControlsStore) {
  const s = () => store.getState();
  return {
    setPlaying: (playing: boolean) => s().setPlaying(playing),
    stepFrame: (delta: 1 | -1) => s().stepFrame(delta),
    toggleLoop: () => {
      const p = s().history.present;
      s().commit({ ...p, meta: { ...p.meta, loop: !p.meta.loop } });
    },
  };
}
