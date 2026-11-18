// Editor camera authoring (spec 2026-11-18-camera-tool). The camera governing the active edit view
// is the project camera (single scene) or the selected scene's camera (multi-scene); a symbol's
// edit view has none, so every verb is a no-op there. Each verb commits one undoable step.
import { clampCameraZoom, computeProjectDuration, createKeyframe, defaultCameraPose, isPropertyModifier, removeKeyframeAt, snapToFrame, upsertKeyframe, withCameraModifier } from '@savig/engine';
import type { Camera, CameraAxis, CameraPose, Easing, Keyframe, Project, PropertyModifier } from '@savig/engine';
import { selectActiveAssetId, selectActiveSceneCamera, selectActiveSceneId } from '../selectors';
import { KF_EPS, NO_KEYFRAME_SELECTION, type CameraKeyframeRef, type EditorState, type SliceCreator } from '../store-internals';

type CameraKeys =
  | 'addCamera' | 'setCameraPose' | 'removeCameraKeyframe' | 'removeCamera'
  | 'selectCameraKeyframe' | 'removeSelectedCameraKeyframe' | 'setSelectedCameraKeyframeEasing' | 'setCameraModifier';

export const CAMERA_AXES: readonly CameraAxis[] = ['x', 'y', 'zoom', 'rotation'];

/** `project` with the active edit view's camera replaced (undefined removes it). */
export function withActiveCamera(project: Project, sceneId: string | null, camera: Camera | undefined): Project {
  if (project.scenes) {
    return {
      ...project,
      scenes: project.scenes.map((sc) => {
        if (sc.id !== sceneId) return sc;
        const next = { ...sc, camera };
        if (!camera) delete next.camera;
        return next;
      }),
    };
  }
  const next = { ...project, camera };
  if (!camera) delete next.camera;
  return next;
}

/** Whether the active edit view can carry a camera (root or a scene, not inside a symbol). */
export function cameraEditable(s: EditorState): boolean {
  return selectActiveAssetId(s) == null;
}

function activeDims(s: EditorState): { width: number; height: number } {
  return { width: s.history.present.meta.width, height: s.history.present.meta.height };
}

/** Sanitize one axis value: finite, zoom clamped, else null (rejected). */
function cleanAxis(axis: CameraAxis, v: number | undefined): number | null {
  if (v === undefined || !Number.isFinite(v)) return null;
  return axis === 'zoom' ? clampCameraZoom(v) : v;
}

/** `cam` with `axis`'s keys replaced; the last key going away leaves the axis still at `stillAt`. */
function withAxisTrack(cam: Camera, axis: CameraAxis, next: Keyframe[], stillAt: number): Camera {
  const tracks = { ...cam.tracks };
  if (next.length > 0) {
    tracks[axis] = next;
    return { ...cam, tracks };
  }
  delete tracks[axis];
  return { ...cam, base: { ...cam.base, [axis]: stillAt }, tracks };
}

/** Retime the selected camera key to `time` (frame-snapped by the caller). Returns the new ref, or
 *  null when nothing changes (no key, same time, or another key already sits there). */
export function retimeCameraKey(cam: Camera, ref: CameraKeyframeRef, time: number): { camera: Camera; ref: CameraKeyframeRef } | null {
  const track = cam.tracks[ref.axis];
  const kf = track?.find((k) => Math.abs(k.time - ref.time) < KF_EPS);
  if (!track || !kf || Math.abs(time - ref.time) < KF_EPS) return null;
  const rest = track.filter((k) => k !== kf);
  if (rest.some((k) => Math.abs(k.time - time) < KF_EPS)) return null;
  return { camera: { ...cam, tracks: { ...cam.tracks, [ref.axis]: upsertKeyframe(rest, { ...kf, time }) } }, ref: { axis: ref.axis, time } };
}

