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
import { frameKeySpans, isExposedAt, isLockedInTree, spanContains, TRIM_TRACK_KEYS } from '@savig/engine';
import type { AnimatableProperty, AudioClip, AudioFilter, Keyframe, SceneObject, TrimProperty } from '@savig/engine';
import { selectActiveObjects, selectEditDuration, selectTargetFrameLayer } from '@savig/editor-state';
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

/** One keyframe of a frame-by-frame layer's strip (spec 2026-11-07 §Timeline). */
export interface TimelineFrameKeyVM {
  id: string;
  /** Start (inclusive, seconds). */
  time: number;
  /** End of its exposure (exclusive): the next key's start, or the layer's `end`. */
  end: number;
  /** True when no object is filed under this key (hollow dot); false = filled dot. */
  blank: boolean;
  label?: string;
  /** True when this key is the one exposed at the playhead. */
  current: boolean;
}

/** The frame strip a frame-by-frame layer row draws instead of property lanes. */
export interface TimelineFrameLayerVM {
  keys: TimelineFrameKeyVM[];
  end: number;
  /** True when the layer is the F5/F6/F7 target (it, or a drawing in it, is selected). */
  targeted: boolean;
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
  /** Present only on a frame-by-frame layer row: its frame strip. */
  frameLayer?: TimelineFrameLayerVM;
  /** Frame-by-frame layers this row sits inside, nearest first (empty for ordinary rows). The
   *  component keeps such rows collapsed under their layer until it is expanded. */
  frameOwnerIds: string[];
  /** False when a frame layer above hides this row's object at the playhead (another key's
   *  drawing). Always true for rows outside frame layers. */
  exposed: boolean;
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
  /** True when this lane is the selected mixer lane (task 5). The default lane (`id: null`) is
   *  never selectable — always false, regardless of `selectedAudioTrackId`. */
  selected: boolean;
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

  const byId = new Map(objects.map((o) => [o.id, o] as const));
  const targetLayerId = selectTargetFrameLayer(s)?.id;
  /** Frame-layer ancestors of `obj`, nearest first (cycle-guarded parent climb). */
  const frameOwners = (obj: SceneObject): string[] => {
    const out: string[] = [];
    const seen = new Set<string>([obj.id]);
    for (let p = obj.parentId ? byId.get(obj.parentId) : undefined; p && !seen.has(p.id); p = p.parentId ? byId.get(p.parentId) : undefined) {
      seen.add(p.id);
      if (p.isGroup && p.frames) out.push(p.id);
    }
    return out;
  };
  const frameLayerVM = (obj: SceneObject): TimelineFrameLayerVM | undefined => {
    if (!obj.isGroup || !obj.frames) return undefined;
    const filled = new Set(objects.filter((o) => o.parentId === obj.id && o.frameKeyId).map((o) => o.frameKeyId!));
    const labels = new Map(obj.frames.keys.map((k) => [k.id, k.label] as const));
    return {
      keys: frameKeySpans(obj.frames).map((sp) => ({
        id: sp.id,
        time: sp.start,
        end: sp.end,
        blank: !filled.has(sp.id),
        ...(labels.get(sp.id) ? { label: labels.get(sp.id) } : {}),
        current: spanContains(sp, time),
      })),
      end: obj.frames.end,
      targeted: obj.id === targetLayerId,
    };
  };

  const flatRows: TimelineRowVM[] = objects.map((obj) => {
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
      ...(obj.isGroup && obj.frames ? { frameLayer: frameLayerVM(obj) } : {}),
      frameOwnerIds: frameOwners(obj),
      exposed: isExposedAt(obj, byId, time) !== false,
    };
  });

  // A frame layer's descendants list right under its row (they may sit anywhere in objects[]);
  // every other row keeps its objects[] order — scenes without frame layers are unchanged.
  const childrenOf = new Map<string, TimelineRowVM[]>();
  for (const r of flatRows) {
    const owner = r.frameOwnerIds[0];
    if (owner) childrenOf.set(owner, [...(childrenOf.get(owner) ?? []), r]);
  }
  const rows: TimelineRowVM[] = [];
  const emitted = new Set<string>();
  const emit = (r: TimelineRowVM) => {
    if (emitted.has(r.id)) return;
    emitted.add(r.id);
    rows.push(r);
    for (const c of childrenOf.get(r.id) ?? []) emit(c);
  };
  for (const r of flatRows) if (r.frameOwnerIds.length === 0) emit(r);
  for (const r of flatRows) emit(r); // defensive: anything not reached above (cycles)

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
  const selectedAudioTrackId = s.selectedAudioTrackId;
  const audioTrackVMs: TimelineAudioTrackVM[] = [
    ...(untracked.length || tracks.length === 0
      ? [{ id: null, name: 'Audio', gain: 1, muted: false, solo: false, pan: 0, clips: untracked.map(clipVM), selected: false }]
      : []),
    ...tracks.map((t) => ({
      id: t.id,
      name: t.name,
      gain: t.gain,
      muted: t.muted,
      solo: t.solo,
      pan: t.pan ?? 0,
      clips: audioClips.filter((c) => c.trackId === t.id).map(clipVM),
      selected: t.id === selectedAudioTrackId,
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
    // Frame-by-frame strip (slice 3). The verbs act on the targeted layer at the playhead, so the
    // strip seeks and selects the layer first (see `targetFrameCell`).
    targetFrameCell: (layerId: string, time: number) => {
      const st = s();
      if (selectTargetFrameLayer(st)?.id !== layerId) st.selectObject(layerId);
      st.seek(time, { pastEnd: true }); // an empty cell past the end is a valid F5/F6/F7 target
    },
    moveFrameKeyTo: (keyId: string, time: number) => s().moveFrameKeyTo(keyId, time),
    setFrameKeyLabel: (keyId: string, label: string) => s().setFrameKeyLabel(keyId, label),
    insertFrames: () => s().insertFrames(1),
    removeFrames: () => s().removeFrames(1),
    insertFrameKeyframe: () => s().insertFrameKeyframe(),
    insertBlankFrameKeyframe: () => s().insertBlankFrameKeyframe(),
    clearFrameKeyframe: () => s().clearFrameKeyframe(),
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
    selectAudioTrack: (trackId: string | null) => s().selectAudioTrack(trackId),
  };
}
