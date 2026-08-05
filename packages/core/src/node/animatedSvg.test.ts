import { describe, it, expect } from 'vitest';
import { createProject, createSceneObject, createVectorAsset } from '@savig/engine';
import type { Project } from '@savig/engine';
import { renderAnimatedSvgNode } from './animatedSvg';

/** A 1s project with one rect whose x animates 0 -> 100. Copied from
 *  packages/services/src/export/animatedSvg.test.ts's `movingRectProject()` — uses the engine's
 *  factories (createProject/createSceneObject/createVectorAsset) rather than bare literals, since a
 *  bare SceneObject literal would omit `shapeBase` (geometry silently absent) and `anchorX`/`anchorY`
 *  (pivot silently zeroed). */
function movingRectProject(): Project {
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

describe('renderAnimatedSvgNode', () => {
  it('produces SMIL markup without any global DOM (bare Node env)', () => {
    const markup = renderAnimatedSvgNode(movingRectProject());
    expect(markup).toContain('<svg');
    expect(markup).toContain('animateTransform');
  });

  it('is deterministic', () => {
    const p = movingRectProject();
    expect(renderAnimatedSvgNode(p)).toBe(renderAnimatedSvgNode(p));
  });
});
