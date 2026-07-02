/**
 * Multi-scene export e2e (8b-2c): builds a 2-scene project headlessly in Node,
 * exports it via exportProject(), loads the bundle in chromium, and asserts
 * that the runtime switches scene visibility at the correct master time.
 *
 * Does NOT drive the editor UI (multi-scene is not yet authorable via UI in 8b-3).
 * Mirror mechanics from export.spec.ts (unzip/temp-dir/file://).
 */
import { test, expect } from '@playwright/test';
import { unzipSync } from 'fflate';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createProject, createVectorAsset, createSceneObject } from '../packages/engine/src';
import { exportProject } from '../packages/services/src/export/exportProject';

test('multi-scene export: runtime switches scene visibility at master time', async ({ page }) => {
  // ── Build a 2-scene project in Node context ──────────────────────────────
  const aAsset = createVectorAsset('rect', { id: 'aRect' });
  aAsset.style = { fill: '#ff0000', stroke: 'none', strokeWidth: 0 };

  const bAsset = createVectorAsset('rect', { id: 'bRect' });
  bAsset.style = { fill: '#0000ff', stroke: 'none', strokeWidth: 0 };

  const project = {
    ...createProject({ width: 400, height: 300, loop: false }),
    assets: [aAsset, bAsset],
    objects: [],
    scenes: [
      { id: 'scA', name: 'A', objects: [createSceneObject('aRect', { id: 'oa' })], duration: 1 },
      { id: 'scB', name: 'B', objects: [createSceneObject('bRect', { id: 'ob' })], duration: 1 },
    ],
  };

  // ── Export and unzip ──────────────────────────────────────────────────────
  const zipBytes = exportProject(project, {});
  const dir = mkdtempSync(join(tmpdir(), 'savig-ms-e2e-'));
  const files = unzipSync(zipBytes);
  for (const [path, data] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, data);
  }
  expect(Object.keys(files)).toContain('index.html');

  // ── Load in chromium ──────────────────────────────────────────────────────
  const exported = await page.context().newPage();
  await exported.goto(pathToFileURL(join(dir, 'index.html')).href);

  // Wait for the runtime to initialise: the inline <script> fires on load and
  // calls apply(0) which sets scene visibility immediately.
  await exported.waitForLoadState('load');

  // ── Assert: at master t≈0, scene A is visible, scene B is hidden ─────────
  const sceneA = exported.locator('[data-savig-scene="scA"]');
  const sceneB = exported.locator('[data-savig-scene="scB"]');

  // Read inline style.display directly (SVG <g> style attribute).
  // Scene A: no display:none (visible). Scene B: display:none.
  const displayA_t0 = await sceneA.evaluate((el) => (el as SVGElement).style.display);
  expect(displayA_t0).not.toBe('none');

  const displayB_t0 = await sceneB.evaluate((el) => (el as SVGElement).style.display);
  expect(displayB_t0).toBe('none');

  // ── Wait past scene A's 1s duration, then assert scene B is now active ───
  await exported.waitForTimeout(1300);

  const displayA_t1 = await sceneA.evaluate((el) => (el as SVGElement).style.display);
  expect(displayA_t1).toBe('none');

  const displayB_t1 = await sceneB.evaluate((el) => (el as SVGElement).style.display);
  expect(displayB_t1).not.toBe('none');
});
