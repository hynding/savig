// Shared project fixtures for the declarative exporter tests (SMIL animatedSvg, CSS cssSvg).
import { createProject, createSceneObject, createTextAsset, createVectorAsset, DEFAULT_VECTOR_STYLE } from '@savig/engine';
import type { Project, Scene, ShapeKeyframe } from '@savig/engine';

/** A 1s project with one rect whose x animates 0 -> 100.
 *  Uses the engine's factories (createProject/createSceneObject/createVectorAsset) rather than
 *  bare literals — a bare SceneObject literal would omit `shapeBase` (geometry silently absent)
 *  and `anchorX`/`anchorY` (pivot silently zeroed), mirroring how renderDocument.test.ts builds
 *  minimal projects. */
export function movingRectProject(): Project {
  const p = createProject({ name: 'anim-test' });
  p.meta.fps = 10;
  p.meta.duration = 1;
  p.meta.durationMode = 'manual';
  p.meta.loop = false;
  p.assets.push(
    createVectorAsset('rect', { id: 'a1', style: { fill: '#ff0000', stroke: 'none', strokeWidth: 1 } }),
  );
  p.objects.push(
    createSceneObject('a1', {
      id: 'o1',
      zOrder: 0,
      anchorMode: 'fraction',
      anchorX: 0.5,
      anchorY: 0.5,
      base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
      shapeBase: { width: 20, height: 20 },
      tracks: { x: [{ time: 0, value: 0, easing: 'linear' }, { time: 1, value: 100, easing: 'linear' }] },
    }),
  );
  return p;
}

/** A 1s project with one path object whose shapeTrack morphs one node — same 2-node,
 *  open-path command skeleton ("M"+"L") in every frame, so linear (default) calcMode applies.
 *  Mirrors packages/runtime/src/frame.test.ts's `morphProject()` (search "shapeTrack"). */
export function pathMorphProject(): Project {
  const k0 = { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 0, y: 0 } }] };
  const k1 = { closed: false, nodes: [{ anchor: { x: 0, y: 0 } }, { anchor: { x: 20, y: 0 } }] };
  const shapeTrack: ShapeKeyframe[] = [
    { time: 0, easing: 'linear', path: k0 },
    { time: 1, easing: 'linear', path: k1 },
  ];
  const p = createProject({ name: 'anim-morph-test' });
  p.meta.fps = 10;
  p.meta.duration = 1;
  p.meta.durationMode = 'manual';
  p.meta.loop = false;
  const asset = createVectorAsset('path', { id: 'p-asset', path: k0 });
  p.assets.push(asset);
  p.objects.push(
    createSceneObject('p-asset', { id: 'path1', anchorMode: 'fraction', anchorX: 0.5, anchorY: 0.5, shapeTrack }),
  );
  return p;
}

/** A 1s project with one stroked rect whose trim window (start/end) animates — dasharray width
 *  changes per frame while token count stays uniform (2 tokens throughout). Mirrors
 *  packages/runtime/src/frame.test.ts's `projectWithTrimRect()` (search "trim"). */
export function trimProject(): Project {
  const p = createProject({ name: 'anim-trim-test' });
  p.meta.fps = 10;
  p.meta.duration = 1;
  p.meta.durationMode = 'manual';
  p.meta.loop = false;
  const asset = createVectorAsset('rect', { id: 't-asset', style: { ...DEFAULT_VECTOR_STYLE, stroke: '#000000', strokeWidth: 1 } });
  p.assets.push(asset);
  p.objects.push(
    createSceneObject('t-asset', {
      id: 'pt',
      anchorMode: 'fraction',
      anchorX: 0.5,
      anchorY: 0.5,
      shapeBase: { width: 10, height: 10 },
      trim: {
        start: 0,
        end: 1,
        offset: 0,
        endTrack: [
          { time: 0, value: 0, easing: 'linear' },
          { time: 1, value: 1, easing: 'linear' },
        ],
        // offset also animates so phase (and thus stroke-dashoffset) is non-constant too —
        // an end-only trim keeps offset/phase pinned at 0 (constant dashoffset, no <animate>).
        offsetTrack: [
          { time: 0, value: 0, easing: 'linear' },
          { time: 1, value: 0.3, easing: 'linear' },
        ],
      },
    }),
  );
  return p;
}

