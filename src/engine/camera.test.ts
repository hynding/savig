import { describe, it, expect } from 'vitest';
import { createProject } from './project';
import { sampleCamera, cameraTransform, computeCameraTransform, computeSceneCameraTransform, defaultCameraPose } from './camera';
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
