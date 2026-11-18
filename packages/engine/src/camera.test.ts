import { describe, it, expect } from 'vitest';
import { createProject } from './project';
import { sampleCamera, cameraTransform, computeCameraTransform, computeSceneCameraTransform, defaultCameraPose, cameraFrameCorners, cameraViewToWorld, panCameraBy, clampCameraZoom, CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX } from './camera';
import type { Camera } from './types';

describe('engine/camera', () => {
  it('computeCameraTransform is null when the project has no camera (parity)', () => {
    expect(computeCameraTransform(createProject(), 0)).toBeNull();
  });

  it('the default pose yields an identity-equivalent transform', () => {
    const t = cameraTransform(defaultCameraPose(640, 360), 640, 360);
    // translate(320 180) scale(1) rotate(0) translate(-320 -180) — composes to identity
    expect(t).toBe('translate(320 180) scale(1) rotate(0) translate(-320 -180)');
  });

  it('a zoomed pose centered on a point frames it: translate(W/2,H/2) scale(z) ... translate(-x,-y)', () => {
    const t = cameraTransform({ x: 100, y: 50, zoom: 2, rotation: 0 }, 640, 360);
    expect(t).toBe('translate(320 180) scale(2) rotate(0) translate(-100 -50)');
  });

  it('sampleCamera animates an axis track (and falls back to base otherwise)', () => {
    const camera: Camera = { base: { x: 0, y: 5, zoom: 1, rotation: 0 }, tracks: { x: [{ time: 0, value: 0, easing: 'linear' }, { time: 1, value: 100, easing: 'linear' }] } };
    const mid = sampleCamera(camera, 0.5);
    expect(mid.x).toBeCloseTo(50);
    expect(mid.y).toBe(5); // no track -> base
    expect(mid.zoom).toBe(1);
  });
});

describe('computeSceneCameraTransform (8b-2b)', () => {
  it('returns null when camera is undefined', () => {
    expect(computeSceneCameraTransform(undefined, 1280, 720, 0)).toBeNull();
  });
  it('matches computeCameraTransform for the same camera', () => {
    const camera = { base: { x: 100, y: 50, zoom: 2, rotation: 10 }, tracks: {} };
    const viaScene = computeSceneCameraTransform(camera, 1280, 720, 0);
    const viaProject = computeCameraTransform({ ...createProject({ width: 1280, height: 720 }), camera }, 0);
    expect(viaScene).toBe(viaProject);
  });
});

describe('engine/camera editor helpers', () => {
  it('cameraFrameCorners of the default pose is the artboard', () => {
    const c = cameraFrameCorners(defaultCameraPose(640, 360), 640, 360);
    expect(c.map((p) => [Math.round(p.x), Math.round(p.y)])).toEqual([[0, 0], [640, 0], [640, 360], [0, 360]]);
  });

  it('cameraViewToWorld inverts cameraTransform for zoom + rotation', () => {
    const pose = { x: 100, y: 50, zoom: 2, rotation: 30 };
    const w = cameraViewToWorld(pose, 640, 360, 400, 100);
    // Forward: translate(W/2,H/2) scale(z) rotate(r) translate(-x,-y)
    const r = (30 * Math.PI) / 180;
    const lx = w.x - 100;
    const ly = w.y - 50;
    const vx = 320 + 2 * (lx * Math.cos(r) - ly * Math.sin(r));
    const vy = 180 + 2 * (lx * Math.sin(r) + ly * Math.cos(r));
    expect(vx).toBeCloseTo(400);
    expect(vy).toBeCloseTo(100);
  });

  it('a 2x zoomed camera frames half the artboard around its centre', () => {
    const c = cameraFrameCorners({ x: 320, y: 180, zoom: 2, rotation: 0 }, 640, 360);
    expect(c[0].x).toBeCloseTo(160);
    expect(c[0].y).toBeCloseTo(90);
    expect(c[2].x).toBeCloseTo(480);
    expect(c[2].y).toBeCloseTo(270);
  });

  it('panCameraBy moves the picture by the drag: the world point under the cursor stays put', () => {
    const pose = { x: 100, y: 50, zoom: 2, rotation: 45 };
    const before = cameraViewToWorld(pose, 640, 360, 300, 200);
    const next = panCameraBy(pose, 20, -10);
    const after = cameraViewToWorld(next, 640, 360, 320, 190);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('clampCameraZoom keeps zoom in range', () => {
    expect(clampCameraZoom(0)).toBe(CAMERA_ZOOM_MIN);
    expect(clampCameraZoom(100)).toBe(CAMERA_ZOOM_MAX);
    expect(clampCameraZoom(1.5)).toBe(1.5);
  });
});
