/**
 * Animated SVG (SMIL) export e2e (Task 8): builds a keyframed project headlessly in Node via
 * renderAnimatedSvgNode (Task 7), then asserts the exported markup really animates (deterministic
 * SMIL seek via pauseAnimations()/setCurrentTime(), reading getCTM() since getAttribute does NOT
 * reflect SMIL animation), renders inside a script-free <img>, and is reachable from the command
 * palette. Project builder mirrors packages/core/src/node/animatedSvg.test.ts's movingRectProject().
 */
import { test, expect } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createProject, createSceneObject, createVectorAsset } from '../packages/engine/src';
import type { Project } from '../packages/engine/src';
import { renderAnimatedSvgNode } from '../packages/core/src/node/animatedSvg';

function buildAnimatedProject(): Project {
  const p = createProject({ name: 'anim-e2e' });
  p.meta.fps = 30;
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

test('exported animated SVG really animates (deterministic SMIL seek)', async ({ page }) => {
  const markup = renderAnimatedSvgNode(buildAnimatedProject());
  const dir = mkdtempSync(join(tmpdir(), 'savig-anim-'));
  const file = join(dir, 'anim.svg');
  writeFileSync(file, markup);
  await page.goto(pathToFileURL(file).href);

  const ctmAt = (t: number) =>
    page.evaluate((time) => {
      const svg = document.documentElement as unknown as SVGSVGElement;
      svg.pauseAnimations();
      svg.setCurrentTime(time);
      const el = document.querySelector('[data-savig-object]') as SVGGraphicsElement;
      const m = el.getCTM()!;
      return [m.a, m.b, m.c, m.d, m.e, m.f].join(',');
    }, t);

  const at0 = await ctmAt(0);
  const atMid = await ctmAt(0.5);
  expect(atMid).not.toBe(at0);
});

test('exported animated SVG renders inside an <img> (script-free context)', async ({ page }) => {
  const markup = renderAnimatedSvgNode(buildAnimatedProject());
  const dir = mkdtempSync(join(tmpdir(), 'savig-anim-img-'));
  writeFileSync(join(dir, 'anim.svg'), markup);
  writeFileSync(join(dir, 'wrap.html'), '<!DOCTYPE html><img src="anim.svg" width="320">');
  await page.goto(pathToFileURL(join(dir, 'wrap.html')).href);
  const loaded = await page.locator('img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0);
  expect(loaded).toBe(true);
});

test('Export animated SVG from the command palette downloads a .svg', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  await page.goto('/');
  const svg = page.locator('section[aria-label="Stage"] svg').first();
  const box = (await svg.boundingBox())!;
  await page.getByRole('group', { name: 'Tools' }).getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 180);
  await page.mouse.up();
  await page.locator('section[aria-label="Stage"]').click();
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.getByLabel('Command search').fill('export animated svg');
  const downloadPromise = page.waitForEvent('download');
  await palette.getByLabel('Command search').press('Enter');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.svg$/);
});
