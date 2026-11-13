// Bones (spec 2026-11-13-bone-tool): a posed armature is an animated group chain, so the runtime
// and SMIL export move attached drawings with no bone-specific render code.
import { describe, expect, it } from 'vitest';
import { createGroupObject, createProject, createSceneObject, createVectorAsset, type Project, type SceneObject } from '@savig/engine';
import { computeFrame } from '@savig/runtime/frame';
import { renderAnimatedSvgDocument } from './animatedSvg';

function rig(): Project {
  const p = createProject({ fps: 10, width: 200, height: 200 });
  p.assets.push(createVectorAsset('rect', { id: 'ra' }));
  const lin = 'linear' as const;
  const bone: SceneObject = {
    ...createGroupObject({ id: 'b', anchorX: 0, anchorY: 0, zOrder: 0 }),
    bone: { length: 100, angle: 0 },
    tracks: { rotation: [{ time: 0, value: 0, easing: lin }, { time: 1, value: 90, easing: lin }] },
  };
  p.objects.push(bone, createSceneObject('ra', { id: 'hand', parentId: 'b', zOrder: 1, shapeBase: { width: 10, height: 10 }, base: { x: 90, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 } }));
  return p;
}

describe('posed armature render', () => {
  it('the runtime moves the attached drawing with the bone', () => {
    const p = rig();
    const tf = (t: number) => computeFrame(p, t).find((i) => i.objectId === 'hand')!.transform;
    expect(tf(1)).not.toBe(tf(0));
    expect(tf(1)).toMatch(/rotate\(90/);
  });

  it('SMIL animates the bone rotation onto the drawing', () => {
    expect(renderAnimatedSvgDocument(rig())).toMatch(/animateTransform/);
  });
});
