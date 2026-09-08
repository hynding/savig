// Framework-neutral view-model + intents for the Timeline panel (slice 4, task 2). Mirrors
// packages/ui-core/src/viewmodels/inspector.ts: `timelineViewModel` is a PURE function
// `EditorState -> TimelineVM` covering every store-derived value `Timeline.tsx` used to compute
// inline — track/lane rows, per-keyframe selection flags, lock-aware gating (own lock vs.
// ancestor-cascade lock), audio-lane data, header toggle state — so it would read identically
// if the panel were rewritten in Svelte or Vue. `timelineIntents` are thin wrappers around store
// actions — no logic beyond dispatch.
//
// Deliberately NOT extracted (left in Timeline.tsx):
//  - Playhead-scrub and keyframe-drag POINTER handling (`scrub`, `startKeyframeDrag`, the
//    `pointermove`/`pointerup` window listeners). This becomes an L2 controller in slice 5 —
//    extracting it now would be premature and risks entangling pointer state with this VM.
//  - Pixel positioning (`timeToX`/`xToTime`/`PX_PER_SECOND` from `Timeline/scale.ts`). That
//    scale lives in an app-local module `@savig/ui-core` is not allowed to import (only
//    `@savig/engine`, `@savig/interaction`, `@savig/editor-state`) — the VM exposes raw `time`
//    values (playhead, each keyframe, each audio clip) and the component maps them to pixels
//    exactly as it did before this refactor.
import { isLockedInTree, TRIM_TRACK_KEYS } from '@savig/engine';
import type { AnimatableProperty, AudioClip, AudioFilter, Keyframe, TrimProperty } from '@savig/engine';
import { selectActiveObjects, selectEditDuration } from '@savig/editor-state';
import type {
  ColorKeyframeRef,
  DashKeyframeRef,
  EditorState,
  GradientKeyframeRef,
  KeyframeRef,
  ProgressKeyframeRef,
  RemapKeyframeRef,
  ShapeKeyframeRef,
  TrimKeyframeRef,
} from '@savig/editor-state';
import { buildLockIndex } from './lockIndex';

export interface TimelineKeyframeVM {
  time: number;
  selected: boolean;
}

export interface TimelineScalarTrackVM {
  property: AnimatableProperty;
  keyframes: TimelineKeyframeVM[];
}

export interface TimelineColorTrackVM {
  property: 'fill' | 'stroke';
  keyframes: TimelineKeyframeVM[];
}

export interface TimelineTrimTrackVM {
  prop: TrimProperty;
  keyframes: TimelineKeyframeVM[];
}

export interface TimelineRowVM {
  id: string;
  name: string;
  /** The object's OWN lock — row dimming mirrors the Layers lock toggle, NOT the cascade. */
  ownLocked: boolean;
  /** Own lock OR an ancestor group's lock (cascade) — gates label click + keyframe interaction. */
  locked: boolean;
  selected: boolean;
  scalarTracks: TimelineScalarTrackVM[];
  shapeKeyframes: TimelineKeyframeVM[];
  colorTracks: TimelineColorTrackVM[];
  gradientTracks: TimelineColorTrackVM[];
  dashKeyframes: TimelineKeyframeVM[];
  /** One lane per trim prop (start/end/offset) that has at least one keyframe. */
  trimTracks: TimelineTrimTrackVM[];
  progressKeyframes: TimelineKeyframeVM[];
  remapKeyframes: TimelineKeyframeVM[];
}

export interface TimelineAudioClipVM {
  id: string;
  assetId: string;
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  fadeIn: number;
  fadeOut: number;
}

/** One mixer lane. `id: null` = the implicit DEFAULT lane (a clip with no, or a dangling,
 *  trackId) — emitted FIRST, and only when it has clips or no tracks exist at all (an empty
 *  project shows one lane, not zero). Every other entry mirrors `audioTracks[]` in order. */
export interface TimelineAudioTrackVM {
  id: string | null;
  name: string;
  gain: number;
  muted: boolean;
  solo: boolean;
  pan: number;
  clips: TimelineAudioClipVM[];
}

export interface TimelineVM {
  time: number;
  fps: number;
  duration: number;
  rows: TimelineRowVM[];
  /** Flat clip list (compat — some callers just want "every audio clip"). */
  audioClips: TimelineAudioClipVM[];
  /** Per-lane view: the default lane (if applicable) first, then one per `audioTracks[]`. */
  audioTracks: TimelineAudioTrackVM[];
  autoKey: boolean;
  onionSkin: boolean;
  snapEnabled: boolean;
  gridEnabled: boolean;
  gridSize: number;
  frameEnabled: boolean;
}

