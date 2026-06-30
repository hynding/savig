/** Camera (M5 slice 8a): an animatable VIEW transform over the whole artboard — pan/zoom/roll,
 *  for Ken-Burns push-ins, follows, reframes. Additive: `Project.camera` ABSENT = no camera =
 *  identity view = byte-identical parity. The camera is a render-time wrapper around the scene, not
 *  an object transform, so `flattenInstances` / per-object `computeFrame` are unaffected. */
import { interpolate } from './interpolate';
import { fmt } from './transform';
import type { Camera, CameraAxis, CameraPose, Project } from './types';

export function defaultCameraPose(width: number, height: number): CameraPose {
  return { x: width / 2, y: height / 2, zoom: 1, rotation: 0 };
}

/** Sample the camera pose at `time` (animated axis tracks override the static base). */
export function sampleCamera(camera: Camera, time: number): CameraPose {
  const axis = (a: CameraAxis): number => {
    const track = camera.tracks[a];
    if (track && track.length > 0) return interpolate(track, time, a === 'rotation');
    return camera.base[a];
  };
  return { x: axis('x'), y: axis('y'), zoom: axis('zoom'), rotation: axis('rotation') };
}

/** SVG transform that frames world point (pose.x,pose.y) at the artboard centre (W/2,H/2) at the
 *  given zoom/rotation: translate(W/2,H/2) · scale(zoom) · rotate(rot) · translate(-x,-y). The
 *  default pose collapses to identity. */
export function cameraTransform(pose: CameraPose, width: number, height: number): string {
  return (
    `translate(${fmt(width / 2)} ${fmt(height / 2)}) ` +
    `scale(${fmt(pose.zoom)}) ` +
    `rotate(${fmt(pose.rotation)}) ` +
    `translate(${fmt(-pose.x)} ${fmt(-pose.y)})`
  );
}

/** Camera view transform for an EXPLICIT camera (per-scene, 8b) at `time`, or null when absent.
 *  Same math as computeCameraTransform but the camera + artboard dims are passed in rather than
 *  read off the project, so each scene can supply its own. */
export function computeSceneCameraTransform(
  camera: Camera | undefined, width: number, height: number, time: number,
): string | null {
  if (!camera) return null;
  return cameraTransform(sampleCamera(camera, time), width, height);
}

/** The camera view transform for the project at `time`, or `null` when there is no camera. */
export function computeCameraTransform(project: Project, time: number): string | null {
  return computeSceneCameraTransform(project.camera, project.meta.width, project.meta.height, time);
}
