/**
 * Crossfade transition e2e (8b-4): builds a 2-scene project with a crossfade
 * transitionIn, exports it via exportProject(), loads the bundle in chromium,
 * and asserts that at a master time INSIDE the overlap window BOTH scene groups
 * are visible AND the incoming scene's opacity is strictly between 0 and 1.
 *
 * Determinism: the exported runtime exposes `window.savigSeek(t)` (added in
 * 8b-4 to src/runtime/index.ts). Calling savigSeek AND reading the DOM inside
 * the SAME page.evaluate() call guarantees no requestAnimationFrame tick can
 * interleave — JavaScript is single-threaded and RAF callbacks are macrotasks
 * that cannot preempt a running synchronous script.
 *
 * Timeline:
 *   Scene A (scA): duration 2s, master start = 0, master end = 2
 *   Scene B (scB): duration 2s, transitionIn = { kind: 'crossfade', duration: 1 }
 *                  overlap = 1s → master start = 1, master end = 3
 *   Overlap window: [1, 2)
 *   At t = 1.5 (mid-overlap): progress = 0.5 → scB opacity = 0.5, scA full opacity.
 */
import { test, expect } from '@playwright/test';
import { unzipSync } from 'fflate';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createProject, createVectorAsset, createSceneObject } from '../packages/engine/src';
import { exportProject } from '../packages/services/src/export/exportProject';

test('exported crossfade shows both scenes mid-transition', async ({ page }) => {
  // ── Build a 2-scene crossfade project in Node context ────────────────────
  const aAsset = createVectorAsset('rect', { id: 'aRect' });
  aAsset.style = { fill: '#ff0000', stroke: 'none', strokeWidth: 0 };

  const bAsset = createVectorAsset('rect', { id: 'bRect' });
  bAsset.style = { fill: '#0000ff', stroke: 'none', strokeWidth: 0 };

  const project = {
    ...createProject({ width: 400, height: 300, loop: false }),
    assets: [aAsset, bAsset],
    objects: [],
    scenes: [
      {
        id: 'scA',
        name: 'A',
        objects: [createSceneObject('aRect', { id: 'oa' })],
        duration: 2,
      },
      {
        id: 'scB',
        name: 'B',
        objects: [createSceneObject('bRect', { id: 'ob' })],
        duration: 2,
        transitionIn: { kind: 'crossfade' as const, duration: 1 },
      },
    ],
  };

  // ── Export and unzip ──────────────────────────────────────────────────────
  const zipBytes = exportProject(project, {});
  const dir = mkdtempSync(join(tmpdir(), 'savig-xfade-e2e-'));
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

  // Wait for the runtime to initialise: the inline <script> fires on load,
  // calls apply(0), and exposes window.savigSeek.
  await exported.waitForLoadState('load');
  await exported.waitForFunction(() => typeof (window as unknown as { savigSeek: (t: number) => void }).savigSeek === 'function');

  // ── Deterministic seek to t=1.5 (mid crossfade overlap) ──────────────────
  // BOTH apply and DOM read happen inside ONE page.evaluate() call (single JS
  // task). No requestAnimationFrame callback can fire between them.
  const masterTime = 1.5; // inside the [1, 2) overlap window; progress = 0.5
  const result = await exported.evaluate((t: number) => {
    (window as unknown as { savigSeek: (t: number) => void }).savigSeek(t);
    const a = document.querySelector('[data-savig-scene="scA"]') as SVGGElement | null;
    const b = document.querySelector('[data-savig-scene="scB"]') as SVGGElement | null;
    return {
      displayA: a ? a.style.display : 'missing',
      opacityA: a ? a.style.opacity : 'missing',
      displayB: b ? b.style.display : 'missing',
      opacityB: b ? b.style.opacity : 'missing',
    };
  }, masterTime);

  // ── Assert: both scene groups are visible mid-transition ──────────────────
  // Scene A (outgoing): display visible, opacity cleared (full — runtime sets opacity '' for null)
  expect(result.displayA, 'scene A should be visible mid-crossfade').not.toBe('none');

  // Scene B (incoming): display visible, opacity = '0.5' (progress at t=1.5)
  expect(result.displayB, 'scene B should be visible mid-crossfade').not.toBe('none');

  // The real transition proof: incoming scene opacity is strictly between 0 and 1.
  const opacityB = parseFloat(result.opacityB);
  expect(opacityB, `scene B opacity should be in (0,1) — got '${result.opacityB}'`).toBeGreaterThan(0);
  expect(opacityB, `scene B opacity should be in (0,1) — got '${result.opacityB}'`).toBeLessThan(1);
});
