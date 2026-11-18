// Editor camera authoring (spec 2026-11-18-camera-tool). The camera governing the active edit view
// is the project camera (single scene) or the selected scene's camera (multi-scene); a symbol's
// edit view has none, so every verb is a no-op there. Each verb commits one undoable step.
import { clampCameraZoom, createKeyframe, defaultCameraPose, removeKeyframeAt, snapToFrame, upsertKeyframe } from '@savig/engine';
import type { Camera, CameraAxis, CameraPose, Project } from '@savig/engine';
import { selectActiveAssetId, selectActiveSceneCamera, selectActiveSceneId } from '../selectors';
import type { EditorState, SliceCreator } from '../store-internals';

type CameraKeys = 'addCamera' | 'setCameraPose' | 'removeCameraKeyframe' | 'removeCamera';

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

export const createCameraSlice: SliceCreator<CameraKeys> = (_set, get) => {
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
      const tracks = { ...cam.tracks };
      // The last key going away leaves the axis still at the value it showed there.
      if (next.length > 0) tracks[axis] = next;
      else delete tracks[axis];
      const gone = track.find((k) => !next.includes(k));
      const base = next.length > 0 || !gone ? cam.base : { ...cam.base, [axis]: gone.value };
      commitCamera({ ...cam, base, tracks });
    },

    removeCamera() {
      const s = get();
      if (!cameraEditable(s) || !selectActiveSceneCamera(s)) return;
      commitCamera(undefined);
    },
  };
};
