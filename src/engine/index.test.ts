import { describe, expect, test } from 'vitest';
import {
  advance,
  buildTransform,
  computeProjectDuration,
  createKeyframe,
  createProject,
  createSceneObject,
  play,
  sampleProject,
  upsertKeyframe,
} from './index';

describe('engine barrel', () => {
  test('re-exports primitive generators', async () => {
    const mod = await import('./index');
    expect(typeof mod.polygonPath).toBe('function');
    expect(typeof mod.starPath).toBe('function');
    expect(typeof mod.linePath).toBe('function');
  });
});

describe('engine integration', () => {
  test('build a project, animate it, and sample a frame end-to-end', () => {
    // Object that slides x from 0 to 100 over 2 seconds.
    const obj = createSceneObject('svg-asset', { id: 'mover', anchorX: 50, anchorY: 50 });
    obj.tracks.x = upsertKeyframe(
      upsertKeyframe([], createKeyframe(0, 0)),
      createKeyframe(2, 100),
    );

    const project = createProject({ name: 'Integration' });
    project.objects = [obj];

    expect(computeProjectDuration(project)).toBeCloseTo(2, 6);

    const midState = sampleProject(project, 1)[0];
    expect(midState.x).toBeCloseTo(50, 6);

    const transform = buildTransform(midState, obj.anchorX, obj.anchorY);
    expect(transform).toContain('translate(50, 0)');
  });

  test('clock drives time forward to produce a later sample', () => {
    const obj = createSceneObject('svg-asset', { id: 'mover' });
    obj.tracks.x = upsertKeyframe(
      upsertKeyframe([], createKeyframe(0, 0)),
      createKeyframe(2, 100),
    );
    const project = createProject();
    project.objects = [obj];

    let clock = play({ time: 0, playing: true, lastTimestamp: null }, 0);
    clock = advance(clock, 0, 2, false); // anchor
    clock = advance(clock, 1, 2, false); // +1s
    expect(sampleProject(project, clock.time)[0].x).toBeCloseTo(50, 6);
  });
});
