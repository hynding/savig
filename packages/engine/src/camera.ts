/** Camera (M5 slice 8a): an animatable VIEW transform over the whole artboard — pan/zoom/roll,
 *  for Ken-Burns push-ins, follows, reframes. Additive: `Project.camera` ABSENT = no camera =
 *  identity view = byte-identical parity. The camera is a render-time wrapper around the scene, not
 *  an object transform, so `flattenInstances` / per-object `computeFrame` are unaffected. */
import { interpolate } from './interpolate';
import { applyModifier } from './modifiers';
import { fmt } from './transform';
import type { Camera, CameraAxis, CameraPose, Project } from './types';

export function defaultCameraPose(width: number, height: number): CameraPose {
  return { x: width / 2, y: height / 2, zoom: 1, rotation: 0 };
}

/** Sample the camera pose at `time` (animated axis tracks override the static base). */
export function sampleCamera(camera: Camera, time: number): CameraPose {
  const axis = (a: CameraAxis): number => {
    const track = camera.tracks[a];
    const at = (t: number) => (track && track.length > 0 ? interpolate(track, t, a === 'rotation') : camera.base[a]);
    const m = camera.modifiers?.[a];
    return m ? applyModifier(m, `camera:${a}`, track, time, at) : at(time);
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

/** Editor camera tool (spec 2026-11-18-camera-tool): the world point the camera shows at artboard
 *  point (vx, vy) — the inverse of `cameraTransform`. */
export function cameraViewToWorld(pose: CameraPose, width: number, height: number, vx: number, vy: number): { x: number; y: number } {
  const z = pose.zoom || 1;
  const dx = (vx - width / 2) / z;
  const dy = (vy - height / 2) / z;
  const r = (-pose.rotation * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: pose.x + dx * c - dy * s, y: pose.y + dx * s + dy * c };
}

/** The world-space corners of what the camera sees (artboard TL, TR, BR, BL), for the editor's
 *  camera frame overlay. The default pose returns the artboard itself. */
export function cameraFrameCorners(pose: CameraPose, width: number, height: number): { x: number; y: number }[] {
  return [
    cameraViewToWorld(pose, width, height, 0, 0),
    cameraViewToWorld(pose, width, height, width, 0),
    cameraViewToWorld(pose, width, height, width, height),
    cameraViewToWorld(pose, width, height, 0, height),
  ];
}

/** Pan the camera so the picture moves by (dx, dy) artboard units: the camera itself moves the
 *  opposite way, scaled by zoom and turned by its rotation. */
export function panCameraBy(pose: CameraPose, dx: number, dy: number): CameraPose {
  const z = pose.zoom || 1;
  const r = (-pose.rotation * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const wx = (dx * c - dy * s) / z;
  const wy = (dx * s + dy * c) / z;
  return { ...pose, x: pose.x - wx, y: pose.y - wy };
}

/** Camera zoom limits for the editor tool and authoring verbs. */
export const CAMERA_ZOOM_MIN = 0.05;
export const CAMERA_ZOOM_MAX = 20;
export function clampCameraZoom(z: number): number {
  return Math.min(CAMERA_ZOOM_MAX, Math.max(CAMERA_ZOOM_MIN, z));
}