export const createCameraSlice: SliceCreator<CameraKeys> = (set, get) => {
  const commitCamera = (camera: Camera | undefined) => {
    const s = get();
    get().commit(withActiveCamera(s.history.present, selectActiveSceneId(s), camera));
  };
  return {
    addCamera() {
      const s = get();
      if (!cameraEditable(s) || selectActiveSceneCamera(s)) return;
      const { width, height } = activeDims(s);
      commitCamera({ base: defaultCameraPose(width, height), tracks: {} });
    },

    setCameraPose(patch: Partial<CameraPose>) {
      const s = get();
      if (!cameraEditable(s)) return;
      const { width, height } = activeDims(s);
      const cam: Camera = selectActiveSceneCamera(s) ?? { base: defaultCameraPose(width, height), tracks: {} };
      const time = snapToFrame(s.time, s.history.present.meta.fps);
      let base = cam.base;
      const tracks = { ...cam.tracks };
      let changed = !selectActiveSceneCamera(s);
      for (const axis of CAMERA_AXES) {
        const v = cleanAxis(axis, patch[axis]);
        if (v === null) continue;
        const track = cam.tracks[axis];
        // Auto-key on: every edit keys the axis at the playhead. Auto-key off: an axis that is
        // already animated still takes a key (else the edit would be invisible); a still axis
        // edits the static framing.
        if (s.autoKey || (track && track.length > 0)) {
          tracks[axis] = upsertKeyframe(track ?? [], createKeyframe(time, v));
        } else {
          base = { ...base, [axis]: v };
        }
        changed = true;
      }
      if (!changed) return;
      commitCamera({ ...cam, base, tracks });
    },

    removeCameraKeyframe(axis: CameraAxis) {
      const s = get();
      const cam = cameraEditable(s) ? selectActiveSceneCamera(s) : undefined;
      const track = cam?.tracks[axis];
      if (!cam || !track) return;
      const time = snapToFrame(s.time, s.history.present.meta.fps);
      const next = removeKeyframeAt(track, time);
      if (next.length === track.length) return;
      const gone = track.find((k) => !next.includes(k));
      commitCamera(withAxisTrack(cam, axis, next, gone ? gone.value : cam.base[axis]));
    },

    selectCameraKeyframe(ref) {
      set({
        ...NO_KEYFRAME_SELECTION,
        selectedCameraKeyframe: ref,
        // The camera key's Inspector is the Camera panel, shown with nothing selected.
        ...(ref ? { selectedObjectIds: [], selectedObjectId: null, selectedNodeIndex: null } : {}),
      });
    },

    removeSelectedCameraKeyframe() {
      const s = get();
      const ref = s.selectedCameraKeyframe;
      const cam = ref && cameraEditable(s) ? selectActiveSceneCamera(s) : undefined;
      const track = ref ? cam?.tracks[ref.axis] : undefined;
      if (!ref || !cam || !track) return;
      const next = removeKeyframeAt(track, ref.time);
      if (next.length === track.length) return;
      const gone = track.find((k) => !next.includes(k));
      commitCamera(withAxisTrack(cam, ref.axis, next, gone ? gone.value : cam.base[ref.axis]));
      set({ selectedCameraKeyframe: null });
    },

    setSelectedCameraKeyframeEasing(easing: Easing) {
      const s = get();
      const ref = s.selectedCameraKeyframe;
      const cam = ref && cameraEditable(s) ? selectActiveSceneCamera(s) : undefined;
      const track = ref ? cam?.tracks[ref.axis] : undefined;
      const kf = track?.find((k) => Math.abs(k.time - ref!.time) < KF_EPS);
      if (!ref || !cam || !track || !kf || JSON.stringify(kf.easing) === JSON.stringify(easing)) return;
      commitCamera({ ...cam, tracks: { ...cam.tracks, [ref.axis]: track.map((k) => (k === kf ? { ...k, easing } : k)) } });
    },

    setCameraModifier(axis: CameraAxis, patch: Partial<PropertyModifier> | null) {
      const s = get();
      if (!cameraEditable(s) || !CAMERA_AXES.includes(axis)) return;
      if (patch?.wiggle && !isPropertyModifier({ wiggle: patch.wiggle })) return;
      const { width, height } = activeDims(s);
      const cam = selectActiveSceneCamera(s) ?? { base: defaultCameraPose(width, height), tracks: {} };
      const next = withCameraModifier(cam, axis, patch);
      if (JSON.stringify(next) === JSON.stringify(selectActiveSceneCamera(s) ?? null)) return;
      let project = withActiveCamera(s.history.present, selectActiveSceneId(s), next);
      // A shake on a project with nothing animated would have no time to play (as for object wiggles).
      const addsWiggle = !!next.modifiers?.[axis]?.wiggle && !cam.modifiers?.[axis]?.wiggle;
      if (addsWiggle && !project.scenes && project.meta.durationMode !== 'manual' && computeProjectDuration(project) === 0) {
        project = { ...project, meta: { ...project.meta, durationMode: 'manual', duration: 2 } };
        s.pushToast('info', 'Nothing else is animated yet, so the timeline is now 2 s long for the camera shake to play.');
      }
      get().commit(project);
    },

    removeCamera() {
      const s = get();
      if (!cameraEditable(s) || !selectActiveSceneCamera(s)) return;
      commitCamera(undefined);
      set({ selectedCameraKeyframe: null });
    },
  };
};