export function timelineViewModel(s: EditorState): TimelineVM {
  const time = s.time;
  const fps = s.history.present.meta.fps;
  const objects = selectActiveObjects(s);
  const audioClips = s.history.present.audioClips;
  const lockById = buildLockIndex(objects);
  const selectedObjectId = s.selectedObjectId;
  const {
    selectedKeyframe,
    selectedShapeKeyframe,
    selectedColorKeyframe,
    selectedGradientKeyframe,
    selectedDashKeyframe,
    selectedTrimKeyframe,
    selectedProgressKeyframe,
    selectedRemapKeyframe,
  } = s;

  const rows: TimelineRowVM[] = objects.map((obj) => {
    // Effective lock: own OR an ancestor group is locked (cascade). The row's dimming still
    // reflects the object's OWN lock (it mirrors the Layers lock toggle).
    const locked = isLockedInTree(obj, lockById);

    const scalarTracks: TimelineScalarTrackVM[] = (
      Object.entries(obj.tracks) as [AnimatableProperty, Keyframe[]][]
    ).map(([property, track]) => ({
      property,
      keyframes: (track ?? []).map((kf) => ({
        time: kf.time,
        selected:
          selectedKeyframe?.objectId === obj.id &&
          selectedKeyframe.property === property &&
          selectedKeyframe.time === kf.time,
      })),
    }));

    const shapeKeyframes: TimelineKeyframeVM[] = (obj.shapeTrack ?? []).map((kf) => ({
      time: kf.time,
      selected: selectedShapeKeyframe?.objectId === obj.id && selectedShapeKeyframe.time === kf.time,
    }));

    const colorTracks: TimelineColorTrackVM[] = (['fill', 'stroke'] as const).map((property) => ({
      property,
      keyframes: (obj.colorTracks?.[property] ?? []).map((kf) => ({
        time: kf.time,
        selected:
          selectedColorKeyframe?.objectId === obj.id &&
          selectedColorKeyframe.property === property &&
          selectedColorKeyframe.time === kf.time,
      })),
    }));

    const gradientTracks: TimelineColorTrackVM[] = (['fill', 'stroke'] as const).map((property) => ({
      property,
      keyframes: (obj.gradientTracks?.[property] ?? []).map((kf) => ({
        time: kf.time,
        selected:
          selectedGradientKeyframe?.objectId === obj.id &&
          selectedGradientKeyframe.property === property &&
          selectedGradientKeyframe.time === kf.time,
      })),
    }));

    const dashKeyframes: TimelineKeyframeVM[] = (obj.dashOffsetTrack ?? []).map((kf) => ({
      time: kf.time,
      selected: selectedDashKeyframe?.objectId === obj.id && selectedDashKeyframe.time === kf.time,
    }));

    const trimTracks: TimelineTrimTrackVM[] = (['start', 'end', 'offset'] as const)
      .map((prop) => ({
        prop,
        keyframes: (obj.trim?.[TRIM_TRACK_KEYS[prop]] ?? []).map((kf) => ({
          time: kf.time,
          selected:
            selectedTrimKeyframe?.objectId === obj.id &&
            selectedTrimKeyframe.prop === prop &&
            selectedTrimKeyframe.time === kf.time,
        })),
      }))
      .filter((t) => t.keyframes.length > 0);

    const progressKeyframes: TimelineKeyframeVM[] = (obj.motionPath?.progress ?? []).map((kf) => ({
      time: kf.time,
      selected: selectedProgressKeyframe?.objectId === obj.id && selectedProgressKeyframe.time === kf.time,
    }));

    const remapKeyframes: TimelineKeyframeVM[] = (obj.symbolTimeTrack ?? []).map((kf) => ({
      time: kf.time,
      selected: selectedRemapKeyframe?.objectId === obj.id && selectedRemapKeyframe.time === kf.time,
    }));

    return {
      id: obj.id,
      name: obj.name,
      ownLocked: !!obj.locked,
      locked,
      selected: obj.id === selectedObjectId,
      scalarTracks,
      shapeKeyframes,
      colorTracks,
      gradientTracks,
      dashKeyframes,
      trimTracks,
      progressKeyframes,
      remapKeyframes,
    };
  });

  const clipVM = (clip: AudioClip): TimelineAudioClipVM => ({
    id: clip.id,
    assetId: clip.assetId,
    startTime: clip.startTime,
    duration: clip.outPoint - clip.inPoint,
    inPoint: clip.inPoint,
    outPoint: clip.outPoint,
    fadeIn: clip.fadeIn ?? 0,
    fadeOut: clip.fadeOut ?? 0,
  });
  const audioClipVMs: TimelineAudioClipVM[] = audioClips.map(clipVM);

  const tracks = s.history.present.audioTracks ?? [];
  const trackIds = new Set(tracks.map((t) => t.id));
  const untracked = audioClips.filter((c) => !c.trackId || !trackIds.has(c.trackId));
  const audioTrackVMs: TimelineAudioTrackVM[] = [
    ...(untracked.length || tracks.length === 0
      ? [{ id: null, name: 'Audio', gain: 1, muted: false, solo: false, pan: 0, clips: untracked.map(clipVM) }]
      : []),
    ...tracks.map((t) => ({
      id: t.id,
      name: t.name,
      gain: t.gain,
      muted: t.muted,
      solo: t.solo,
      pan: t.pan ?? 0,
      clips: audioClips.filter((c) => c.trackId === t.id).map(clipVM),
    })),
  ];

  return {
    time,
    fps,
    duration: selectEditDuration(s),
    rows,
    audioClips: audioClipVMs,
    audioTracks: audioTrackVMs,
    autoKey: s.autoKey,
    onionSkin: s.onionSkin,
    snapEnabled: s.snapEnabled,
    gridEnabled: s.gridEnabled,
    gridSize: s.gridSize,
    frameEnabled: s.frameEnabled,
  };
}

