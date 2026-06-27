import { describe, expect, test } from 'vitest';
import { computeProjectDuration, objectsMaxKeyframeTime } from './duration';
import { createGroupObject, createKeyframe, createProject, createSceneObject, createSymbolAsset, createVectorAsset } from './project';
import type { SymbolTiming } from './types';

describe('objectsMaxKeyframeTime (slice 47c)', () => {
  test('is 0 for objects with no keyframes', () => {
    expect(objectsMaxKeyframeTime([createSceneObject('a', { id: 'o' })])).toBe(0);
  });
  test('returns the latest keyframe time across tracks', () => {
    const o = createSceneObject('a', { id: 'o' });
    o.tracks = { x: [createKeyframe(0, 0), createKeyframe(2.5, 9)] };
    expect(objectsMaxKeyframeTime([o])).toBeCloseTo(2.5, 6);
  });
});

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

describe('computeProjectDuration with symbol instances (47c)', () => {
  const symWithKf = () => {
    const inner = createSceneObject('rect-asset', { id: 'leaf' });
    inner.tracks = { x: [createKeyframe(0, 0), createKeyframe(5, 50)] };
    return createSymbolAsset({ id: 'S', name: 'S', objects: [inner], width: 10, height: 10 });
  };
  const proj = (symbolTime?: Partial<SymbolTiming>) => {
    const p = createProject();
    p.assets = [createVectorAsset('rect', { id: 'rect-asset', shapeType: 'rect' }), symWithKf()];
    const inst = createSceneObject('S', { id: 'inst' });
    if (symbolTime) inst.symbolTime = { startOffset: 0, loop: false, speed: 1, ...symbolTime };
    p.objects = [inst];
    return p;
  };

  test('counts the instance internal length (no symbolTime)', () => {
    expect(computeProjectDuration(proj())).toBeCloseTo(5, 4); // was 0
  });
  test('adds startOffset and divides by speed', () => {
    expect(computeProjectDuration(proj({ startOffset: 2 }))).toBeCloseTo(7, 4);
    expect(computeProjectDuration(proj({ speed: 2 }))).toBeCloseTo(2.5, 4);
  });
  test('multiplies by playCount when looping', () => {
    expect(computeProjectDuration(proj({ loop: true, playCount: 3 }))).toBeCloseTo(15, 4);
  });
  test('covers one there-and-back cycle for an infinite ping-pong loop', () => {
    expect(computeProjectDuration(proj({ loop: true, pingPong: true }))).toBeCloseTo(10, 4);
  });
  test('is unchanged for a project with no instances', () => {
    const p = createProject();
    expect(computeProjectDuration(p)).toBeCloseTo(objectsMaxKeyframeTime(p.objects), 4);
  });
  test('a symbolTimeTrack extends the duration to the curve\'s last keyframe time (47c keyframed)', () => {
    const p = proj();
    p.objects[0].symbolTimeTrack = [createKeyframe(0, 0), createKeyframe(8, 2)]; // authored curve ends at parent t=8
    expect(computeProjectDuration(p)).toBeCloseTo(8, 4); // supersedes the intrinsic-5 constant-remap extent
  });
});
