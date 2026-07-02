/** Headless camera authoring (M5 slice 8a): set a static framing or animate the view (pan/zoom/
 *  Ken-Burns). Pure; seeds `project.camera` (default pose = artboard centre, zoom 1 = identity) on
 *  first use, then upserts axis keyframes via the shared keyframe machinery. */
import { createKeyframe, defaultCameraPose, upsertKeyframe } from '@savig/engine';
import type { Camera, CameraAxis, CameraPose, Easing, Project } from '@savig/engine';

function ensureCamera(project: Project): Camera {
  return project.camera ?? { base: defaultCameraPose(project.meta.width, project.meta.height), tracks: {} };
}

/** Set the static camera framing (what it looks at). Merges into the existing pose; tracks kept. */
export function setCamera(project: Project, pose: Partial<CameraPose>): Project {
  const cam = ensureCamera(project);
  return { ...project, camera: { base: { ...cam.base, ...pose }, tracks: cam.tracks } };
}

/** Upsert a camera keyframe on one axis (x/y/zoom/rotation). */
export function setCameraKeyframe(
  project: Project,
  spec: { axis: CameraAxis; time: number; value: number; easing?: Easing },
): Project {
  const cam = ensureCamera(project);
  const track = upsertKeyframe(cam.tracks[spec.axis] ?? [], createKeyframe(spec.time, spec.value, spec.easing ? { easing: spec.easing } : {}));
  return { ...project, camera: { ...cam, tracks: { ...cam.tracks, [spec.axis]: track } } };
}

interface CamTiming {
  start?: number;
  duration?: number;
  easing?: Easing;
}

function ramp(project: Project, axis: CameraAxis, from: number, to: number, t: CamTiming): Project {
  const start = t.start ?? 0;
  const duration = t.duration ?? 1;
  let p = setCameraKeyframe(project, { axis, time: start, value: from });
  p = setCameraKeyframe(p, { axis, time: start + duration, value: to, easing: t.easing ?? 'easeInOut' });
  return p;
}

/** Pan the camera to look at (x, y), from its current framing. */
export function panTo(project: Project, to: { x?: number; y?: number }, t: CamTiming = {}): Project {
  const cam = ensureCamera(project);
  let p = project;
  if (to.x !== undefined) p = ramp(p, 'x', cam.base.x, to.x, t);
  if (to.y !== undefined) p = ramp(p, 'y', cam.base.y, to.y, t);
  return p;
}

/** Zoom the camera to a magnification, from its current zoom. */
export function zoomTo(project: Project, zoom: number, t: CamTiming = {}): Project {
  return ramp(project, 'zoom', ensureCamera(project).base.zoom, zoom, t);
}

/** Ken-Burns: animate the camera from one pose to another over the duration (slow push-in/drift). */
export function kenBurns(project: Project, from: Partial<CameraPose>, to: Partial<CameraPose>, t: CamTiming = {}): Project {
  // Seed the static base to `from`, then keyframe each changing axis to `to`.
  const p = setCamera(project, from);
  const base = (p.camera as Camera).base;
  let q = p;
  for (const axis of ['x', 'y', 'zoom', 'rotation'] as CameraAxis[]) {
    if (to[axis] !== undefined && to[axis] !== base[axis]) q = ramp(q, axis, base[axis], to[axis]!, t);
  }
  return q;
}