/** A 1s project with one rect whose fill gradient's stop colors animate. Mirrors
 *  packages/runtime/src/frame.test.ts's `gradientTrackProject()` (search "gradientTracks"). */
export function gradientProject(): Project {
  const g0 = {
    type: 'linear' as const,
    x1: 0,
    y1: 0,
    x2: 0,
    y2: 0,
    stops: [
      { offset: 0, color: '#000000' },
      { offset: 1, color: '#000000' },
    ],
  };
  const g1 = {
    type: 'linear' as const,
    x1: 0,
    y1: 0,
    x2: 1,
    y2: 0,
    stops: [
      { offset: 0, color: '#ffffff' },
      { offset: 1, color: '#ffffff' },
    ],
  };
  const p = createProject({ name: 'anim-gradient-test' });
  p.meta.fps = 10;
  p.meta.duration = 1;
  p.meta.durationMode = 'manual';
  p.meta.loop = false;
  const asset = createVectorAsset('rect', { id: 'g-asset' });
  p.assets.push(asset);
  p.objects.push(
    createSceneObject('g-asset', {
      id: 'o1',
      anchorMode: 'fraction',
      anchorX: 0.5,
      anchorY: 0.5,
      shapeBase: { width: 10, height: 10 },
      gradientTracks: {
        fill: [
          { time: 0, gradient: g0, easing: 'linear' },
          { time: 1, gradient: g1, easing: 'linear' },
        ],
      },
    }),
  );
  return p;
}

/** A 1s project with one text object whose CONTENT literally contains the substring
 *  "data-savig-camera" (no relation to the actual camera-wrap markup) — regression fixture for
 *  the camera-attribute normalization: it must not corrupt escaped text/asset content that
 *  happens to contain the same literal substring. Animates opacity so sampling isn't skipped. */
export function textWithLiteralProject(): Project {
  const p = createProject({ name: 'anim-text-literal-test' });
  p.meta.fps = 10;
  p.meta.duration = 1;
  p.meta.durationMode = 'manual';
  p.meta.loop = false;
  const content = 'this text contains data-savig-camera literally, not a real camera wrap';
  p.assets.push(createTextAsset({ id: 'txt', content, fontSize: 24, fill: '#000000' }));
  p.objects.push(
    createSceneObject('txt', {
      id: 'tobj',
      anchorMode: 'fraction',
      anchorX: 0.5,
      anchorY: 0.5,
      base: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
      tracks: { opacity: [{ time: 0, value: 0, easing: 'linear' }, { time: 1, value: 1, easing: 'linear' }] },
    }),
  );
  return p;
}

/** Multi-scene fixture: two 0.5s scenes (cut), fps 10 — mirrors the two-scene shape in
 *  packages/engine/src/scenes.test.ts's `sc()`/`multiTrans()`. Built on `promoteToMultiScene`
 *  per the Task-5 brief. */
export function withSecondScene(p: Project): Project {
  const scenes = p.scenes!;
  const s0: Scene = { ...scenes[0], duration: 0.5 };
  const s1: Scene = { id: 's1', name: 'Scene 2', objects: s0.objects, duration: 0.5, transitionIn: { kind: 'cut' } };
  return { ...p, scenes: [s0, s1] };
}

/** Mutates scenes[1].transitionIn to a dip transition, matching the brief's calling convention. */
export function setDipTransition(p: Project): void {
  const scenes = p.scenes!;
  scenes[1] = { ...scenes[1], transitionIn: { kind: 'dip', duration: 0.2, color: '#000000' } };
}

