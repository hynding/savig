/**
 * Frame-by-frame slice 5 (spec 2026-11-07 §Render & export): an exported animated SVG (SMIL, no
 * script) really swaps drawings frame by frame in a browser, and a non-looping one freezes on
 * the last drawing. Deterministic SMIL seek via pauseAnimations()/setCurrentTime(), reading the
 * COMPUTED visibility (getAttribute does not reflect SMIL animation).
 */
import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createFrameLayer, createProject, createSceneObject, createVectorAsset } from '../packages/engine/src';
import type { Project } from '../packages/engine/src';
import { renderAnimatedSvgNode } from '../packages/core/src/node/animatedSvg';

/** 10 fps, 1 s, no loop: drawing A on frames 1–3, B on frames 4–7, a blank key on frame 8, and
 *  drawing C on frames 9–10, where the layer (and the timeline) ends. */
function project(): Project {
  const p = createProject({ name: 'fbf-e2e', fps: 10 });
  p.meta.loop = false;
  p.assets.push(createVectorAsset('rect', { id: 'va', style: { fill: '#ff0000', stroke: 'none', strokeWidth: 1 } }));
  p.objects.push(
    createFrameLayer({ id: 'L', zOrder: 0, keys: [{ id: 'a', time: 0 }, { id: 'b', time: 0.3 }, { id: 'blank', time: 0.7 }, { id: 'c', time: 0.8 }], end: 1 }),
    createSceneObject('va', { id: 'A', zOrder: 1, parentId: 'L', frameKeyId: 'a', shapeBase: { width: 10, height: 10 } }),
    createSceneObject('va', { id: 'B', zOrder: 2, parentId: 'L', frameKeyId: 'b', shapeBase: { width: 10, height: 10 } }),
    createSceneObject('va', { id: 'C', zOrder: 3, parentId: 'L', frameKeyId: 'c', shapeBase: { width: 10, height: 10 } }),
  );
  return p;
}

test('exported animated SVG swaps frame-by-frame drawings and freezes on the last one', async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), 'savig-fbf-'));
  const file = join(dir, 'fbf.svg');
  writeFileSync(file, renderAnimatedSvgNode(project()));
  await page.goto(pathToFileURL(file).href);

  const shownAt = (t: number) =>
    page.evaluate((time) => {
      const svg = document.documentElement as unknown as SVGSVGElement;
      svg.pauseAnimations();
      svg.setCurrentTime(time);
      return ['A', 'B', 'C'].filter(
        (id) => getComputedStyle(document.querySelector(`[data-savig-object="${id}"]`)!).visibility === 'visible',
      );
    }, t);

  expect(await shownAt(0)).toEqual(['A']);
  expect(await shownAt(0.25)).toEqual(['A']);
  expect(await shownAt(0.35)).toEqual(['B']);
  expect(await shownAt(0.75)).toEqual([]); // the blank key
  expect(await shownAt(0.85)).toEqual(['C']);
  expect(await shownAt(5)).toEqual(['C']); // frozen after the end: the last drawing, not a blank frame
});