/** The minimal shape `timelineIntents` needs from the vanilla `@savig/editor-state` store —
 *  avoids importing zustand's `StoreApi` type just for this signature. `store` (the real
 *  vanilla StoreApi) satisfies this structurally. */
export interface TimelineStore {
  getState: () => EditorState;
}

export function timelineIntents(store: TimelineStore) {
  const s = () => store.getState();
  return {
    seek: (time: number) => s().seek(time),
    selectObject: (id: string | null) => s().selectObject(id),
    selectKeyframe: (ref: KeyframeRef | null) => s().selectKeyframe(ref),
    selectShapeKeyframe: (ref: ShapeKeyframeRef | null) => s().selectShapeKeyframe(ref),
    selectColorKeyframe: (ref: ColorKeyframeRef | null) => s().selectColorKeyframe(ref),
    selectGradientKeyframe: (ref: GradientKeyframeRef | null) => s().selectGradientKeyframe(ref),
    selectDashKeyframe: (ref: DashKeyframeRef | null) => s().selectDashKeyframe(ref),
    selectTrimKeyframe: (ref: TrimKeyframeRef | null) => s().selectTrimKeyframe(ref),
    selectProgressKeyframe: (ref: ProgressKeyframeRef | null) => s().selectProgressKeyframe(ref),
    selectRemapKeyframe: (ref: RemapKeyframeRef | null) => s().selectRemapKeyframe(ref),
    toggleAutoKey: () => s().toggleAutoKey(),
    toggleOnionSkin: () => s().toggleOnionSkin(),
    retimeSelectedKeyframe: (newTime: number) => s().retimeSelectedKeyframe(newTime),
    toggleSnap: () => s().toggleSnap(),
    toggleGrid: () => s().toggleGrid(),
    setGridSize: (n: number) => s().setGridSize(n),
    toggleFrame: () => s().toggleFrame(),
    addAudioTrack: () => s().addAudioTrack(),
    renameAudioTrack: (trackId: string, name: string) => s().renameAudioTrack(trackId, name),
    setAudioTrackProps: (
      trackId: string,
      props: { gain?: number; muted?: boolean; solo?: boolean; pan?: number; filter?: AudioFilter | null },
    ) => s().setAudioTrackProps(trackId, props),
    removeAudioTrack: (trackId: string) => s().removeAudioTrack(trackId),
    addAudioClip: (assetId: string) => s().addAudioClip(assetId),
    setAudioClipTiming: (clipId: string, timing: { startTime?: number; inPoint?: number; outPoint?: number }) =>
      s().setAudioClipTiming(clipId, timing),
    setAudioClipTrack: (clipId: string, trackId: string | null) => s().setAudioClipTrack(clipId, trackId),
    setAudioClipFades: (clipId: string, fades: { fadeIn?: number; fadeOut?: number }) =>
      s().setAudioClipFades(clipId, fades),
    removeAudioClip: (clipId: string) => s().removeAudioClip(clipId),
  };
}
