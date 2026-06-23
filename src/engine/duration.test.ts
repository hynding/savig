import { describe, expect, test } from 'vitest';
import { computeProjectDuration } from './duration';
import { createGroupObject, createKeyframe, createProject, createSceneObject } from './project';

describe('computeProjectDuration', () => {
  test('is 0 for an empty auto project', () => {
    expect(computeProjectDuration(createProject())).toBe(0);
  });

  test('uses the latest keyframe time in auto mode', () => {
    const project = createProject();
    project.objects = [
      createSceneObject('a', {
        tracks: { x: [createKeyframe(0, 0), createKeyframe(3.5, 100)] },
      }),
    ];
    expect(computeProjectDuration(project)).toBeCloseTo(3.5, 6);
  });

  test('considers audio clip end times in auto mode', () => {
    const project = createProject();
    project.audioClips = [
      { id: 'c1', assetId: 'a', startTime: 2, inPoint: 1, outPoint: 4, volume: 1 },
    ];
    // ends at 2 + (4 - 1) = 5
    expect(computeProjectDuration(project)).toBeCloseTo(5, 6);
  });

  test('takes the max across both keyframes and audio clips', () => {
    const project = createProject();
    project.objects = [
      createSceneObject('a', { tracks: { x: [createKeyframe(4, 0)] } }),
    ];
    project.audioClips = [
      { id: 'c1', assetId: 'a', startTime: 0, inPoint: 0, outPoint: 5, volume: 1 },
    ];
    expect(computeProjectDuration(project)).toBeCloseTo(5, 6); // audio (5) > keyframe (4)

    project.audioClips[0].outPoint = 3; // audio now ends at 3
    expect(computeProjectDuration(project)).toBeCloseTo(4, 6); // keyframe (4) > audio (3)
  });

  test('returns meta.duration in manual mode', () => {
    const project = createProject({ durationMode: 'manual', duration: 12 });
    project.objects = [
      createSceneObject('a', { tracks: { x: [createKeyframe(99, 0)] } }),
    ];
    expect(computeProjectDuration(project)).toBe(12);
  });
});

describe('shape track duration', () => {
  test('extends auto-duration to the last shape keyframe', () => {
    const obj = createSceneObject('a', {
      shapeTrack: [
        { time: 0, easing: 'linear', path: { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }] } },
        { time: 4, easing: 'linear', path: { closed: false, nodes: [{ anchor: { x: 1, y: 0 } }] } },
      ],
    });
    const project = { ...createProject(), objects: [obj] };
    expect(computeProjectDuration(project)).toBe(4);
  });
});

describe('computeProjectDuration color tracks', () => {
  test('extends the duration to a color keyframe past the prior end', () => {
    const obj = createSceneObject('a', {
      colorTracks: {
        stroke: [
          { time: 0, value: '#000000', easing: 'linear' },
          { time: 7, value: '#ffffff', easing: 'linear' },
        ],
      },
    });
    const project = { ...createProject(), objects: [obj] };
    expect(computeProjectDuration(project)).toBe(7);
  });
});

describe('computeProjectDuration gradient tracks', () => {
  test('extends the duration to a gradient keyframe past the prior end', () => {
    const g = (x2: number) => ({
      type: 'linear' as const,
      x1: 0,
      y1: 0,
      x2,
      y2: 0,
      stops: [{ offset: 0, color: '#000000' }],
    });
    const obj = createSceneObject('a', {
      gradientTracks: {
        fill: [
          { time: 0, gradient: g(0), easing: 'linear' },
          { time: 8, gradient: g(1), easing: 'linear' },
        ],
      },
    });
    const project = { ...createProject(), objects: [obj] };
    expect(computeProjectDuration(project)).toBe(8);
  });
});

describe('computeProjectDuration dash offset track', () => {
  test('extends the duration to a dash keyframe past the prior end', () => {
    const obj = createSceneObject('a', {
      dashOffsetTrack: [createKeyframe(0, 1), createKeyframe(9, 0)],
    });
    const project = { ...createProject(), objects: [obj] };
    expect(computeProjectDuration(project)).toBe(9);
  });
});

describe('computeProjectDuration motion path', () => {
  test('extends the duration to a progress keyframe past the prior end', () => {
    const obj = createSceneObject('a', {
      motionPath: {
        path: { nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 1, y: 0 } }], closed: false },
        orient: false,
        progress: [createKeyframe(0, 0), createKeyframe(6, 1)],
      },
    });
    const project = { ...createProject(), objects: [obj] };
    expect(computeProjectDuration(project)).toBe(6);
  });
});

describe('group tracks extend the auto-duration (slice 45d)', () => {
  it("a group's keyframe extends computeProjectDuration", () => {
    const project = createProject();
    const g = createGroupObject({ id: 'g', anchorX: 0, anchorY: 0, zOrder: 0 });
    g.tracks.x = [createKeyframe(0, 0), createKeyframe(2.5, 100)];
    project.objects.push(g);
    expect(computeProjectDuration(project)).toBeGreaterThanOrEqual(2.5);
  });
});
